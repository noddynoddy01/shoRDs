"use strict";
/**
 * AI spend safety against REAL Redis and PostgreSQL (local, *_test only). No provider is contacted: the model is an injected stub.
 *   1. the Redis store behaves exactly like the in-memory store the unit tests use (same scenarios, both stores),
 *      and a burst of parallel reservations can never exceed the limit;
 *   2. Postgres is authoritative: counters are seeded from ai_usage, and a flushed Redis cannot reset a day's spending;
 *   3. end to end through the real HTTP API: kill switch, budgets, cross-replica concurrency, and cached answers.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, INFRA, FAKE_ANTHROPIC_KEY } = require("./helpers");
const { PgPool } = require("../../data/pgClient");
const { RedisClient } = require("../../data/redisClient");
const { createUsageLedger } = require("../../llm/usageLedger");
const { createAiBudget, createRedisBudgetStore, createMemoryBudgetStore, createLedgerSeeder, loadBudgetConfig, scopesFor, DENY } = require("../../llm/aiBudget");

const skip = infraSkip();
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const NOW = Date.now();

const scopeOf = (id, over = {}) => ({ kind: "user", id, key: `shords:aib:test:${id}`, zkey: `shords:aib:test:${id}:res`, limitMicro: 10000, maxConcurrent: 2, maxCalls: 3, ...over });

/** The same scenarios, run against whichever store is passed in. */
async function storeScenarios(t, makeStore, label) {
  await t.test(`${label}: counters must be seeded first, and seeding never overwrites`, async () => {
    const store = makeStore();
    const s = scopeOf(uniq("seed-"));
    const rid = uniq("r");
    assert.deepEqual(await store.reserve({ scopes: [s], amountMicro: 1000, reservationId: rid, expiresAtMs: NOW + 60000, nowMs: NOW }), { ok: false, needsSeed: true, scopeIndex: 0 });
    await store.seed({ scope: s, spentMicro: 1000, calls: 2 });
    await store.seed({ scope: s, spentMicro: 999999, calls: 99 }); // a second replica seeding concurrently must not inflate or reset it
    const p = await store.peek({ scope: s, nowMs: NOW });
    assert.deepEqual([p.seeded, p.spentMicro, p.calls], [true, 1000, 2]);
  });

  await t.test(`${label}: spend limit counts spent + already reserved + this amount`, async () => {
    const store = makeStore();
    const s = scopeOf(uniq("lim-"), { maxCalls: null, maxConcurrent: null });
    await store.seed({ scope: s, spentMicro: 1000, calls: 0 });
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "a", expiresAtMs: NOW + 60000, nowMs: NOW })).ok, true);
    assert.deepEqual(await store.reserve({ scopes: [s], amountMicro: 4001, reservationId: "b", expiresAtMs: NOW + 60000, nowMs: NOW }), { ok: false, scopeIndex: 0, reason: "LIMIT" }); // 1000 + 5000 + 4001 > 10000
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 4000, reservationId: "c", expiresAtMs: NOW + 60000, nowMs: NOW })).ok, true); // exactly at the limit is allowed
    const p = await store.peek({ scope: s, nowMs: NOW });
    assert.deepEqual([p.spentMicro, p.reservedMicro, p.concurrent], [1000, 9000, 2]);
  });

  await t.test(`${label}: concurrency and call-count limits`, async () => {
    const store = makeStore();
    const s = scopeOf(uniq("conc-"), { limitMicro: null, maxConcurrent: 2, maxCalls: 3 });
    await store.seed({ scope: s, spentMicro: 0, calls: 2 });
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 1, reservationId: "a", expiresAtMs: NOW + 60000, nowMs: NOW })).ok, true); // calls 2 + 0 in flight < 3
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 1, reservationId: "b", expiresAtMs: NOW + 60000, nowMs: NOW })).reason, "CALLS"); // 2 + 1 in flight >= 3
    const t2 = scopeOf(uniq("conc2-"), { limitMicro: null, maxConcurrent: 2, maxCalls: null });
    await store.seed({ scope: t2, spentMicro: 0, calls: 0 });
    await store.reserve({ scopes: [t2], amountMicro: 1, reservationId: "a", expiresAtMs: NOW + 60000, nowMs: NOW });
    await store.reserve({ scopes: [t2], amountMicro: 1, reservationId: "b", expiresAtMs: NOW + 60000, nowMs: NOW });
    assert.equal((await store.reserve({ scopes: [t2], amountMicro: 1, reservationId: "c", expiresAtMs: NOW + 60000, nowMs: NOW })).reason, "CONCURRENCY");
  });

  await t.test(`${label}: settle charges the real amount once and frees the reservation; a release charges nothing and counts no call`, async () => {
    const store = makeStore();
    const s = scopeOf(uniq("settle-"), { maxCalls: null, maxConcurrent: null });
    await store.seed({ scope: s, spentMicro: 0, calls: 0 });
    await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "x", expiresAtMs: NOW + 60000, nowMs: NOW });
    await store.settle({ scopes: [s], reservationId: "x", chargeMicro: 1234 });
    assert.deepEqual(pick(await store.peek({ scope: s, nowMs: NOW })), { spentMicro: 1234, calls: 1, reservedMicro: 0, concurrent: 0 });
    await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "y", expiresAtMs: NOW + 60000, nowMs: NOW });
    await store.settle({ scopes: [s], reservationId: "y", chargeMicro: 0 });
    assert.deepEqual(pick(await store.peek({ scope: s, nowMs: NOW })), { spentMicro: 1234, calls: 1, reservedMicro: 0, concurrent: 0 });
    await store.settle({ scopes: [s], reservationId: "never-existed", chargeMicro: 0 }); // settling twice / unknown ids is harmless
  });

  await t.test(`${label}: an expired reservation stops counting`, async () => {
    const store = makeStore();
    const s = scopeOf(uniq("exp-"), { limitMicro: 6000, maxCalls: null, maxConcurrent: null });
    await store.seed({ scope: s, spentMicro: 0, calls: 0 });
    await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "old", expiresAtMs: NOW + 1000, nowMs: NOW });
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "n1", expiresAtMs: NOW + 99999, nowMs: NOW + 500 })).ok, false);
    assert.equal((await store.reserve({ scopes: [s], amountMicro: 5000, reservationId: "n2", expiresAtMs: NOW + 99999, nowMs: NOW + 1001 })).ok, true);
  });

  await t.test(`${label}: reserving across scopes is all-or-nothing`, async () => {
    const store = makeStore();
    const roomy = scopeOf(uniq("roomy-"), { limitMicro: 1e9, maxCalls: null, maxConcurrent: null });
    const tight = scopeOf(uniq("tight-"), { limitMicro: 100, maxCalls: null, maxConcurrent: null, kind: "project" });
    await store.seed({ scope: roomy, spentMicro: 0, calls: 0 });
    await store.seed({ scope: tight, spentMicro: 0, calls: 0 });
    const r = await store.reserve({ scopes: [roomy, tight], amountMicro: 5000, reservationId: "z", expiresAtMs: NOW + 60000, nowMs: NOW });
    assert.deepEqual(r, { ok: false, scopeIndex: 1, reason: "LIMIT" });
    assert.equal((await store.peek({ scope: roomy, nowMs: NOW })).reservedMicro, 0, "the roomy scope was not left holding a reservation");
  });

  await t.test(`${label}: lock is exclusive, the right token unlocks, a wrong token does not`, async () => {
    const store = makeStore();
    const k = `shords:ai:test:lock:${uniq("k")}`;
    assert.equal(await store.lock(k, "t1", 60000), true);
    assert.equal(await store.lock(k, "t2", 60000), false);
    await store.unlock(k, "t2");
    assert.equal(await store.lock(k, "t3", 60000), false, "still held: a wrong token cannot release it");
    await store.unlock(k, "t1");
    assert.equal(await store.lock(k, "t4", 60000), true);
    await store.set(`${k}:v`, "v1", 60000);
    assert.equal(await store.get(`${k}:v`), "v1");
    await store.del(`${k}:v`);
    assert.equal(await store.get(`${k}:v`), null);
  });
}
const pick = (p) => ({ spentMicro: p.spentMicro, calls: p.calls, reservedMicro: p.reservedMicro, concurrent: p.concurrent });

