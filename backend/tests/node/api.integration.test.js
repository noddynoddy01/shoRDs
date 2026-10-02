"use strict";
/**
 * HTTP-level tests of the real runtime (real PostgreSQL + Redis, real RS256 verification, real rate limiting).
 * Covers: authentication, authorization, input validation, body size, CORS, rate limiting, readiness, safe errors.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { startReplica, makeKeyPair, tokenFor, signJwt, firebasePayload, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY, TEST_PROJECT_ID } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("api-key");
const tok = (uid, over) => tokenFor(keys, uid, over);

const CHUNKS = (paperId) => [
  { chunkId: "c1", paperId, section: "Methods", page: 2, text: "We randomised 120 participants to two arms and measured systolic blood pressure at 12 weeks." },
  { chunkId: "c2", paperId, section: "Results", page: 5, text: "Mean systolic pressure fell by 8.1 mmHg in the treatment arm versus 2.3 mmHg in control." }
];

// A stub model client: counts calls, returns a well-formed Sonnet 5.5 style result. Never touches the network.
function stubClient(text = "Systolic pressure fell more in the treatment arm [c2].") {
  const calls = [];
  return {
    calls,
    async callMessages(opts) {
      calls.push(opts);
      return { text, usage: { inputTokens: 700, outputTokens: 90, totalTokens: 790 }, stopReason: "end_turn", truncated: false, model: opts.model, latencyMs: 5, attempts: 1, requestId: "req_stub", costUsd: 0.0023, costStatus: "ESTIMATED" };
    }
  };
}

test("API (real runtime, real PostgreSQL + Redis)", { skip }, async (t) => {
  await resetInfra();
  const client = stubClient();
  const A = await startReplica({ keys, overrides: { client }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, ADMIN_UIDS: "admin-1" } });
  t.after(() => A.close());
  const alice = uniq("alice-"), bob = uniq("bob-"), carol = uniq("carol-");
  const ip = () => ({ headers: ipHeader() });

  const mkProject = async (uid, name = "P") => (await A.call("POST", "/api/v1/projects", { token: tok(uid), body: { name }, ...ip() })).json;

  await t.test("public routes need no token; /health is liveness only", async () => {
    for (const p of ["/", "/health", "/api/v1/replica"]) assert.equal((await A.call("GET", p, ip())).status, 200, p);
    const h = (await A.call("GET", "/health", ip())).json;
    assert.deepEqual(Object.keys(h).sort(), ["replicaId", "status", "timestamp"]);
  });

  await t.test("authentication: every protected route rejects a missing token, a random string and a forged token", async () => {
    const routes = [["GET", "/api/v1/projects"], ["POST", "/api/v1/projects"], ["GET", "/api/v1/projects/prj_x"], ["PUT", "/api/v1/projects/prj_x/members/u"], ["POST", "/api/v1/copilot/query"], ["POST", "/api/v1/analysis"], ["GET", "/api/v1/analysis/job_x"], ["POST", "/api/v1/analysis/job_x/cancel"], ["GET", "/api/v1/llm/health"], ["GET", "/api/v1/llm/metrics"]];
    const wrongKey = signJwt({ privateKey: makeKeyPair("api-key").privateKey, kid: "api-key", payload: firebasePayload(alice) });
    const expired = tok(alice, { exp: Math.floor(Date.now() / 1000) - 7200, iat: Math.floor(Date.now() / 1000) - 10000 });
    const wrongAud = tok(alice, { aud: "someone-elses-project" });
    for (const [m, p] of routes) {
      const body = m === "GET" ? undefined : {};
      for (const [label, headers] of [["no header", {}], ["random string", { authorization: "something" }], ["legacy fixture token", { authorization: "Bearer test_token_usr_A" }], ["Basic scheme", { authorization: "Basic YTpi" }], ["forged signature", { authorization: `Bearer ${wrongKey}` }], ["expired", { authorization: `Bearer ${expired}` }], ["wrong audience", { authorization: `Bearer ${wrongAud}` }]]) {
        const r = await A.call(m, p, { body, headers: { ...headers, ...ipHeader() } });
        assert.equal(r.status, 401, `${m} ${p} with ${label} -> ${r.status}`);
        assert.equal(r.headers["www-authenticate"], 'Bearer realm="shords"');
        assert.ok(!/stack|at \w+ \(/.test(r.text), "no stack traces");
      }
    }
  });

  await t.test("a valid token authenticates (and the response is not a 401)", async () => {
    const r = await A.call("GET", "/api/v1/projects", { token: tok(alice), ...ip() });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projects, []);
  });

  await t.test("authentication throttling: repeated failures from one IP are refused (429), other IPs unaffected", async () => {
    const R = await startReplica({ keys, env: { RATE_LIMIT_AUTH_FAIL_IP: "3/60" } });
    const badIp = ipHeader();
    for (let i = 0; i < 3; i++) assert.equal((await R.call("GET", "/api/v1/projects", { headers: { ...badIp, authorization: "Bearer nope.nope.nope" } })).status, 401);
    const blocked = await R.call("GET", "/api/v1/projects", { token: tok(alice), headers: badIp });
    assert.equal(blocked.status, 429, "even a valid token is refused from an IP that is brute-forcing");
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    assert.equal((await R.call("GET", "/api/v1/projects", { token: tok(alice), headers: ipHeader() })).status, 200);
    await R.close();
  });

  await t.test("authentication not configured: protected routes fail closed with 503, nothing is let through", async () => {
    const R = await startReplica({ env: { FIREBASE_PROJECT_ID: undefined } });
    for (const h of [{}, { authorization: "Bearer " + tok(alice) }, { authorization: "anything" }]) {
      const r = await R.call("POST", "/api/v1/copilot/query", { body: { query: "q", paperId: "p" }, headers: { ...h, ...ipHeader() } });
      assert.ok([401, 503].includes(r.status) && r.status !== 200, String(r.status));
    }
    const r = await R.call("GET", "/api/v1/projects", { token: tok(alice), ...ip() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "AUTH_NOT_CONFIGURED");
    await R.close();
  });

  await t.test("authorization: project membership and roles", async () => {
    const p = await mkProject(alice, "Alpha");
    assert.equal(p.role, "OWNER");
    assert.match(p.projectId, /^prj_[0-9a-f]{18}$/);
    // non-member
    assert.equal((await A.call("GET", `/api/v1/projects/${p.projectId}`, { token: tok(bob), ...ip() })).status, 403);
    const ask = (uid, body = { query: "What was measured?", paperId: "paper-1", evidenceChunks: CHUNKS("paper-1") }) => A.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: { projectId: p.projectId, ...body }, ...ip() });
    assert.equal((await ask(bob)).status, 403, "non-member cannot query the project");
    assert.equal((await ask(alice)).status, 200);
    // add bob as VIEWER; carol stays outside
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${bob}`, { token: tok(alice), body: { role: "VIEWER" }, ...ip() })).status, 200);
    assert.equal((await ask(bob)).status, 200, "viewer can query");
    assert.equal((await ask(carol)).status, 403);
    // viewer cannot create analysis jobs or change members
    const create = (uid, body) => A.call("POST", "/api/v1/analysis", { token: tok(uid), body: { projectId: p.projectId, paperId: "paper-1", evidenceChunks: CHUNKS("paper-1"), ...body }, ...ip() });
    assert.equal((await create(bob)).status, 403);
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${carol}`, { token: tok(bob), body: { role: "VIEWER" }, ...ip() })).status, 403);
    // COMMENTER still cannot; EDITOR can create but still cannot manage members
    await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${bob}`, { token: tok(alice), body: { role: "COMMENTER" }, ...ip() });
    assert.equal((await create(bob)).status, 403);
    await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${bob}`, { token: tok(alice), body: { role: "EDITOR" }, ...ip() });
    assert.equal((await create(bob)).status, 202);
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${carol}`, { token: tok(bob), body: { role: "VIEWER" }, ...ip() })).status, 403);
    // invalid role / bad user id / last owner
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${carol}`, { token: tok(alice), body: { role: "GOD" }, ...ip() })).status, 400);
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${encodeURIComponent("a b;")}`, { token: tok(alice), body: { role: "VIEWER" }, ...ip() })).status, 400);
    const demote = await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${alice}`, { token: tok(alice), body: { role: "VIEWER" }, ...ip() });
    assert.equal(demote.status, 409);
    assert.equal(demote.json.error, "LAST_OWNER");
    // listing shows only my projects
    assert.deepEqual((await A.call("GET", "/api/v1/projects", { token: tok(carol), ...ip() })).json.projects, []);
  });

  await t.test("the old 'unauthorized_project_B' hook is gone: that string has no special meaning anywhere in production code", async () => {
    const r = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { projectId: "unauthorized_project_B", query: "q", paperId: "p" }, ...ip() });
    const r2 = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { projectId: "prj_doesnotexist0000000", query: "q", paperId: "p" }, ...ip() });
    assert.equal(r.status, 403);
    assert.deepEqual({ ...r.json, requestId: 0 }, { ...r2.json, requestId: 0 }, "indistinguishable from any other project the caller has no access to");
    const root = path.resolve(__dirname, "../..");
    const offenders = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "tests" && e.name !== "node_modules") walk(f); }
        else if (/\.(js|ts)$/.test(e.name) && fs.readFileSync(f, "utf8").includes("unauthorized_project_B")) offenders.push(path.relative(root, f));
      }
    })(root);
    assert.deepEqual(offenders, [], "no production source mentions the hook");
  });

  await t.test("jobs are invisible across projects and tenants (404, not 403, so ids cannot be probed)", async () => {
    const p = await mkProject(alice, "Private");
    const created = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: "paper-9", evidenceChunks: CHUNKS("paper-9") }, ...ip() });
    assert.equal(created.status, 202);
    const id = created.json.jobId;
    assert.equal((await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(alice), ...ip() })).status, 200);
    assert.equal((await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(bob), ...ip() })).status, 404);
    assert.equal((await A.call("POST", `/api/v1/analysis/${id}/cancel`, { token: tok(bob), ...ip() })).status, 404);
    assert.equal((await A.call("GET", `/api/v1/analysis/job_${"0".repeat(24)}`, { token: tok(alice), ...ip() })).status, 404);
    assert.equal((await A.call("GET", `/api/v1/analysis/not-a-job-id`, { token: tok(alice), ...ip() })).status, 404);
    // a viewer can read but not cancel
    await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${bob}`, { token: tok(alice), body: { role: "VIEWER" }, ...ip() });
    assert.equal((await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(bob), ...ip() })).status, 200);
    assert.equal((await A.call("POST", `/api/v1/analysis/${id}/cancel`, { token: tok(bob), ...ip() })).status, 404);
  });

  await t.test("admin-only operational endpoints", async () => {
    assert.equal((await A.call("GET", "/api/v1/llm/health", { token: tok(alice), ...ip() })).status, 403);
    assert.equal((await A.call("GET", "/api/v1/llm/metrics", { token: tok(alice), ...ip() })).status, 403);
    const h = await A.call("GET", "/api/v1/llm/health", { token: tok("admin-1"), ...ip() });
    assert.equal(h.status, 200);
    assert.ok(!JSON.stringify(h.json).includes(FAKE_ANTHROPIC_KEY));
    const m = await A.call("GET", "/api/v1/llm/metrics", { token: tok("admin-1"), ...ip() });
    assert.equal(m.status, 200);
    assert.equal(m.json.runtimeComponents.rateLimiter, "WIRED");
    assert.equal(m.json.runtimeComponents.cache, "WIRED");
    assert.ok(m.json.http.requests > 0);
  });

  await t.test("input validation and body-size protection", async () => {
    const p = await mkProject(alice, "V");
    const ask = (body, extra = {}) => A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body, ...ip(), ...extra });
    assert.equal((await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), rawBody: "{not json", headers: { "content-type": "application/json", ...ipHeader() } })).json.error, "INVALID_JSON");
    assert.equal((await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), rawBody: "[1,2]", headers: { "content-type": "application/json", ...ipHeader() } })).status, 400);
    assert.equal((await ask({ paperId: "p" })).json.error, "INVALID_QUERY");
    assert.equal((await ask({ query: "q" })).json.error, "PAPER_ID_REQUIRED");
    assert.equal((await ask({ query: "q", paperId: "bad id with spaces" })).json.error, "INVALID_PAPER_ID");
    assert.equal((await ask({ query: "q", paperId: "p", projectId: { $ne: 1 } })).json.error, "INVALID_PROJECT_ID");
    assert.equal((await ask({ query: "q", paperId: "p", projectId: "x'; DROP TABLE projects;--" })).json.error, "INVALID_PROJECT_ID");
    assert.equal((await ask({ query: "q", paperId: "p", evidenceChunks: [{ chunkId: "c", paperId: "OTHER", text: "t" }] })).json.error, "EVIDENCE_PAPER_MISMATCH");
    const noContent = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: "paper-1" }, ...ip() });
    assert.equal(noContent.status, 422);
    assert.equal(noContent.json.error, "NO_PAPER_CONTENT");
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { paperId: "paper-1", evidenceChunks: CHUNKS("paper-1") }, ...ip() })).json.error, "INVALID_PROJECT_ID");
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: "paper-1", evidenceChunks: CHUNKS("paper-1") }, headers: { "idempotency-key": "bad key!", ...ipHeader() } })).json.error, "INVALID_IDEMPOTENCY_KEY");
    assert.equal((await A.call("POST", "/api/v1/projects", { token: tok(alice), body: { name: "" }, ...ip() })).json.error, "INVALID_NAME");
    assert.equal((await A.call("POST", "/api/v1/projects", { token: tok(alice), body: { name: "x".repeat(121) }, ...ip() })).json.error, "INVALID_NAME");
    assert.equal((await A.call("GET", "/nope", ip())).status, 404);
    assert.equal((await A.call("DELETE", "/api/v1/projects", { token: tok(alice), ...ip() })).status, 404);
  });

  await t.test("body size: oversize is refused up front (Content-Length) and while streaming (chunked), on every POST route", async () => {
    const S = await startReplica({ keys, env: { MAX_REQUEST_BODY_BYTES: "2000" } });
    const big = JSON.stringify({ query: "q", paperId: "p", pad: "x".repeat(5000) });
    for (const p of ["/api/v1/copilot/query", "/api/v1/analysis", "/api/v1/projects"]) {
      const r = await S.call("POST", p, { token: tok(alice), rawBody: big, headers: { "content-type": "application/json", ...ipHeader() } });
      assert.equal(r.status, 413, p);
      assert.equal(r.json.error, "REQUEST_TOO_LARGE");
    }
    // a declared Content-Length over the cap is refused immediately, before any body bytes are read
    const early = await new Promise((resolve) => {
      const u = new URL(S.base);
      const sock = require("net").connect(Number(u.port), u.hostname, () => {
        sock.write(`POST /api/v1/copilot/query HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${tok(alice)}\r\nContent-Type: application/json\r\nContent-Length: 50000000\r\nX-Forwarded-For: 6.6.6.6, ${"198.51.100." + Math.floor(Math.random() * 250) + "." + Date.now() % 100000}\r\n\r\n`);
      });
      let data = "";
      const timer = setTimeout(() => { sock.destroy(); resolve("NO_RESPONSE_WITHOUT_BODY"); }, 1500);
      sock.on("data", (d) => { data += d; if (/\r\n\r\n/.test(data)) { clearTimeout(timer); sock.destroy(); resolve(data.split("\r\n")[0]); } });
      sock.on("error", () => {});
    });
    assert.match(early, /413/, `declared oversize body: ${early}`);
    // chunked upload without a Content-Length
    const status = await new Promise((resolve, reject) => {
      const u = new URL(S.base);
      const req = http.request({ host: u.hostname, port: u.port, path: "/api/v1/copilot/query", method: "POST", headers: { authorization: `Bearer ${tok(alice)}`, "content-type": "application/json", "transfer-encoding": "chunked", ...ipHeader() } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", (e) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve("closed") : reject(e)));
      req.write('{"query":"q","paperId":"p","pad":"');
      for (let i = 0; i < 6; i++) req.write("y".repeat(1000));
      req.end('"}');
    });
    assert.ok(status === 413 || status === "closed", `chunked oversize -> ${status}`);
    await S.close();
  });

  await t.test("safe errors: dependency outage -> 503 without internals; unexpected exception -> 500 without internals", async () => {
    const dead = await startReplica({ keys, env: { DATABASE_URL: "postgresql://svc:hunter2pass@127.0.0.1:1/shords_secret_db" } });
    const r = await dead.call("GET", "/api/v1/projects", { token: tok(alice), ...ip() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "DEPENDENCY_UNAVAILABLE");
    for (const leak of ["hunter2pass", "shords_secret_db", "127.0.0.1", "svc"]) assert.ok(!r.text.includes(leak), leak);
    await dead.close();

    const p = await mkProject(alice, "E");
    const created = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: "paper-1", evidenceChunks: CHUNKS("paper-1") }, ...ip() });
    const original = A.runtime.jobStore.getJob;
    A.runtime.jobStore.getJob = async () => { throw new Error("SECRET-INTERNAL-DETAIL at /srv/app/db.js:12"); };
    const boom = await A.call("GET", `/api/v1/analysis/${created.json.jobId}`, { token: tok(alice), ...ip() });
    A.runtime.jobStore.getJob = original;
    assert.equal(boom.status, 500);
    assert.equal(boom.json.error, "INTERNAL_ERROR");
    assert.ok(!boom.text.includes("SECRET-INTERNAL-DETAIL") && !boom.text.includes("/srv/app"));
    assert.match(boom.json.requestId, /^req_/);
  });

  await t.test("CORS over HTTP: allowed origin echoed, disallowed rejected, preflight, no-origin, never '*'", async () => {
    const allowed = await A.call("GET", "/health", { headers: { origin: "https://shords.test", ...ipHeader() } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://shords.test");
    assert.equal(allowed.headers["vary"], "Origin");
    const bad = await A.call("GET", "/health", { headers: { origin: "https://evil.example", ...ipHeader() } });
    assert.equal(bad.status, 403);
    assert.equal(bad.json.error, "ORIGIN_NOT_ALLOWED");
    assert.equal(bad.headers["access-control-allow-origin"], undefined);
    const badPost = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { query: "q", paperId: "p" }, headers: { origin: "https://evil.example", ...ipHeader() } });
    assert.equal(badPost.status, 403, "a hostile page cannot cause a state-changing request to run");
    const pre = await A.call("OPTIONS", "/api/v1/copilot/query", { headers: { origin: "https://shords.test", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type", ...ipHeader() } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], "https://shords.test");
    assert.match(pre.headers["access-control-allow-headers"], /Authorization/i);
    assert.equal((await A.call("OPTIONS", "/api/v1/copilot/query", { headers: { origin: "https://evil.example", ...ipHeader() } })).status, 403);
    const none = await A.call("GET", "/health", ip());
    assert.equal(none.status, 200);
    assert.equal(none.headers["access-control-allow-origin"], undefined);
    for (const r of [allowed, bad, pre, none]) assert.notEqual(r.headers["access-control-allow-origin"], "*");
    // development configuration (CORS_ORIGINS unset): localhost allowed, others not
    const dev = await startReplica({ env: { NODE_ENV: "development", CORS_ORIGINS: undefined } });
    assert.equal((await dev.call("GET", "/health", { headers: { origin: "http://localhost:8081", ...ipHeader() } })).headers["access-control-allow-origin"], "http://localhost:8081");
    assert.equal((await dev.call("GET", "/health", { headers: { origin: "https://evil.example", ...ipHeader() } })).status, 403);
    await dev.close();
    // production with no CORS_ORIGINS: even the web app origin is refused until configured
    const prodNone = await startReplica({ env: { CORS_ORIGINS: undefined } });
    assert.equal((await prodNone.call("GET", "/health", { headers: { origin: "https://shords.vercel.app", ...ipHeader() } })).status, 403);
    await prodNone.close();
  });
});
