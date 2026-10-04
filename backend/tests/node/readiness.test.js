"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReadinessChecker, createAiProbe } = require("../../readiness");
const { probeModel } = require("../../llm/anthropicClient");
const { FAKE_ANTHROPIC_KEY } = require("./helpers");
const { MIGRATIONS } = require("../../data/migrations");
const LATEST = Math.max(...MIGRATIONS.map((m) => m.version)); // the schema version this build expects

// Controlled fakes: these tests are about how /ready interprets dependency state. Real-dependency versions run in api.integration.test.js.
const SECRET_DB = "postgresql://svc_user:s3cr3t-db-pass@db.internal.example:5432/prod";
const SECRET_REDIS = "redis://default:s3cr3t-redis-pass@redis.internal.example:6379";
const okPool = { ping: async () => ({ ok: true, latencyMs: 2 }), query: async () => ({ rows: [{ v: 1 }] }) };
const okRedis = { ping: async () => ({ ok: true, latencyMs: 1 }) };
const okVerifier = { status: async () => ({ configured: true, ready: true, keysLoaded: 3, lastError: null }) };
const aiReachable = async () => ({ status: "REACHABLE", detail: "OK", model: "claude-sonnet-5-5", probedAt: "t" });

function checker(over = {}) {
  return createReadinessChecker({ pool: okPool, redis: okRedis, verifier: okVerifier, aiCheck: aiReachable, env: {}, replicaId: "r1", ...over });
}
// schemaStatus reads schema_migrations through pool.query
const poolWithSchema = (current) => ({ ping: async () => ({ ok: true, latencyMs: 2 }), query: async () => ({ rows: [{ v: current }] }) });

test("all dependencies healthy -> READY, 200-equivalent, every check OK", async () => {
  const r = await checker({ pool: poolWithSchema(LATEST) })();
  assert.equal(r.ready, true);
  assert.equal(r.status, "READY");
  assert.deepEqual([r.checks.database.status, r.checks.redis.status, r.checks.auth.status, r.checks.aiProvider.status], ["OK", "OK", "OK", "REACHABLE"]);
  assert.deepEqual(r.warnings, []);
});

test("database unreachable -> NOT_READY with a category code only", async () => {
  const pool = { ping: async () => ({ ok: false, latencyMs: 3, error: "PG_CONNECT_FAILED" }), query: async () => { throw new Error("unreachable"); } };
  const r = await checker({ pool })();
  assert.equal(r.ready, false);
  assert.equal(r.status, "NOT_READY");
  assert.equal(r.checks.database.status, "DOWN");
  assert.equal(r.checks.database.error, "PG_CONNECT_FAILED");
  assert.equal(r.checks.redis.status, "OK");
});

test("database reachable but schema behind -> NOT_READY (SCHEMA_NOT_READY)", async () => {
  for (const behind of [0, LATEST - 1]) {
    const r = await checker({ pool: poolWithSchema(behind) })();
    assert.equal(r.ready, false, `schema ${behind} of ${LATEST}`);
    assert.equal(r.checks.database.status, "SCHEMA_NOT_READY");
    assert.deepEqual({ c: r.checks.database.schema.current, e: r.checks.database.schema.expected }, { c: behind, e: LATEST });
  }
});

test("Redis unreachable -> NOT_READY", async () => {
  const redis = { ping: async () => ({ ok: false, latencyMs: 2, error: "REDIS_CONNECT_FAILED" }) };
  const r = await checker({ pool: poolWithSchema(LATEST), redis })();
  assert.equal(r.ready, false);
  assert.equal(r.checks.redis.status, "DOWN");
  assert.equal(r.checks.redis.error, "REDIS_CONNECT_FAILED");
  assert.equal(r.checks.database.status, "OK");
});

test("database configuration missing (no DATABASE_URL) -> NOT_CONFIGURED and NOT ready, never 'alive'", async () => {
  const r = await checker({ pool: null })();
  assert.equal(r.ready, false);
  assert.equal(r.checks.database.status, "NOT_CONFIGURED");
});

test("Redis configuration missing (no REDIS_URL) -> NOT_CONFIGURED and NOT ready, never 'alive'", async () => {
  const r = await checker({ pool: poolWithSchema(LATEST), redis: null })();
  assert.equal(r.ready, false);
  assert.equal(r.checks.redis.status, "NOT_CONFIGURED");
});

test("authentication not configured or its signing keys unreachable -> NOT_READY", async () => {
  let r = await checker({ pool: poolWithSchema(LATEST), verifier: { status: async () => ({ configured: false, ready: false, keysLoaded: 0 }) } })();
  assert.equal(r.ready, false);
  assert.equal(r.checks.auth.status, "NOT_CONFIGURED");
  r = await checker({ pool: poolWithSchema(LATEST), verifier: { status: async () => ({ configured: true, ready: false, keysLoaded: 0 }) } })();
  assert.equal(r.ready, false);
  assert.equal(r.checks.auth.status, "KEYS_UNAVAILABLE");
});