test("AI spend safety: stores, Postgres authority and the HTTP API (real Redis + PostgreSQL)", { skip }, async (t) => {
  await resetInfra();
  const redis = new RedisClient({ url: INFRA.redisUrl });
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 3 });

  await storeScenarios(t, () => createMemoryBudgetStore(), "memory store");
  await storeScenarios(t, () => createRedisBudgetStore(redis), "REDIS store");

  await t.test("REDIS store: 60 parallel reservations against a limit that fits exactly 5 admit exactly 5", async () => {
    const store = createRedisBudgetStore(redis);
    const s = scopeOf(uniq("race-"), { limitMicro: 5000, maxCalls: null, maxConcurrent: null });
    await store.seed({ scope: s, spentMicro: 0, calls: 0 });
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => store.reserve({ scopes: [s], amountMicro: 1000, reservationId: `p${i}`, expiresAtMs: NOW + 60000, nowMs: NOW })));
    assert.equal(results.filter((r) => r.ok).length, 5);
    assert.equal((await store.peek({ scope: s, nowMs: NOW })).reservedMicro, 5000);
  });

  await t.test("REDIS store: two gates (two replicas) share one budget: 40 parallel calls, limit for 3 worst-case reservations, never more than 3 in flight", async () => {
    const ctxU = { tenantId: uniq("ten-"), projectId: uniq("prj-"), uid: uniq("u-") };
    const env = { AI_BUDGET_USER_DAILY_USD: "0.4", AI_BUDGET_USER_MAX_CONCURRENT: "unlimited" }; // each reservation is $0.125, so 3 fit
    const mkGate = () => createAiBudget({ store: createRedisBudgetStore(redis), seedFromLedger: createLedgerSeeder(pool), env, logger: quiet });
    const gates = [mkGate(), mkGate()];
    let inFlight = 0, peak = 0, calls = 0;
    const client = { async callMessages(o) { calls += 1; inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 40)); inFlight -= 1; return { text: "ok", usage: null, model: o.model, costUsd: 0.001, costStatus: "ESTIMATED" }; } };
    const o = (i) => ({ apiKey: "k", model: "claude-sonnet-5-5", system: "", user: `parallel ${i}`.padEnd(1000, "a"), maxTokens: 6000, effort: "low", timeoutMs: 60000, env: {} });
    const settled = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => gates[i % 2].guardClient(client, ctxU).callMessages(o(i))));
    assert.ok(peak <= 3, `at most 3 worst-case reservations fit, saw ${peak} in flight`);
    assert.ok(settled.filter((s) => s.status === "fulfilled").length >= 3);
    assert.equal(settled.filter((s) => s.status === "fulfilled").length, calls);
    assert.ok(settled.filter((s) => s.status === "rejected").every((s) => s.reason.category === DENY.BUDGET_EXCEEDED));
  });

  // ---------------------------------------------------------------- Postgres authority
  const ledger = createUsageLedger({ pool, logger: quiet });
  const realOut = (cost) => ({ httpStatus: 200, body: { requestId: uniq("req_"), provider: "anthropic", model: "claude-sonnet-5-5", modelMode: "EXTERNAL_CLAUDE", aiCalled: true, fallbackUsed: false, status: "UNVERIFIED", contentCoverage: "FULL_TEXT", latencyMs: 10, cache: { status: "MISS" }, tokens: { source: "REAL_PROVIDER", inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCostUsd: cost, costStatus: "ESTIMATED" } } });

  await t.test("seeding reads today's spend and paid calls from the ai_usage ledger (per user / tenant / project / global); yesterday and cache hits do not count", async () => {
    const tenantId = uniq("ten-"), projectId = uniq("prj-"), uid = uniq("u-");
    const c = { kind: "COPILOT", scope: { tenantId, projectId }, uid };
    await ledger.record(realOut(0.25), c);
    await ledger.record(realOut(0.5), c);
    await ledger.record({ httpStatus: 200, body: { ...realOut(0).body, cache: { status: "HIT" }, tokens: { source: "CACHE", estimatedCostUsd: 0, costStatus: "NO_NEW_SPEND" } } }, c); // no spend
    await ledger.record(realOut(9.99), { ...c, uid: uniq("other-") }); // same tenant, another user
    await pool.query("UPDATE ai_usage SET created_at = now() - interval '2 days' WHERE cost_usd = 9.99");
    const seed = createLedgerSeeder(pool);
    const scopes = scopesFor(loadBudgetConfig({}), { tenantId, projectId, uid }, Date.now());
    const by = Object.fromEntries(await Promise.all(scopes.map(async (s) => [s.kind, await seed(s, Date.now())])));
    assert.deepEqual(by.user, { spentMicro: 750000, calls: 2 });
    assert.deepEqual(by.project, { spentMicro: 750000, calls: 2 });
    assert.deepEqual(by.tenant, { spentMicro: 750000, calls: 2 });
    assert.ok(by.global.spentMicro >= 750000 && by.global.spentMicro < 750000 + 9990000, "global includes today's rows only");
  });

  await t.test("a Redis flush cannot reset the day: the next reservation is re-seeded from Postgres and still refused", async () => {
    const tenantId = uniq("ten-"), projectId = uniq("prj-"), uid = uniq("u-");
    await ledger.record(realOut(0.45), { kind: "COPILOT", scope: { tenantId, projectId }, uid });
    const mkGate = () => createAiBudget({ store: createRedisBudgetStore(redis), seedFromLedger: createLedgerSeeder(pool), env: { AI_BUDGET_USER_DAILY_USD: "0.5" }, logger: quiet });
    const client = { calls: 0, async callMessages(o) { this.calls += 1; return { text: "ok", model: o.model, costUsd: 0.001, costStatus: "ESTIMATED" }; } };
    const o = { apiKey: "k", model: "claude-sonnet-5-5", system: "", user: "x".padEnd(1000, "a"), maxTokens: 6000, effort: "low", timeoutMs: 60000, env: {} };
    await assert.rejects(mkGate().guardClient(client, { tenantId, projectId, uid }).callMessages(o), (e) => e.category === DENY.BUDGET_EXCEEDED); // 0.45 + 0.125 > 0.5
    await redis.command("FLUSHDB");
    await assert.rejects(mkGate().guardClient(client, { tenantId, projectId, uid }).callMessages(o), (e) => e.category === DENY.BUDGET_EXCEEDED, "still refused after Redis lost every counter");
    assert.equal(client.calls, 0);
    // another user in a fresh scope is unaffected
    await mkGate().guardClient(client, { tenantId, projectId, uid: uniq("fresh-") }).callMessages({ ...o, user: "y".padEnd(1000, "a") }).catch(() => {});
  });

  // ---------------------------------------------------------------- end to end over HTTP
  const keys = makeKeyPair("budget-key");
  const tok = (uid) => tokenFor(keys, uid);
  const PAPER = `doi:${fx.FIXTURE_DOI}`;
  const countingClient = (opts = {}) => {
    const c = modelStub({ ...opts, costUsd: 0.002, costStatus: "ESTIMATED", usage: { inputTokens: 500, outputTokens: 60, totalTokens: 560 }, mutate: (kind, payload) => (kind === "question" ? `Answer #${c.calls.length} ${payload}` : payload) });
    return c;
  };
  const baseEnv = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "true" };

  async function world(R) {
    const u = uniq("user-");
    const projectId = (await R.call("POST", "/api/v1/projects", { token: tok(u), body: { name: "P" }, headers: ipHeader() })).json.projectId;
    const ask = (query, who = u, extra = {}, headers = {}) => R.call("POST", "/api/v1/copilot/query", { token: tok(who), body: { projectId, query, paperId: PAPER, ...extra }, headers: { ...ipHeader(), ...headers } });
    return { u, projectId, ask };
  }

  await t.test("kill switch over HTTP: admin-only, stops uncached paid calls at once, cached answers still served, clients cannot override, release restores", async () => {
    await resetInfra();
    const admin = uniq("admin-");
    const model = countingClient();
    const R = await startReplica({ keys, env: { ...baseEnv, ADMIN_UIDS: admin }, overrides: { client: model } });
    const { u, ask } = await world(R);
    const a1 = await ask("What was the effect on blood pressure?");
    assert.equal(a1.status, 200);
    assert.equal(a1.json.fallbackUsed, false);
    assert.equal(model.calls.length, 1);

    // admin only
    assert.equal((await R.call("GET", "/api/v1/admin/ai/budget", { token: tok(u), headers: ipHeader() })).status, 403);
    assert.equal((await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(u), body: { engaged: true, reason: "x" }, headers: ipHeader() })).status, 403);
    assert.equal((await R.call("PUT", "/api/v1/admin/ai/kill-switch", { headers: ipHeader(), body: { engaged: true, reason: "x" } })).status, 401);
    assert.equal(model.calls.length, 1);
    // validation
    assert.equal((await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(admin), body: { engaged: "yes" }, headers: ipHeader() })).status, 400);
    assert.equal((await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(admin), body: { engaged: true }, headers: ipHeader() })).status, 400);

    const before = await R.call("GET", "/api/v1/admin/ai/budget", { token: tok(admin), headers: ipHeader() });
    assert.equal(before.status, 200);
    assert.equal(before.json.killSwitch.engaged, false);
    assert.equal(before.json.mode, "enforce");
    assert.equal(before.json.limits.scopes.user.dailyUsd, 2);
    assert.equal(before.json.today.paidCalls, 1);
    assert.equal(before.json.today.globalSpentUsd, 0.002, "settled with the real (stub-reported) cost");

    const on = await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(admin), body: { engaged: true, reason: "runaway spend drill" }, headers: ipHeader() });
    assert.equal(on.status, 200);
    assert.equal(on.json.killSwitch.engaged, true);
    assert.ok(!JSON.stringify(on.json).includes(admin), "the administrator's identifier is not echoed");

    const blocked = await ask("A brand new uncached question about sample size?");
    assert.equal(blocked.status, 200);
    assert.equal(blocked.json.fallbackUsed, true);
    assert.equal(blocked.json.fallbackReason, "AI_POLICY_AI_DISABLED");
    assert.equal(blocked.json.modelMode, "LOCAL_DETERMINISTIC");
    assert.notEqual(blocked.json.verificationStatus, "VERIFIED");
    assert.equal(model.calls.length, 1, "no provider call while the switch is engaged");

    const cached = await ask("What was the effect on blood pressure?");
    assert.equal(cached.json.cache.status, "HIT", "a cached answer costs nothing and is still served");
    assert.equal(model.calls.length, 1);

    // nothing the client sends can reopen it
    for (const [extra, headers] of [[{ aiEnabled: true, killSwitch: false }, { "x-ai-enabled": "true", "x-kill-switch": "off" }], [{ analysisDepth: "QUICK" }, { "x-ai-budget-mode": "observe" }]]) {
      const r = await ask(`Another fresh question ${JSON.stringify(extra)}`, u, extra, headers);
      assert.equal(r.json.fallbackReason === "AI_POLICY_AI_DISABLED" || r.status === 400, true, JSON.stringify(r.json).slice(0, 200));
    }
    assert.equal(model.calls.length, 1);

    // the refusal is in the authoritative ledger
    const row = (await pool.query("SELECT ai_called, fallback, fallback_reason, cost_usd FROM ai_usage WHERE fallback_reason = 'AI_POLICY_AI_DISABLED' ORDER BY id LIMIT 1")).rows[0];
    assert.deepEqual([row.ai_called, row.fallback, row.fallback_reason, row.cost_usd], [false, true, "AI_POLICY_AI_DISABLED", null]);

    // another replica sees the same switch (it lives in Redis, not in one process)
    const R2 = await startReplica({ keys, env: { ...baseEnv, ADMIN_UIDS: admin }, overrides: { client: model } });
    const w2 = await world(R2);
    assert.equal((await w2.ask("Fresh question on replica two?")).json.fallbackReason, "AI_POLICY_AI_DISABLED");

    const off = await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(admin), body: { engaged: false }, headers: ipHeader() });
    assert.equal(off.json.killSwitch.engaged, false);
    const again = await ask("A brand new uncached question about sample size?");
    assert.equal(again.json.fallbackUsed, false);
    assert.equal(model.calls.length, 2);
    await R.close(); await R2.close();
  });

  await t.test("AI_ENABLED=false: paid AI is off at startup and the admin endpoint cannot reopen it", async () => {
    await resetInfra();
    const admin = uniq("admin-");
    const model = countingClient();
    const R = await startReplica({ keys, env: { ...baseEnv, ADMIN_UIDS: admin, AI_ENABLED: "false" }, overrides: { client: model } });
    const { ask } = await world(R);
    const r = await ask("Will this reach the provider?");
    assert.equal(r.json.fallbackReason, "AI_POLICY_AI_DISABLED");
    const rel = await R.call("PUT", "/api/v1/admin/ai/kill-switch", { token: tok(admin), body: { engaged: false }, headers: ipHeader() });
    assert.equal(rel.json.killSwitch.engaged, true);
    assert.equal(rel.json.killSwitch.source, "ENV");
    assert.equal((await ask("And now?")).json.fallbackReason, "AI_POLICY_AI_DISABLED");
    assert.equal(model.calls.length, 0);
    await R.close();
  });

  await t.test("a malformed AI_BUDGET_* value stops the service at startup (never runs with a limit nobody intended)", async () => {
    assert.throws(() => startReplicaSync({ AI_BUDGET_USER_DAILY_USD: "lots" }), /AI_BUDGET_USER_DAILY_USD/);
    assert.throws(() => startReplicaSync({ AI_BUDGET_MODE: "maybe" }), /AI_BUDGET_MODE/);
    function startReplicaSync(extra) {
      const { createRuntime } = require("../../runtime");
      return createRuntime({ NODE_ENV: "production", DATABASE_URL: INFRA.databaseUrl, REDIS_URL: INFRA.redisUrl, FIREBASE_PROJECT_ID: "p", CORS_ORIGINS: "https://shords.test", ...extra }, { logger: quiet, logRequests: false });
    }
  });

  await t.test("budget over HTTP: a request whose worst case exceeds the user's daily budget never reaches the provider", async () => {
    await resetInfra();
    const model = countingClient();
    const R = await startReplica({ keys, env: { ...baseEnv, AI_BUDGET_USER_DAILY_USD: "0.05" }, overrides: { client: model } });
    const { ask } = await world(R);
    const r = await ask("What was the effect on blood pressure?");
    assert.equal(r.json.fallbackReason, "AI_POLICY_BUDGET_EXCEEDED");
    assert.equal(model.calls.length, 0);
    await R.close();
  });

  await t.test("coordination across replicas: a call in flight on replica A holds the user's only concurrency slot, so replica B refuses a second paid call", async () => {
    await resetInfra();
    let release;
    const gate = new Promise((r) => { release = r; });
    const inner = countingClient();
    let started = 0;
    const slow = { calls: inner.calls, async callMessages(o) { started += 1; await gate; return inner.callMessages(o); } };
    const env = { ...baseEnv, AI_BUDGET_USER_MAX_CONCURRENT: "1", AI_CONCURRENCY_WAIT_MS: "0" }; // refuse immediately: the waiting behaviour is covered in aiBudget.test.js
    const A = await startReplica({ keys, env, overrides: { client: slow } });
    const B = await startReplica({ keys, env, overrides: { client: inner } });
    const wa = await world(A);
    const askB = (q) => B.call("POST", "/api/v1/copilot/query", { token: tok(wa.u), body: { projectId: wa.projectId, query: q, paperId: PAPER }, headers: ipHeader() });
    const pending = wa.ask("First question, running on replica A?");
    for (let i = 0; i < 100 && started === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(started, 1);
    const refused = await askB("A different question on replica B?");
    assert.equal(refused.json.fallbackReason, "AI_POLICY_CONCURRENCY_LIMIT");
    assert.equal(inner.calls.length, 0, "replica B never called the provider");
    release();
    assert.equal((await pending).json.fallbackUsed, false);
    assert.equal((await askB("A different question on replica B?")).json.fallbackUsed, false, "the slot is free again");
    await A.close(); await B.close();
  });

  await t.test("analysis jobs go through the same gate: with the kill switch engaged the job completes as a labelled fallback with zero provider calls", async () => {
    await resetInfra();
    const model = countingClient();
    const R = await startReplica({ keys, env: { ...baseEnv, AI_ENABLED: "false", JOB_BLOCK_SEC: "1" }, overrides: { client: model }, worker: true });
    const u = uniq("user-");
    const projectId = (await R.call("POST", "/api/v1/projects", { token: tok(u), body: { name: "P" }, headers: ipHeader() })).json.projectId;
    R.start();
    const created = await R.call("POST", "/api/v1/analysis", { token: tok(u), body: { projectId, paperId: PAPER }, headers: { ...ipHeader(), "idempotency-key": uniq("k") } });
    assert.ok([200, 201, 202].includes(created.status), JSON.stringify(created.json));
    let job;
    for (let i = 0; i < 150; i += 1) {
      job = (await R.call("GET", `/api/v1/analysis/${created.json.jobId}`, { token: tok(u), headers: ipHeader() })).json;
      if (job && ["COMPLETED", "FAILED"].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.result.fallbackUsed, true);
    assert.equal(job.result.fallbackReason, "AI_POLICY_AI_DISABLED");
    assert.equal(model.calls.length, 0);
    await R.close();
  });

  await redis.close();
  await pool.end();
});

