"use strict";
/** /ready against real (and really missing / unreachable) dependencies. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { startReplica, makeKeyPair, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY, INFRA } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("rd-key");
const ready = (R) => R.call("GET", "/ready", { headers: ipHeader() });
const ok = { probe: async () => ({ status: "REACHABLE", detail: "OK" }) };

test("/ready with real dependencies", { skip }, async (t) => {
  await resetInfra();

  await t.test("everything healthy: 200 READY, each check OK, no secrets in the body", async () => {
    const R = await startReplica({ keys, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "READY");
    assert.deepEqual([r.json.checks.database.status, r.json.checks.redis.status, r.json.checks.auth.status, r.json.checks.aiProvider.status], ["OK", "OK", "OK", "REACHABLE"]);
    assert.ok(r.json.checks.database.latencyMs >= 0);
    assert.equal(r.json.checks.database.schema.current, r.json.checks.database.schema.expected);
    for (const secret of [new URL(INFRA.databaseUrl).password, FAKE_ANTHROPIC_KEY, "postgresql://", "redis://", "54329", "63790"]) assert.ok(!r.text.includes(secret), `leaked ${secret}`);
    await R.close();
  });

  await t.test("no ANTHROPIC_API_KEY: ready but DEGRADED (labelled fallback), aiProvider NOT_CONFIGURED; REQUIRE_AI_PROVIDER=true makes it 503", async () => {
    const R = await startReplica({ keys });
    const r = await ready(R);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "DEGRADED");
    assert.equal(r.json.checks.aiProvider.status, "NOT_CONFIGURED");
    await R.close();
    const S = await startReplica({ keys, env: { REQUIRE_AI_PROVIDER: "true" } });
    assert.equal((await ready(S)).status, 503);
    await S.close();
  });

  await t.test("provider configured but unreachable (real network failure path through the probe seam)", async () => {
    const R = await startReplica({ keys, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { probe: async () => ({ status: "UNREACHABLE", detail: "NETWORK_ERROR" }) } });
    const r = await ready(R);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "DEGRADED");
    assert.deepEqual({ s: r.json.checks.aiProvider.status, d: r.json.checks.aiProvider.detail }, { s: "UNREACHABLE", d: "NETWORK_ERROR" });
    assert.match(r.json.warnings[0], /fallback/);
    await R.close();
    const S = await startReplica({ keys, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, REQUIRE_AI_PROVIDER: "true" }, overrides: { probe: async () => ({ status: "UNREACHABLE", detail: "INVALID_CREDENTIAL" }) } });
    assert.equal((await ready(S)).status, 503);
    await S.close();
  });

  await t.test("DATABASE_URL points at nothing: 503, database DOWN (not 'alive'); /health stays 200", async () => {
    const dead = new URL(INFRA.databaseUrl); dead.port = "1";
    const R = await startReplica({ keys, env: { DATABASE_URL: dead.toString() }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.status, "NOT_READY");
    assert.equal(r.json.checks.database.status, "DOWN");
    assert.equal(r.json.checks.database.error, "PG_CONNECT_FAILED");
    assert.equal(r.json.checks.redis.status, "OK");
    assert.equal((await R.call("GET", "/health", { headers: ipHeader() })).status, 200);
    assert.ok(!r.text.includes(new URL(INFRA.databaseUrl).password));
    await R.close();
  });

  await t.test("database credentials rejected: DOWN with PG_AUTH_FAILED", async () => {
    const bad = new URL(INFRA.databaseUrl); bad.password = "wrong-password";
    const R = await startReplica({ keys, env: { DATABASE_URL: bad.toString() }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.database.error, "PG_AUTH_FAILED");
    assert.ok(!r.text.includes("wrong-password"));
    await R.close();
  });

  await t.test("REDIS_URL points at nothing: 503, redis DOWN", async () => {
    const R = await startReplica({ keys, env: { REDIS_URL: "redis://127.0.0.1:1" }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.redis.status, "DOWN");
    assert.equal(r.json.checks.redis.error, "REDIS_CONNECT_FAILED");
    assert.equal(r.json.checks.database.status, "OK");
    await R.close();
  });

  await t.test("DATABASE_URL missing: NOT_CONFIGURED and NOT ready (the old code reported it alive)", async () => {
    const R = await startReplica({ keys, env: { DATABASE_URL: undefined }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.database.status, "NOT_CONFIGURED");
    assert.equal((await R.call("GET", "/api/v1/projects", { token: require("./helpers").tokenFor(keys, uniq("u-")), headers: ipHeader() })).status, 503, "dependent routes answer 503, not a crash");
    await R.close();
  });

  await t.test("REDIS_URL missing: NOT_CONFIGURED and NOT ready", async () => {
    const R = await startReplica({ keys, env: { REDIS_URL: undefined }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.redis.status, "NOT_CONFIGURED");
    await R.close();
  });

  await t.test("auth not configured: NOT_READY with auth NOT_CONFIGURED", async () => {
    const R = await startReplica({ env: { FIREBASE_PROJECT_ID: undefined }, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.auth.status, "NOT_CONFIGURED");
    await R.close();
  });

  await t.test("schema not migrated: SCHEMA_NOT_READY (a replica pointed at an empty database is not ready)", async () => {
    const { PgPool } = require("../../data/pgClient");
    const p = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    await p.query("DROP SCHEMA public CASCADE"); await p.query("CREATE SCHEMA public"); await p.end();
    const R = await startReplica({ keys, overrides: ok });
    const r = await ready(R);
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.database.status, "SCHEMA_NOT_READY");
    await R.close();
    await resetInfra();
  });
});
