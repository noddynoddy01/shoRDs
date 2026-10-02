"use strict";
/**
 * HTTP application for the production runtime. `createApp(deps)` returns a request handler; every dependency (database,
 * Redis, token verifier, rate limiter, clock, model client) is injected, so tests run the real handler against real
 * PostgreSQL/Redis (or controlled fakes) with no environment switches that could weaken production.
 *
 * Request pipeline for protected routes (authentication and authorization are separate steps):
 *
 *   CORS check -> per-IP limit -> authenticate (Bearer token verified) -> per-user limit -> body (size cap, JSON)
 *   -> validate input -> authorize resource (project role) -> per-tenant / daily limits -> handler -> safe response
 *
 * Public: GET / , /health (liveness only), /ready (real dependency state), /api/v1/replica.
 * Admin only (ADMIN_UIDS): GET /api/v1/llm/health, /api/v1/llm/metrics.
 */

const crypto = require("crypto");
const { AuthError, authenticateRequest } = require("./security/auth");
const { evaluateCors } = require("./security/cors");
const { clientIp, rateLimitHeaders, RateLimiterUnavailable } = require("./security/rateLimit");
const projects = require("./security/projects");
const { validateRequest, buildLlmHealth, PROMPT_VERSION } = require("./llm/copilotService");
const { runCopilot } = require("./llm/runCopilot");
const { toView } = require("./jobs/jobStore");
const { ANALYSIS_QUESTION } = require("./jobs/analysisProcessor");

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const JOB_ID_RE = /^job_[0-9a-f]{24}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function createApp(deps) {
  const {
    env = process.env,
    replicaId,
    pool,
    redis,
    verifier,
    rateLimiter,
    corsConfig,
    telemetry,
    jobStore,
    cache = null,
    readiness,
    workerStats = null,
    client,
    logger = console,
    now = Date.now
  } = deps;

  const maxBodyBytes = Number(deps.maxBodyBytes || env.MAX_REQUEST_BODY_BYTES || 524288);
  const trustProxy = deps.trustProxy !== undefined ? deps.trustProxy : env.TRUST_PROXY === "true";
  const proxyHops = Number(deps.proxyHops || env.TRUST_PROXY_HOPS || 1);
  const adminUids = new Set(String(env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean));
  const logRequests = deps.logRequests !== undefined ? deps.logRequests : env.LOG_REQUESTS !== "false";

  const httpStats = { requests: 0, byRoute: {} };
  const bumpHttp = (route, status) => {
    httpStats.requests += 1;
    const r = (httpStats.byRoute[route] = httpStats.byRoute[route] || {});
    const cls = `${Math.floor(status / 100)}xx`;
    r[cls] = (r[cls] || 0) + 1;
  };

  // ---------- response helpers ----------
  function send(ctx, status, body, extra = {}) {
    const { res } = ctx;
    if (res.headersSent) return;
    const headers = { ...JSON_HEADERS, ...ctx.headers, ...extra };
    if (ctx.closeAfter) headers.Connection = "close";
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
    ctx.status = status;
  }
  const fail = (ctx, status, error, message, extra) => send(ctx, status, { error, message, requestId: ctx.requestId }, extra);

  function readBody(ctx) {
    return new Promise((resolve) => {
      const { req } = ctx;
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        ctx.closeAfter = true;
        fail(ctx, 413, "REQUEST_TOO_LARGE", `Request body may be at most ${maxBodyBytes} bytes.`);
        return resolve(null);
      }
      const parts = [];
      let received = 0;
      let aborted = false;
      req.on("data", (chunk) => {
        if (aborted) return;
        received += chunk.length;
        if (received > maxBodyBytes) {
          aborted = true;
          ctx.closeAfter = true;
          fail(ctx, 413, "REQUEST_TOO_LARGE", `Request body may be at most ${maxBodyBytes} bytes.`);
          ctx.res.on("finish", () => req.destroy());
          return resolve(null);
        }
        parts.push(chunk);
      });
      req.on("error", () => {
        if (!aborted) resolve(null);
      });
      req.on("end", () => {
        if (aborted) return;
        const text = Buffer.concat(parts).toString("utf8");
        if (text.trim() === "") return resolve({});
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            fail(ctx, 400, "INVALID_REQUEST", "Request body must be a JSON object.");
            return resolve(null);
          }
          resolve(parsed);
        } catch (_) {
          fail(ctx, 400, "INVALID_JSON", "Request body is not valid JSON.");
          resolve(null);
        }
      });
    });
  }

  // ---------- pipeline steps; each returns true to continue, false once it has answered ----------
  async function limit(ctx, policyName, scope, id) {
    let r;
    try {
      r = await rateLimiter.hit(policyName, scope, id);
    } catch (e) {
      if (e instanceof RateLimiterUnavailable) {
        fail(ctx, 503, "RATE_LIMITER_UNAVAILABLE", "Service temporarily unavailable. Please retry shortly.", { "Retry-After": "5" });
        return false;
      }
      throw e;
    }
    Object.assign(ctx.headers, rateLimitHeaders(r));
    if (!r.allowed) {
      ctx.closeAfter = ctx.closeAfter || ctx.req.method !== "GET";
      fail(ctx, 429, "RATE_LIMITED", "Too many requests. Please slow down.", rateLimitHeaders(r));
      return false;
    }
    return true;
  }

  async function authenticate(ctx) {
    const ip = ctx.ip;
    try {
      const blocked = await rateLimiter.peek("AUTH_FAIL_IP", "ip", ip);
      if (!blocked.allowed) {
        ctx.closeAfter = true;
        fail(ctx, 429, "RATE_LIMITED", "Too many failed authentication attempts.", { "Retry-After": "60" });
        return false;
      }
    } catch (e) {
      if (e instanceof RateLimiterUnavailable) {
        fail(ctx, 503, "RATE_LIMITER_UNAVAILABLE", "Service temporarily unavailable. Please retry shortly.", { "Retry-After": "5" });
        return false;
      }
      throw e;
    }
    try {
      ctx.principal = await authenticateRequest(ctx.req.headers, verifier);
      return true;
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      if (e.httpStatus === 401) {
        try {
          await rateLimiter.hit("AUTH_FAIL_IP", "ip", ip); // only genuine credential failures count
        } catch (_) {
          /* counting failure must not turn a 401 into a 500 */
        }
      }
      ctx.closeAfter = ctx.req.method !== "GET";
      const safe = e.httpStatus === 503 ? "Authentication is temporarily unavailable." : "Authentication required: send a valid 'Authorization: Bearer <ID token>' header.";
      fail(ctx, e.httpStatus, e.code, safe, e.httpStatus === 401 ? { "WWW-Authenticate": 'Bearer realm="shords"' } : undefined);
      return false;
    }
  }

  async function authorize(ctx, projectId, minRole) {
    try {
      return await projects.authorizeProject(pool, ctx.principal, projectId, minRole);
    } catch (e) {
      if (e instanceof projects.AuthzError) {
        fail(ctx, 403, "FORBIDDEN", "You do not have access to this project.");
        return null;
      }
      throw e;
    }
  }

  const isAdmin = (principal) => adminUids.has(principal.uid);

  // ---------- route handlers ----------
  async function getRoot(ctx) {
    send(ctx, 200, { name: "shoRDs Research Intelligence OS API", version: "1.0.0", status: "ONLINE", replicaId, auth: "Firebase ID token (Authorization: Bearer)", docs: "/ready reports dependency state" });
  }

  async function getHealth(ctx) {
    // liveness only: no dependency is touched here
    send(ctx, 200, { status: "UP", replicaId, timestamp: new Date(now()).toISOString() });
  }

  async function getReady(ctx) {
    const r = await readiness();
    send(ctx, r.ready ? 200 : 503, r);
  }

  async function getReplica(ctx) {
    send(ctx, 200, { replicaId, environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "development", uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date(now()).toISOString() });
  }

  async function getLlmHealth(ctx) {
    if (!isAdmin(ctx.principal)) return fail(ctx, 403, "FORBIDDEN", "Administrator access required.");
    send(ctx, 200, buildLlmHealth({ env, telemetry }));
  }

  async function getLlmMetrics(ctx) {
    if (!isAdmin(ctx.principal)) return fail(ctx, 403, "FORBIDDEN", "Administrator access required.");
    const health = buildLlmHealth({ env, telemetry });
    let jobs = null;
    try {
      jobs = await jobStore.counts();
    } catch (_) {
      jobs = null; // not measured rather than guessed
    }
    send(ctx, 200, {
      activeProvider: health.activeProvider,
      activeModel: health.anthropic.model,
      promptVersion: PROMPT_VERSION,
      ...telemetry.snapshot(),
      http: { scope: "REPLICA_LOCAL", ...JSON.parse(JSON.stringify(httpStats)) },
      jobs: jobs ? { scope: "ALL_REPLICAS", counts: jobs } : null,
      worker: workerStats ? workerStats() : null
    });
  }

  async function postProject(ctx) {
    if (!(await limit(ctx, "WRITE_USER", "user", ctx.principal.uid))) return;
    const body = await readBody(ctx);
    if (!body) return;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return fail(ctx, 400, "INVALID_NAME", "`name` is required (1-120 characters).");
    const project = await projects.createProject(pool, { name, userId: ctx.principal.uid });
    send(ctx, 201, { ...project, requestId: ctx.requestId });
  }

  async function listMyProjects(ctx) {
    if (!(await limit(ctx, "READ_USER", "user", ctx.principal.uid))) return;
    send(ctx, 200, { projects: await projects.listProjects(pool, ctx.principal.uid) });
  }

  async function getProject(ctx, projectId) {
    if (!(await limit(ctx, "READ_USER", "user", ctx.principal.uid))) return;
    const m = await authorize(ctx, projectId, "VIEWER");
    if (!m) return;
    send(ctx, 200, m);
  }

  async function putMember(ctx, projectId, targetUid) {
    if (!UID_RE.test(targetUid)) return fail(ctx, 400, "INVALID_USER_ID", "Invalid user id.");
    if (!(await limit(ctx, "WRITE_USER", "user", ctx.principal.uid))) return;
    const body = await readBody(ctx);
    if (!body) return;
    if (!projects.ROLES.includes(body.role)) return fail(ctx, 400, "INVALID_ROLE", `\`role\` must be one of ${projects.ROLES.join(", ")}.`);
    const m = await authorize(ctx, projectId, "OWNER");
    if (!m) return;
    try {
      await projects.setMember(pool, { projectId, targetUserId: targetUid, role: body.role, actingUserId: ctx.principal.uid });
    } catch (e) {
      if (e instanceof projects.LastOwnerError) return fail(ctx, 409, "LAST_OWNER", "A project must keep at least one OWNER.");
      throw e;
    }
    send(ctx, 200, { projectId, userId: targetUid, role: body.role });
  }

  async function postCopilot(ctx) {
    if (!(await limit(ctx, "COPILOT_USER", "user", ctx.principal.uid))) return;
    const body = await readBody(ctx);
    if (!body) return;

    let scope;
    if (body.projectId !== undefined) {
      if (typeof body.projectId !== "string" || !projects.ID_RE.test(body.projectId)) return fail(ctx, 400, "INVALID_PROJECT_ID", "`projectId` is invalid.");
      const m = await authorize(ctx, body.projectId, "VIEWER");
      if (!m) return;
      scope = { tenantId: m.tenantId, projectId: m.projectId };
    } else {
      // no project: the caller's personal scope. Never shared with anyone else (cache key and limits are per user).
      scope = { tenantId: projects.personalTenant(ctx.principal.uid), projectId: "none" };
    }

    if (!(await limit(ctx, "COPILOT_TENANT", "tenant", scope.tenantId))) return;
    if (!(await limit(ctx, "COPILOT_USER_DAILY", "user", ctx.principal.uid))) return;
    if (!(await limit(ctx, "COPILOT_TENANT_DAILY", "tenant", scope.tenantId))) return;

    const result = await runCopilot(body, scope, { env, telemetry, replicaId, cache, client, logger, now });
    send(ctx, result.httpStatus, result.body);
  }

  async function postAnalysis(ctx) {
    if (!(await limit(ctx, "ANALYSIS_USER", "user", ctx.principal.uid))) return;
    const body = await readBody(ctx);
    if (!body) return;

    if (typeof body.projectId !== "string" || !projects.ID_RE.test(body.projectId)) return fail(ctx, 400, "INVALID_PROJECT_ID", "`projectId` is required.");
    const idemRaw = ctx.req.headers["idempotency-key"];
    let idempotencyKey = null;
    if (idemRaw !== undefined) {
      if (typeof idemRaw !== "string" || !IDEMPOTENCY_RE.test(idemRaw)) return fail(ctx, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 1-128 characters of [A-Za-z0-9_.:-].");
      idempotencyKey = idemRaw;
    }

    const validated = validateRequest({ query: typeof body.query === "string" && body.query.trim() ? body.query : ANALYSIS_QUESTION, paperId: body.paperId, paperIds: body.paperIds, evidenceChunks: body.evidenceChunks, analysisDepth: body.analysisDepth });
    if (!validated.ok) return fail(ctx, 400, validated.error, validated.message);
    if (validated.value.chunks.length === 0) {
      return fail(ctx, 422, "NO_PAPER_CONTENT", "No paper content was supplied. Supply `evidenceChunks`; retrieval by paperId alone is not available yet.");
    }

    const m = await authorize(ctx, body.projectId, "EDITOR");
    if (!m) return;
    if (!(await limit(ctx, "ANALYSIS_TENANT", "tenant", m.tenantId))) return;
    if (!(await limit(ctx, "ANALYSIS_USER_DAILY", "user", ctx.principal.uid))) return;
    if (!(await limit(ctx, "ANALYSIS_TENANT_DAILY", "tenant", m.tenantId))) return;

    const { job, created, enqueued } = await jobStore.createJob({
      projectId: m.projectId,
      tenantId: m.tenantId,
      userId: ctx.principal.uid,
      paperId: validated.value.paperId,
      request: validated.value,
      idempotencyKey,
      replicaId
    });
    const extra = created ? {} : { "Idempotent-Replay": "true" };
    send(ctx, created ? 202 : 200, { ...job, result: undefined, pollUrl: `/api/v1/analysis/${job.jobId}`, replicaId, queue: created ? { enqueued } : undefined, idempotentReplay: created ? undefined : true, requestId: ctx.requestId }, extra);
  }

  async function loadJobFor(ctx, jobId, minRole) {
    if (!JOB_ID_RE.test(jobId)) {
      fail(ctx, 404, "JOB_NOT_FOUND", "Job not found.");
      return null;
    }
    const row = await jobStore.getJob(jobId);
    // 404 for "does not exist" and "not yours" alike, so job ids cannot be probed
    const m = row ? await projects.getMembership(pool, row.project_id, ctx.principal.uid) : null;
    if (!row || !m || projects.ROLE_RANK[m.role] < projects.ROLE_RANK[minRole]) {
      fail(ctx, 404, "JOB_NOT_FOUND", "Job not found.");
      return null;
    }
    return row;
  }

  async function getAnalysis(ctx, jobId) {
    if (!(await limit(ctx, "READ_USER", "user", ctx.principal.uid))) return;
    const row = await loadJobFor(ctx, jobId, "VIEWER");
    if (!row) return;
    send(ctx, 200, { ...toView(row), servedByReplica: replicaId });
  }

  async function cancelAnalysis(ctx, jobId) {
    if (!(await limit(ctx, "WRITE_USER", "user", ctx.principal.uid))) return;
    const row = await loadJobFor(ctx, jobId, "EDITOR");
    if (!row) return;
    const { row: after, outcome } = await jobStore.cancelJob(jobId);
    send(ctx, 200, { ...toView(after), outcome, servedByReplica: replicaId });
  }

  // ---------- routing ----------
  function route(method, pathname) {
    const seg = pathname.split("/").filter(Boolean);
    const is = (...parts) => parts.length === seg.length && parts.every((p, i) => p === "*" || p === seg[i]);
    if (method === "GET" && seg.length === 0) return { name: "root", public: true, run: getRoot };
    if (method === "GET" && is("health")) return { name: "health", public: true, noLimit: true, run: getHealth };
    if (method === "GET" && is("ready")) return { name: "ready", public: true, noLimit: true, run: getReady };
    if (method === "GET" && is("api", "v1", "replica")) return { name: "replica", public: true, run: getReplica };
    if (method === "GET" && is("api", "v1", "llm", "health")) return { name: "llm_health", run: getLlmHealth };
    if (method === "GET" && is("api", "v1", "llm", "metrics")) return { name: "llm_metrics", run: getLlmMetrics };
    if (method === "POST" && is("api", "v1", "projects")) return { name: "project_create", post: true, run: postProject };
    if (method === "GET" && is("api", "v1", "projects")) return { name: "project_list", run: listMyProjects };
    if (method === "GET" && is("api", "v1", "projects", "*")) return { name: "project_get", run: (c) => getProject(c, seg[3]) };
    if (method === "PUT" && is("api", "v1", "projects", "*", "members", "*")) return { name: "project_member_set", post: true, run: (c) => putMember(c, seg[3], seg[5]) };
    if (method === "POST" && is("api", "v1", "copilot", "query")) return { name: "copilot_query", post: true, run: postCopilot };
    if (method === "POST" && is("api", "v1", "analysis")) return { name: "analysis_create", post: true, run: postAnalysis };
    if (method === "GET" && is("api", "v1", "analysis", "*")) return { name: "analysis_get", run: (c) => getAnalysis(c, seg[3]) };
    if (method === "POST" && is("api", "v1", "analysis", "*", "cancel")) return { name: "analysis_cancel", post: true, run: (c) => cancelAnalysis(c, seg[3]) };
    return null;
  }

  async function handler(req, res) {
    const started = now();
    const requestId = `req_${started.toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const ctx = {
      req,
      res,
      requestId,
      headers: { "X-Replica-Id": replicaId, "X-Request-Id": requestId, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
      ip: clientIp(req, { trustProxy, hops: proxyHops }),
      closeAfter: false,
      principal: null,
      status: 0
    };
    let routeName = "unmatched";
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const method = req.method || "GET";

      const cors = evaluateCors(corsConfig, req.headers.origin);
      if (cors.present && !cors.allowed) {
        routeName = "cors_rejected";
        ctx.closeAfter = method !== "GET";
        return fail(ctx, 403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.", cors.headers);
      }
      Object.assign(ctx.headers, cors.headers);

      if (method === "OPTIONS") {
        routeName = "preflight";
        res.writeHead(204, ctx.headers);
        ctx.status = 204;
        return res.end();
      }

      const r = route(method, url.pathname);
      if (!r) {
        ctx.closeAfter = method !== "GET";
        return fail(ctx, 404, "NOT_FOUND", "No such route.");
      }
      routeName = r.name;
      if (r.post) ctx.closeAfter = false;

      if (!r.noLimit && !(await limit(ctx, "GLOBAL_IP", "ip", ctx.ip))) return;
      if (!r.public && !(await authenticate(ctx))) return;
      await r.run(ctx);
    } catch (err) {
      const category = err && err.code ? err.code : "UNEXPECTED";
      const dependency = err && /^(PG_|REDIS_)/.test(String(err.code || ""));
      logger.error(`[API] ${routeName} failed: category=${category} ${dependency ? "" : String((err && err.message) || err).slice(0, 200)}`);
      if (!res.headersSent) {
        if (dependency) fail(ctx, 503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable. Please retry shortly.", { "Retry-After": "5" });
        else fail(ctx, 500, "INTERNAL_ERROR", "Something went wrong. Reference this requestId when reporting it.");
      }
    } finally {
      bumpHttp(routeName, ctx.status || 0);
      if (logRequests) {
        logger.log(JSON.stringify({ t: new Date(now()).toISOString(), evt: "http", id: requestId, route: routeName, status: ctx.status, ms: now() - started, rid: replicaId, uid: ctx.principal ? crypto.createHash("sha256").update(ctx.principal.uid).digest("hex").slice(0, 10) : null }));
      }
    }
  }

  handler.httpStats = () => httpStats;
  return handler;
}

module.exports = { createApp };
