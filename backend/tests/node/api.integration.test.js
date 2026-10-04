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
const { modelStub, startReplica, makeKeyPair, tokenFor, signJwt, firebasePayload, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY, TEST_PROJECT_ID } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("api-key");
const tok = (uid, over) => tokenFor(keys, uid, over);

const fx = require("./paperFixtures");
const PAPER = `doi:${fx.FIXTURE_DOI}`; // FULL_TEXT in the fixture web
const PAPER_ABSTRACT_ONLY = `doi:${fx.DOI_ABSTRACT}`;
const PAPER_META_ONLY = `doi:${fx.DOI_META}`;
const PAPER_MISSING = `doi:${fx.DOI_MISSING}`;

test("API (real runtime, real PostgreSQL + Redis)", { skip }, async (t) => {
  await resetInfra();
  const client = modelStub();
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

  await t.test("authentication throttling: forged-token floods from one IP are refused (429) without locking out a legitimate user behind the same IP", async () => {
    const R = await startReplica({ keys, env: { RATE_LIMIT_AUTH_FAIL_IP: "3/60" } });
    const badIp = ipHeader();
    for (let i = 0; i < 3; i++) assert.equal((await R.call("GET", "/api/v1/projects", { headers: { ...badIp, authorization: "Bearer nope.nope.nope" } })).status, 401);
    const blocked = await R.call("GET", "/api/v1/projects", { headers: { ...badIp, authorization: "Bearer nope.nope.nope" } });
    assert.equal(blocked.status, 429, "the flood is refused");
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    assert.equal((await R.call("GET", "/api/v1/projects", { headers: badIp })).status, 429, "no credential at all from a flooding IP is refused too");
    // A real user behind the same (shared / NAT) address is not collateral damage: a valid token is still accepted.
    assert.equal((await R.call("GET", "/api/v1/projects", { token: tok(alice), headers: badIp })).status, 200);
    assert.equal((await R.call("GET", "/api/v1/projects", { token: tok(alice), headers: ipHeader() })).status, 200);
    await R.close();
  });

  await t.test("authentication throttling: expired tokens and missing headers are not counted as guessing", async () => {
    const R = await startReplica({ keys, env: { RATE_LIMIT_AUTH_FAIL_IP: "3/60" } });
    const ip = ipHeader();
    const now = Date.now();
    const expired = tokenFor(keys, alice, { iat: Math.floor(now / 1000) - 7200, exp: Math.floor(now / 1000) - 3600 }, now);
    for (let i = 0; i < 6; i++) {
      assert.equal((await R.call("GET", "/api/v1/projects", { headers: { ...ip, authorization: `Bearer ${expired}` } })).status, 401, `expired #${i}`);
      assert.equal((await R.call("GET", "/api/v1/projects", { headers: ip })).status, 401, `missing #${i}`);
    }
    assert.equal((await R.call("GET", "/api/v1/projects", { token: tok(alice), headers: ip })).status, 200, "still not blocked");
    // wrong-audience tokens (another Firebase project) ARE counted
    const other = tokenFor(keys, alice, { aud: "another-project", iss: "https://securetoken.google.com/another-project" }, now);
    for (let i = 0; i < 3; i++) assert.equal((await R.call("GET", "/api/v1/projects", { headers: { ...ip, authorization: `Bearer ${other}` } })).status, 401);
    assert.equal((await R.call("GET", "/api/v1/projects", { headers: { ...ip, authorization: `Bearer ${other}` } })).status, 429);
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
    const ask = (uid, body = { query: "What was measured?", paperId: PAPER }) => A.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: { projectId: p.projectId, ...body }, ...ip() });
    assert.equal((await ask(bob)).status, 403, "non-member cannot query the project");
    assert.equal((await ask(alice)).status, 200);
    // add bob as VIEWER; carol stays outside
    assert.equal((await A.call("PUT", `/api/v1/projects/${p.projectId}/members/${bob}`, { token: tok(alice), body: { role: "VIEWER" }, ...ip() })).status, 200);
    assert.equal((await ask(bob)).status, 200, "viewer can query");
    assert.equal((await ask(carol)).status, 403);
    // viewer cannot create analysis jobs or change members
    const create = (uid, body) => A.call("POST", "/api/v1/analysis", { token: tok(uid), body: { projectId: p.projectId, paperId: PAPER, ...body }, ...ip() });
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
    const created = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: `doi:${fx.DOI_B}` }, ...ip() });
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
    // evidence is never accepted from a client, in any key, on either route
    for (const key of ["evidenceChunks", "chunks", "evidence", "sources", "context", "paperText", "text"]) {
      const r = await ask({ query: "q", paperId: PAPER, [key]: [{ chunkId: "c", paperId: "OTHER", text: "t" }] });
      assert.equal(r.status, 400, key);
      assert.equal(r.json.error, "EVIDENCE_NOT_ACCEPTED", key);
    }
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: PAPER, evidenceChunks: [] }, ...ip() })).json.error, "EVIDENCE_NOT_ACCEPTED");
    // chunk ids: malformed / foreign / unknown are refused before any model call
    const callsBefore = client.calls.length;
    assert.equal((await ask({ query: "q", paperId: PAPER, chunkIds: "c1" })).json.error, "INVALID_CHUNK_IDS");
    assert.equal((await ask({ query: "q", paperId: PAPER, chunkIds: ["not a chunk id"] })).json.error, "MALFORMED_CHUNK_ID");
    assert.equal((await ask({ query: "q", paperId: PAPER, chunkIds: [`doi:${fx.DOI_B}_chunk_1`] })).json.error, "EVIDENCE_PAPER_MISMATCH");
    assert.equal((await ask({ query: "q", paperId: PAPER, chunkIds: [`${PAPER}_chunk_9999`] })).json.error, "UNKNOWN_CHUNK");
    assert.equal((await ask({ query: "q", paperId: PAPER, chunkIds: Array.from({ length: 500 }, (_, i) => `${PAPER}_chunk_${i}`) })).json.error, "TOO_MANY_CHUNKS");
    assert.equal(client.calls.length, callsBefore, "rejected evidence requests never reach the model");
    const noContent = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: "not a paper!" }, ...ip() });
    assert.equal(noContent.status, 400);
    assert.equal(noContent.json.error, "INVALID_PAPER_ID");
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: PAPER, analysisDepth: "ULTRA" }, ...ip() })).json.error, "INVALID_ANALYSIS_DEPTH");
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { paperId: PAPER }, ...ip() })).json.error, "INVALID_PROJECT_ID");
    assert.equal((await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: PAPER }, headers: { "idempotency-key": "bad key!", ...ipHeader() } })).json.error, "INVALID_IDEMPOTENCY_KEY");
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
    const created = await A.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: PAPER }, ...ip() });
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

  await t.test("coverage gate over HTTP: CONTENT_UNAVAILABLE and METADATA_ONLY never call the model; ABSTRACT_ONLY says so; FULL_TEXT answers from server evidence", async () => {
    const before = client.calls.length;
    for (const [paper, cov] of [[PAPER_MISSING, "CONTENT_UNAVAILABLE"], [PAPER_META_ONLY, "METADATA_ONLY"]]) {
      const r = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { query: "What did they find?", paperId: paper }, ...ip() });
      assert.equal(r.status, 200, cov);
      assert.equal(r.json.contentCoverage, cov);
      assert.equal(r.json.aiCalled, false);
      assert.equal(r.json.verificationStatus, cov);
      assert.equal(r.json.tokens.costStatus, "NO_AI_CALL");
      assert.deepEqual(r.json.claims, []);
      assert.ok(r.json.coverageNotice && r.json.coverageNotice.length > 20);
    }
    assert.equal(client.calls.length, before, "no model call for content that is not available");
    const abs = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { query: "What did they find?", paperId: PAPER_ABSTRACT_ONLY }, ...ip() });
    assert.equal(abs.json.contentCoverage, "ABSTRACT_ONLY");
    assert.match(abs.json.coverageNotice, /abstract/i);
    assert.equal(client.calls.length, before + 1);
    assert.match(client.calls.at(-1).user, /ABSTRACT/);
    const full = await A.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { query: "How was training done?", paperId: PAPER }, ...ip() });
    assert.equal(full.json.contentCoverage, "FULL_TEXT");
    assert.equal(full.json.paper.paperId, PAPER);
    assert.notEqual(full.json.verificationStatus, "VERIFIED", "mechanical checks never earn VERIFIED");
    const sent = client.calls.at(-1).user;
    assert.ok(sent.includes(`${PAPER}_chunk_`), "the model received the server's own chunks for this paper");
    for (const c of full.json.evidence || []) assert.ok(String(c.chunkId).startsWith(`${PAPER}_chunk_`));
  });

  await t.test("analysis job for unavailable content fails truthfully and never calls the model", async () => {
    const A2 = await startReplica({ keys, worker: true, overrides: { client }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY } });
    A2.start();
    const p = await mkProject(alice, "Gate");
    const UNSEEN = "doi:10.9999/fixture.never.seen.2017"; // not in the fixture web and not yet in the paper store
    const created = await A2.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: UNSEEN }, ...ip() });
    assert.equal(created.status, 202);
    let job;
    for (let i = 0; i < 60; i++) {
      job = (await A2.call("GET", `/api/v1/analysis/${created.json.jobId}`, { token: tok(alice), ...ip() })).json;
      if (["FAILED", "COMPLETED"].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job.status, "FAILED");
    assert.equal(job.error.code, "CONTENT_UNAVAILABLE");
    // (this worker also drains jobs queued by earlier subtests, so assert on this paper, not on the total)
    assert.equal(client.calls.filter((c) => c.user.includes(UNSEEN)).length, 0, "no model call for the unavailable paper");
    // once the store knows, a second request is refused up front (422) with no job
    const again = await A2.call("POST", "/api/v1/analysis", { token: tok(alice), body: { projectId: p.projectId, paperId: UNSEEN }, ...ip() });
    assert.equal(again.status, 422);
    assert.equal(again.json.error, "CONTENT_UNAVAILABLE");
    assert.equal(again.json.aiCalled, false);
    await A2.close();
  });

  await t.test("paper routes: authentication, rate limits, canonical identity, abstract only (no chunk text)", async () => {
    for (const [m, pth, body] of [["POST", "/api/v1/papers/resolve", {}], ["GET", `/api/v1/papers/${encodeURIComponent(PAPER)}`, undefined]]) {
      assert.equal((await A.call(m, pth, { body, ...ip() })).status, 401, pth);
    }
    const r = await A.call("POST", "/api/v1/papers/resolve", { token: tok(alice), body: { paperId: fx.FIXTURE_DOI }, ...ip() });
    assert.equal(r.status, 200);
    assert.equal(r.json.paperId, PAPER, "a bare DOI resolves to the canonical id");
    assert.equal(r.json.coverage, "FULL_TEXT");
    assert.ok(!JSON.stringify(r.json).includes("_chunk_") || !("chunks" in r.json), "chunk text is not exposed by the paper route");
    assert.equal((await A.call("GET", `/api/v1/papers/${encodeURIComponent(PAPER)}`, { token: tok(bob), ...ip() })).json.paperId, PAPER);
    assert.equal((await A.call("POST", "/api/v1/papers/resolve", { token: tok(alice), body: { paperId: "not a paper" }, ...ip() })).json.error, "INVALID_PAPER_ID");
    assert.equal((await A.call("POST", "/api/v1/papers/resolve", { token: tok(alice), body: {}, ...ip() })).json.error, "PAPER_ID_REQUIRED");
    assert.equal((await A.call("GET", "/api/v1/papers/%E0%A4%A", { token: tok(alice), ...ip() })).json.error, "INVALID_PAPER_ID");
    const lim = await startReplica({ keys, env: { RATE_LIMIT_RETRIEVAL_USER: "2/60" } });
    const u = uniq("limited-");
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await lim.call("POST", "/api/v1/papers/resolve", { token: tok(u), body: { paperId: PAPER }, headers: ipHeader() })).status);
    assert.deepEqual(codes, [200, 200, 429]);
    await lim.close();
  });

  await t.test("scholarly outage -> retryable 503 with Retry-After, nothing cached as 'unavailable'", async () => {
    const fx2 = require("./paperFixtures");
    const down = fx2.createFixtureHttp({ fail: () => true });
    const R = await startReplica({ keys, overrides: { client, http: down } });
    const OUTAGE = "doi:10.9999/fixture.outage.2016"; // never stored, so the provider outage is actually hit
    const r = await R.call("POST", "/api/v1/copilot/query", { token: tok(alice), body: { query: "q", paperId: OUTAGE }, ...ip() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "RETRIEVAL_UNAVAILABLE");
    assert.ok(Number(r.headers["retry-after"]) > 0);
    const stored = await R.runtime.pool.query("SELECT count(*)::int AS n FROM papers WHERE paper_id = $1", [OUTAGE]);
    assert.equal(stored.rows[0].n, 0, "an outage is not recorded as 'no content'");
    assert.equal(client.calls.filter((c) => c.user.includes(OUTAGE)).length, 0);
    await R.close();
  });

  await t.test("usage ledger: one honest row per request (model call, cache hit, gated, rejected), no tokens/keys stored", async () => {
    await A.runtime.pool.query("DELETE FROM ai_usage");
    const L = await startReplica({ keys, overrides: { client: modelStub() }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY } });
    const u = uniq("ledger-");
    const q = (paperId, query = "What was the training setup?") => L.call("POST", "/api/v1/copilot/query", { token: tok(u), body: { query, paperId }, ...ip() });
    const first = await q(PAPER);
    const second = await q(PAPER);
    await q(PAPER_MISSING);
    await L.call("POST", "/api/v1/copilot/query", { token: tok(u), body: { query: "q", paperId: PAPER, text: "injected" }, ...ip() });
    assert.equal(first.json.cache.status, "MISS");
    assert.equal(second.json.cache.status, "HIT");
    const rows = (await L.runtime.pool.query("SELECT * FROM ai_usage ORDER BY id")).rows;
    assert.equal(rows.length, 3, "model call, cache hit and gated request are recorded; a request rejected before the AI path is not an AI request");
    const [r1, r2, r3] = rows;
    assert.equal(r1.provider, "anthropic");
    assert.equal(r1.ai_called, true);
    assert.equal(r1.cache_hit, false);
    assert.equal(r1.input_tokens, 1200);
    assert.equal(r1.output_tokens, 240);
    assert.equal(r1.total_tokens, 1440);
    assert.equal(r1.cost_usd, null, "no verified price in the stub => cost is not invented");
    assert.equal(r1.cost_status, "NOT_MEASURED");
    assert.equal(r1.paper_id, PAPER);
    assert.ok(r1.request_id && r1.duration_ms !== null && r1.model);
    assert.equal(r2.cache_hit, true);
    assert.equal(r2.ai_called, false);
    assert.equal(r2.input_tokens, null);
    assert.equal(r2.cost_status, "NO_NEW_SPEND");
    assert.equal(r3.ai_called, false);
    assert.equal(r3.coverage, "CONTENT_UNAVAILABLE");
    assert.equal(r3.cost_status, "NO_AI_CALL");
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes(FAKE_ANTHROPIC_KEY) && !dump.includes(tok(u).slice(0, 40)) && !dump.includes(u), "no key, token or raw uid in the ledger");
    const m = await A.call("GET", "/api/v1/llm/metrics", { token: tok("admin-1"), ...ip() });
    assert.ok(m.json.usage && Array.isArray(m.json.usage.rows));
    await L.close();
  });
});
