"use strict";
/** Redis-backed rate limiting on the real request path: real Redis, real HTTP, two replicas sharing counters. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");
const { createRateLimiter, loadPolicies } = require("../../security/rateLimit");
const { RedisClient } = require("../../data/redisClient");
const { INFRA } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("rl-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAPER = `doi:${fx.FIXTURE_DOI}`;
const ASK = { query: "What does it say?", paperId: PAPER };

function stub() {
  const m = modelStub();
  return { get calls() { return m.calls.length; }, callMessages: (o) => m.callMessages(o) };
}
// AI_CACHE_ENABLED=false: these tests count requests, not answers; a cache hit would still be limited, but keep them independent
const baseEnv = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "false" };

test("rate limiting (real Redis)", { skip }, async (t) => {
  await resetInfra();

  await t.test("per-user limit on copilot: N pass, N+1 is 429 with Retry-After; other users unaffected; limits come from env", async () => {
    const R = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, RATE_LIMIT_COPILOT_USER: "3/60" } });
    const u = uniq("u-"), other = uniq("u-"), ip = ipHeader();
    const ask = (uid) => R.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: ASK, headers: ip });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await ask(u)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const limited = await ask(u);
    assert.equal(limited.json.error, "RATE_LIMITED");
    assert.ok(Number(limited.headers["retry-after"]) >= 1 && Number(limited.headers["retry-after"]) <= 60);
    assert.equal(limited.headers["ratelimit-limit"], "3");
    assert.equal(limited.headers["ratelimit-remaining"], "0");
    assert.equal((await ask(other)).status, 200, "a different user has their own budget");
    await R.close();
  });

  await t.test("the limit is shared across replicas (counters live in Redis, not in process memory)", async () => {
    const env = { ...baseEnv, RATE_LIMIT_COPILOT_USER: "4/60" };
    const A = await startReplica({ keys, overrides: { client: stub() }, env });
    const B = await startReplica({ keys, overrides: { client: stub() }, env });
    const u = uniq("u-"), ip = ipHeader();
    const ask = (R) => R.call("POST", "/api/v1/copilot/query", { token: tok(u), body: ASK, headers: ip });
    const codes = [(await ask(A)).status, (await ask(B)).status, (await ask(A)).status, (await ask(B)).status, (await ask(A)).status, (await ask(B)).status];
    assert.deepEqual(codes, [200, 200, 200, 200, 429, 429], "4 allowed in total across both replicas, not 4 per replica");
    await A.close(); await B.close();
  });

  await t.test("per-tenant limit: members of one project share a budget even when each user is well under their own limit", async () => {
    const R = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, RATE_LIMIT_COPILOT_TENANT: "3/60" } });
    const alice = uniq("alice-"), bob = uniq("bob-"), erin = uniq("erin-"), ip = ipHeader();
    const proj = (await R.call("POST", "/api/v1/projects", { token: tok(alice), body: { name: "T" }, headers: ip })).json;
    await R.call("PUT", `/api/v1/projects/${proj.projectId}/members/${bob}`, { token: tok(alice), body: { role: "VIEWER" }, headers: ip });
    const ask = (uid) => R.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: { ...ASK, projectId: proj.projectId }, headers: ip });
    assert.equal((await ask(alice)).status, 200);
    assert.equal((await ask(bob)).status, 200);
    assert.equal((await ask(alice)).status, 200);
    assert.equal((await ask(bob)).status, 429, "the tenant budget is spent");
    assert.equal((await ask(alice)).status, 429);
    // another tenant is unaffected
    const other = (await R.call("POST", "/api/v1/projects", { token: tok(erin), body: { name: "Other" }, headers: ip })).json;
    assert.equal((await R.call("POST", "/api/v1/copilot/query", { token: tok(erin), body: { ...ASK, projectId: other.projectId }, headers: ip })).status, 200);
    await R.close();
  });

  await t.test("per-IP limit applies to every route except /health and /ready; a spoofed X-Forwarded-For prefix does not buy a fresh budget", async () => {
    const R = await startReplica({ keys, env: { RATE_LIMIT_GLOBAL_IP: "5/60" } });
    const real = `192.0.2.${Math.floor(Math.random() * 250)}.${Date.now() % 100000}`;
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await R.call("GET", "/api/v1/replica", { headers: { "x-forwarded-for": `${i}.${i}.${i}.${i}, ${real}` } })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429], "rotating the client-controlled part of XFF changes nothing");
    for (let i = 0; i < 10; i++) assert.equal((await R.call("GET", "/health", { headers: ipHeader(real) })).status, 200, "liveness is never limited");
    assert.equal((await R.call("GET", "/api/v1/replica", { headers: ipHeader() })).status, 200, "a different client IP is unaffected");
    await R.close();
  });

  await t.test("analysis creation: per-user limit and daily budget", async () => {
    const R = await startReplica({ keys, env: { ...baseEnv, RATE_LIMIT_ANALYSIS_USER: "2/60", RATE_LIMIT_ANALYSIS_USER_DAILY: "100/86400" } });
    const u = uniq("u-"), ip = ipHeader();
    const proj = (await R.call("POST", "/api/v1/projects", { token: tok(u), body: { name: "A" }, headers: ip })).json;
    const create = () => R.call("POST", "/api/v1/analysis", { token: tok(u), body: { projectId: proj.projectId, paperId: PAPER }, headers: ip });
    assert.deepEqual([(await create()).status, (await create()).status, (await create()).status], [202, 202, 429]);
    await R.close();

    const D = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, RATE_LIMIT_COPILOT_USER_DAILY: "2/86400" } });
    const v = uniq("v-");
    const ask = () => D.call("POST", "/api/v1/copilot/query", { token: tok(v), body: ASK, headers: ipHeader() });
    assert.deepEqual([(await ask()).status, (await ask()).status, (await ask()).status], [200, 200, 429], "the daily cap bounds spend per user");
    await D.close();
  });

  await t.test("the window resets: after it elapses the budget is available again", async () => {
    const R = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, RATE_LIMIT_COPILOT_USER: "2/1" } });
    const u = uniq("u-"), ip = ipHeader();
    const ask = () => R.call("POST", "/api/v1/copilot/query", { token: tok(u), body: ASK, headers: ip });
    assert.deepEqual([(await ask()).status, (await ask()).status, (await ask()).status], [200, 200, 429]);
    await sleep(1200);
    assert.equal((await ask()).status, 200);
    await R.close();
  });

  await t.test("reads and writes have their own, higher limits (normal research usage is not throttled)", async () => {
    const R = await startReplica({ keys, highLimits: false });
    const u = uniq("u-"), ip = ipHeader();
    const proj = (await R.call("POST", "/api/v1/projects", { token: tok(u), body: { name: "N" }, headers: ip })).json;
    let ok = 0;
    for (let i = 0; i < 40; i++) if ((await R.call("GET", `/api/v1/projects/${proj.projectId}`, { token: tok(u), headers: ip })).status === 200) ok++;
    assert.equal(ok, 40, "40 reads in a burst under the default limits");
    await R.close();
  });

  await t.test("Redis unavailable: protected routes fail CLOSED (503) so spend cannot become unbounded; /health stays up", async () => {
    const R = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, REDIS_URL: "redis://127.0.0.1:1" } });
    const r = await R.call("POST", "/api/v1/copilot/query", { token: tok(uniq("u-")), body: ASK, headers: ipHeader() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "RATE_LIMITER_UNAVAILABLE");
    assert.ok(r.headers["retry-after"]);
    assert.equal((await R.call("GET", "/health", { headers: ipHeader() })).status, 200);
    assert.equal((await R.call("GET", "/ready", { headers: ipHeader() })).status, 503);
    await R.close();
  });

  await t.test("fail-closed also applies to the per-IP limiter alone (public route: no authentication step involved)", async () => {
    const closed = await startReplica({ keys, env: { REDIS_URL: "redis://127.0.0.1:1" } });
    const r = await closed.call("GET", "/api/v1/replica", { headers: ipHeader() });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "RATE_LIMITER_UNAVAILABLE");
    await closed.close();
    const open = await startReplica({ keys, env: { REDIS_URL: "redis://127.0.0.1:1", RATE_LIMIT_FAIL_MODE: "open" } });
    assert.equal((await open.call("GET", "/api/v1/replica", { headers: ipHeader() })).status, 200);
    assert.equal(open.runtime.rateLimiter.snapshot().failedOpen, 1);
    await open.close();
  });

  await t.test("limiter unit: a backend error is RateLimiterUnavailable when closed, an allowed+counted pass when open (hit and peek)", async () => {
    const broken = { eval: async () => { throw Object.assign(new Error("x"), { code: "REDIS_CONNECT_FAILED" }); }, command: async () => { throw Object.assign(new Error("x"), { code: "REDIS_CONNECT_FAILED" }); } };
    const policies = loadPolicies({});
    const closed = createRateLimiter({ redis: broken, policies, failMode: "closed" });
    await assert.rejects(closed.hit("COPILOT_USER", "user", "u"), (e) => e.code === "RATE_LIMITER_UNAVAILABLE" && e.cause === "REDIS_CONNECT_FAILED");
    await assert.rejects(closed.peek("AUTH_FAIL_IP", "ip", "1.1.1.1"), (e) => e.code === "RATE_LIMITER_UNAVAILABLE");
    const open = createRateLimiter({ redis: broken, policies, failMode: "open" });
    assert.equal((await open.hit("COPILOT_USER", "user", "u")).allowed, true);
    assert.equal((await open.peek("AUTH_FAIL_IP", "ip", "1.1.1.1")).allowed, true);
    assert.equal(open.snapshot().failedOpen, 2);
  });

  await t.test("RATE_LIMIT_FAIL_MODE=open is an explicit, counted opt-out", async () => {
    const R = await startReplica({ keys, overrides: { client: stub() }, env: { ...baseEnv, REDIS_URL: "redis://127.0.0.1:1", RATE_LIMIT_FAIL_MODE: "open" } });
    const r = await R.call("POST", "/api/v1/copilot/query", { token: tok(uniq("u-")), body: ASK, headers: ipHeader() });
    assert.equal(r.status, 200);
    assert.ok(R.runtime.rateLimiter.snapshot().failedOpen >= 1, "the bypass is counted, not silent");
    await R.close();
  });

  await t.test("limiter unit behaviour against Redis: atomic under concurrency, keys expire, ids are hashed", async () => {
    const redis = new RedisClient({ url: INFRA.redisUrl });
    const policies = loadPolicies({ RATE_LIMIT_COPILOT_USER: "10/60" });
    const rl = createRateLimiter({ redis, policies });
    const id = uniq("conc-");
    const results = await Promise.all(Array.from({ length: 40 }, () => rl.hit("COPILOT_USER", "user", id)));
    assert.equal(results.filter((r) => r.allowed).length, 10, "exactly the limit is granted even under 40 concurrent hits");
    const keysSeen = await redis.command("KEYS", "shords:rl:COPILOT_USER:user:*");
    const mine = keysSeen.find((k) => !k.includes(id));
    assert.ok(mine && !keysSeen.some((k) => k.includes(id)), "raw identifiers never appear in keys");
    const ttl = await redis.command("TTL", keysSeen[0]);
    assert.ok(ttl > 0 && ttl <= 60, "every counter has an expiry");
    const evil = await rl.hit("COPILOT_USER", "user", "x:y:z\r\nFLUSHALL");
    assert.equal(evil.allowed, true);
    await redis.close();
  });
});