test("AI provider not configured (no key): DEGRADED but ready by default; NOT_READY when REQUIRE_AI_PROVIDER=true", async () => {
  const aiCheck = createAiProbe({ env: {}, probe: async () => { throw new Error("must not probe without a key"); } });
  let r = await checker({ pool: poolWithSchema(LATEST), aiCheck })();
  assert.equal(r.ready, true);
  assert.equal(r.status, "DEGRADED");
  assert.equal(r.checks.aiProvider.status, "NOT_CONFIGURED");
  assert.equal(r.checks.aiProvider.required, false);
  assert.match(r.warnings[0], /fallback/);
  r = await checker({ pool: poolWithSchema(LATEST), aiCheck, env: { REQUIRE_AI_PROVIDER: "true" } })();
  assert.equal(r.ready, false);
  assert.equal(r.status, "NOT_READY");
});

test("provider configured but unreachable: reported UNREACHABLE (not healthy); DEGRADED, or NOT_READY when required", async () => {
  const env = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY };
  const aiCheck = createAiProbe({ env, probe: async () => ({ status: "UNREACHABLE", detail: "NETWORK_ERROR" }) });
  let r = await checker({ pool: poolWithSchema(LATEST), aiCheck, env })();
  assert.equal(r.ready, true);
  assert.equal(r.status, "DEGRADED");
  assert.deepEqual({ s: r.checks.aiProvider.status, d: r.checks.aiProvider.detail }, { s: "UNREACHABLE", d: "NETWORK_ERROR" });
  r = await checker({ pool: poolWithSchema(LATEST), aiCheck, env: { ...env, REQUIRE_AI_PROVIDER: "true" } })();
  assert.equal(r.ready, false);
});

test("probe: real model-metadata request shape, no tokens spent, categories only, results cached", async () => {
  const seen = [];
  const transport = async (req) => { seen.push(req); return { statusCode: 200, headers: {}, body: "{}" }; };
  const ok = await probeModel({ apiKey: FAKE_ANTHROPIC_KEY, model: "claude-sonnet-5-5", transport });
  assert.equal(ok.status, "REACHABLE");
  assert.equal(seen[0].path, "/v1/models/claude-sonnet-5-5");
  assert.equal(seen[0].headers["x-api-key"], FAKE_ANTHROPIC_KEY);
  assert.equal(seen[0].body, undefined, "a GET: no prompt, no tokens");
  const bad = await probeModel({ apiKey: FAKE_ANTHROPIC_KEY, model: "claude-sonnet-5-5", transport: async () => ({ statusCode: 401, headers: {}, body: JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } }) }) });
  assert.deepEqual({ s: bad.status, d: bad.detail }, { s: "REJECTED", d: "INVALID_CREDENTIAL" }, "the provider answered but the key is unusable");
  const five = await probeModel({ apiKey: FAKE_ANTHROPIC_KEY, model: "m", transport: async () => ({ statusCode: 529, headers: {}, body: "{}" }) });
  assert.deepEqual({ s: five.status, d: five.detail }, { s: "UNREACHABLE", d: "PROVIDER_5XX" });
  const net = await probeModel({ apiKey: FAKE_ANTHROPIC_KEY, model: "m", transport: async () => { throw Object.assign(new Error("x"), { category: "TIMEOUT" }); } });
  assert.deepEqual({ s: net.status, d: net.detail }, { s: "UNREACHABLE", d: "TIMEOUT" });
  assert.equal((await probeModel({ apiKey: "", model: "m" })).status, "NOT_CONFIGURED");

  let calls = 0;
  const cached = createAiProbe({ env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, probe: async () => { calls++; return { status: "REACHABLE", detail: "OK" }; }, ttlMs: 60000 });
  await cached(); await cached(); await cached();
  assert.equal(calls, 1, "readiness polling does not hammer the provider");
});

test("a hung dependency cannot hang /ready: the check times out and reports DOWN", async () => {
  const hung = { ping: () => new Promise(() => {}), query: () => new Promise(() => {}) };
  const t0 = Date.now();
  const r = await checker({ pool: hung, redis: { ping: () => new Promise(() => {}) }, checkTimeoutMs: 100 })();
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(r.ready, false);
  assert.equal(r.checks.database.error, "CHECK_TIMEOUT");
  assert.equal(r.checks.redis.error, "CHECK_TIMEOUT");
});

test("the readiness document never contains connection strings, hosts, passwords or the API key", async () => {
  const env = { DATABASE_URL: SECRET_DB, REDIS_URL: SECRET_REDIS, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY };
  const failing = {
    pool: { ping: async () => ({ ok: false, latencyMs: 1, error: "PG_AUTH_FAILED" }), query: async () => ({ rows: [] }) },
    redis: { ping: async () => ({ ok: false, latencyMs: 1, error: "REDIS_AUTH_FAILED" }) },
    aiCheck: createAiProbe({ env, probe: async () => ({ status: "REJECTED", detail: "INVALID_CREDENTIAL" }) }),
    env
  };
  const text = JSON.stringify(await checker(failing)());
  for (const secret of ["s3cr3t-db-pass", "s3cr3t-redis-pass", "internal.example", "svc_user", FAKE_ANTHROPIC_KEY, "postgresql://", "redis://"]) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
});

test("concurrent /ready calls share one evaluation", async () => {
  let pings = 0;
  const pool = { ping: async () => { pings++; await new Promise((r) => setTimeout(r, 30)); return { ok: true, latencyMs: 30 }; }, query: async () => ({ rows: [{ v: 1 }] }) };
  const c = checker({ pool });
  await Promise.all(Array.from({ length: 25 }, () => c()));
  assert.equal(pings, 1);
});
