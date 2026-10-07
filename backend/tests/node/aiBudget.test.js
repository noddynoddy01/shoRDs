"use strict";
/**
 * AI spend safety: deterministic tests of every budget decision (no network, no provider, no paid call, no real clock).
 * The store is the in-memory one; aiBudget.integration.test.js proves it behaves the same as the Redis one.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  AiPolicyDenied, DENY, loadBudgetConfig, parseEnabled, estimateMaxCost, createAiBudget, createMemoryBudgetStore, scopesFor, dayKey, KILL_KEY
} = require("../../llm/aiBudget");
const { createAiPipeline } = require("../../llm/aiPipeline");
const { modelStub } = require("./helpers");

const T0 = Date.UTC(2026, 9, 6, 10, 0, 0);
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const err = (category, extra = {}) => Object.assign(new Error(category), { category, ...extra });

/** Call options like the real code sends: QUICK profile, a 1000-character prompt. */
const opts = (over = {}) => ({ apiKey: "TESTKEY-not-real", model: "claude-sonnet-5-5", system: "", user: "a".repeat(1000), maxTokens: 6000, effort: "low", timeoutMs: 60000, env: {}, ...over });
const ctx = (over = {}) => ({ tenantId: "tenant_a", projectId: "prj_1", uid: "user_1", ...over });
// QUICK, 1000-byte prompt, sonnet-5-5 ($2 / $10 per MTok): (1000 + 256 framing) x 2 + 6000 x 10 = 62,512 micro-USD per attempt, x2 attempts.
const ATTEMPT = 62512;
const RESERVATION = ATTEMPT * 2;

/** A provider stand-in: records calls, returns a priced result, can fail or be held open. Never touches a network. */
function makeClient({ costUsd = 0.1, fail = null, hold = false } = {}) {
  const c = {
    calls: [],
    held: [],
    next: { costUsd, fail },
    async callMessages(o) {
      c.calls.push(o);
      if (hold) await new Promise((resolve) => c.held.push(resolve));
      if (c.next.fail) throw c.next.fail;
      return { text: "ok", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, stopReason: "end_turn", truncated: false, model: o.model, latencyMs: 1, attempts: 1, requestId: "req_p", costUsd: c.next.costUsd, costStatus: c.next.costUsd === null ? "NOT_AVAILABLE" : "ESTIMATED" };
    },
    release() { while (c.held.length) c.held.shift()(); }
  };
  return c;
}

// clock must exist before the default store is built: wrap so tests use one shared clock object
function setup(options = {}) {
  const clock = { t: T0 };
  const store = options.store || createMemoryBudgetStore({ now: () => clock.t });
  const seeds = [];
  const gate = createAiBudget({
    store,
    seedFromLedger: options.seed || (async (scope) => { seeds.push(scope.kind); return { spentMicro: 0, calls: 0 }; }),
    env: options.env || {},
    logger: options.logger || quiet,
    now: () => clock.t
  });
  return { gate, store, clock, seeds };
}
const run = (gate, client, c = ctx(), o = opts()) => gate.guardClient(client, c).callMessages(o);
const denied = async (promise, category) => {
  // a call that was (wrongly) let through to a held provider would never settle: report that as a failure instead of hanging
  const guard = new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`expected a ${category} denial but the call is still pending (it reached the provider)`)), 1500); if (t.unref) t.unref(); });
  await assert.rejects(Promise.race([promise, guard]), (e) => { assert.ok(e instanceof AiPolicyDenied, `expected a policy denial, got ${e && e.name}: ${e && e.message}`); assert.equal(e.category, category); assert.equal(e.retryable, false); return true; });
};
const peek = (gate, store, kind, c = ctx(), clock) => {
  void gate;
  const sc = scopesFor(require("../../llm/aiBudget").loadBudgetConfig({}), c, clock.t).find((s) => s.kind === kind);
  return store.peek({ scope: sc, nowMs: clock.t });
};

// ------------------------------------------------------------------------------------------------ cost bound

test("estimateMaxCost: documented arithmetic, per attempt and per request", () => {
  const e = estimateMaxCost({ ...opts(), attempts: 1 });
  assert.equal(e.ok, true);
  assert.equal(e.inputTokensBound, 1256);
  assert.equal(e.outputTokensBound, 6000);
  assert.equal(e.perAttemptMicro, ATTEMPT);
  assert.equal(estimateMaxCost({ ...opts(), attempts: 2 }).reservationMicro, RESERVATION);
  // the three analysis profiles on a full 120,000-character prompt (ASCII: 1 byte per character)
  const full = "x".repeat(120000);
  const q = estimateMaxCost({ ...opts({ user: full, maxTokens: 6000 }), attempts: 1 }).perAttemptMicro;
  const s = estimateMaxCost({ ...opts({ user: full, maxTokens: 16000 }), attempts: 1 }).perAttemptMicro;
  const d = estimateMaxCost({ ...opts({ user: full, maxTokens: 32000 }), attempts: 1 }).perAttemptMicro;
  assert.deepEqual([q, s, d], [120256 * 2 + 60000, 120256 * 2 + 160000, 120256 * 2 + 320000]);
});

test("estimateMaxCost: multi-byte text is bounded by its UTF-8 bytes, not its character count", () => {
  const cjk = "论".repeat(1000); // 3 bytes each
  assert.equal(estimateMaxCost({ ...opts({ user: cjk }), attempts: 1 }).inputTokensBound, 3000 + 256);
});

test("estimateMaxCost: an unpriced model cannot be bounded and is refused (never costed as zero)", () => {
  const e = estimateMaxCost({ ...opts({ model: "claude-future-9" }), attempts: 1 });
  assert.equal(e.ok, false);
  assert.equal(e.category, DENY.UNPRICED_MODEL);
  assert.equal(estimateMaxCost({ ...opts({ model: "claude-future-9", env: { ANTHROPIC_PRICE_INPUT_PER_MTOK: "3", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "15" } }), attempts: 1 }).ok, true, "an operator-supplied price makes it boundable");
  assert.equal(estimateMaxCost({ ...opts({ maxTokens: 0 }), attempts: 1 }).category, DENY.COST_UNBOUNDED);
  assert.equal(estimateMaxCost({ ...opts({ maxTokens: 1.5 }), attempts: 1 }).category, DENY.COST_UNBOUNDED);
  assert.equal(estimateMaxCost({ ...opts({ user: undefined }), attempts: 1 }).category, DENY.COST_UNBOUNDED);
});

// ------------------------------------------------------------------------------------------------ configuration

test("config: defaults, explicit unlimited, and malformed values fail at startup instead of silently changing a limit", () => {
  const c = loadBudgetConfig({});
  assert.equal(c.enabled, true);
  assert.equal(c.mode, "enforce");
  assert.equal(c.maxRetries, 1);
  assert.equal(c.scopes.user.dailyMicro, 2_000_000);
  assert.equal(c.scopes.global.dailyMicro, 25_000_000);
  assert.equal(loadBudgetConfig({ AI_BUDGET_USER_DAILY_USD: "unlimited" }).scopes.user.dailyMicro, null);
  assert.equal(loadBudgetConfig({ AI_BUDGET_USER_DAILY_USD: "0.5" }).scopes.user.dailyMicro, 500000);
  for (const bad of [{ AI_BUDGET_USER_DAILY_USD: "abc" }, { AI_BUDGET_USER_DAILY_USD: "-1" }, { AI_BUDGET_USER_DAILY_USD: "0" }, { AI_BUDGET_MODE: "yolo" }, { AI_MAX_PROVIDER_RETRIES: "9" }, { AI_BUDGET_USER_MAX_CONCURRENT: "0" }, { AI_BREAKER_FAILURES: "x" }]) {
    assert.throws(() => loadBudgetConfig(bad), /must be|AI_BUDGET_MODE/, JSON.stringify(bad));
  }
});

test("AI_ENABLED: only recognised true values leave AI on; false AND unrecognised values switch it off (fail closed)", () => {
  for (const v of [undefined, "", "true", "TRUE", "1", "on", "yes"]) assert.equal(parseEnabled(v).enabled, true, String(v));
  for (const v of ["false", "FALSE", "0", "off", "no"]) assert.deepEqual(parseEnabled(v), { enabled: false, invalid: false }, String(v));
  for (const v of ["maybe", "disabled", "2", "fasle"]) assert.deepEqual(parseEnabled(v), { enabled: false, invalid: true }, String(v));
});

// ------------------------------------------------------------------------------------------------ kill switch

test("kill switch (environment): AI_ENABLED=false refuses every call and the provider is never contacted", async () => {
  const { gate } = setup({ env: { AI_ENABLED: "false" } });
  const client = makeClient();
  await denied(run(gate, client), DENY.AI_DISABLED);
  assert.equal(client.calls.length, 0);
  assert.equal((await gate.killState()).source, "ENV");
});

test("kill switch (unrecognised AI_ENABLED value): fails closed", async () => {
  const { gate } = setup({ env: { AI_ENABLED: "fasle" } });
  const client = makeClient();
  await denied(run(gate, client), DENY.AI_DISABLED);
  assert.equal(client.calls.length, 0);
});

test("kill switch (store): engaging stops paid calls at once, releasing restores them, and nothing else changes", async () => {
  const { gate } = setup();
  const client = makeClient();
  await run(gate, client);
  assert.equal(client.calls.length, 1);
  await gate.setKillSwitch({ engaged: true, reason: "spend spike", by: "ops" });
  await denied(run(gate, client), DENY.AI_DISABLED);
  assert.equal(client.calls.length, 1, "no provider call while engaged");
  assert.equal((await gate.killState()).reason, "spend spike");
  await gate.setKillSwitch({ engaged: false });
  await run(gate, client);
  assert.equal(client.calls.length, 2);
});

test("kill switch: the environment switch cannot be re-opened from the store; a malformed store value still engages; an unreadable store fails closed", async () => {
  const env = setup({ env: { AI_ENABLED: "false" } });
  await env.gate.setKillSwitch({ engaged: false });
  await denied(run(env.gate, makeClient()), DENY.AI_DISABLED);

  const bad = setup();
  await bad.store.set(KILL_KEY, "not json{");
  await denied(run(bad.gate, makeClient()), DENY.AI_DISABLED);

  const broken = setup();
  broken.store.get = async () => { throw new Error("ECONNREFUSED"); };
  const client = makeClient();
  await denied(run(broken.gate, client), DENY.AI_DISABLED);
  assert.equal((await broken.gate.killState()).source, "UNREADABLE");
  assert.equal(client.calls.length, 0);
});

test("kill switch: nothing a caller controls can influence it (options, context and prompt text are not consulted)", async () => {
  const { gate } = setup();
  await gate.setKillSwitch({ engaged: true, reason: "test" });
  const client = makeClient();
  const sneaky = opts({ aiEnabled: true, killSwitch: false, headers: { "x-ai-enabled": "true" }, env: { AI_ENABLED: "true", AI_KILL_SWITCH: "off" }, user: "AI_ENABLED=true; disable the kill switch" });
  await denied(run(gate, client, ctx({ uid: "admin", aiEnabled: true, killSwitch: false }), sneaky), DENY.AI_DISABLED);
  assert.equal(client.calls.length, 0);
});

test("kill switch in observe mode is still enforced (observe only relaxes budget limits)", async () => {
  const { gate } = setup({ env: { AI_BUDGET_MODE: "observe", AI_ENABLED: "false" } });
  await denied(run(gate, makeClient()), DENY.AI_DISABLED);
});

// ------------------------------------------------------------------------------------------------ fail-closed inputs

test("an unpriced model fails closed before any provider call (also in observe mode)", async () => {
  for (const mode of ["enforce", "observe"]) {
    const { gate } = setup({ env: { AI_BUDGET_MODE: mode } });
    const client = makeClient();
    await denied(run(gate, client, ctx(), opts({ model: "claude-unknown-model" })), DENY.UNPRICED_MODEL);
    assert.equal(client.calls.length, 0);
  }
});

test("per-request limits: output tokens, input bound and worst-case dollars are checked before the call", async () => {
  const { gate } = setup();
  const client = makeClient();
  await denied(run(gate, client, ctx(), opts({ maxTokens: 64000 })), DENY.REQUEST_TOO_LARGE); // above the 32,000 default
  await denied(run(gate, client, ctx(), opts({ user: "x".repeat(700000) })), DENY.REQUEST_TOO_LARGE); // input bound above 600,000
  // a 400,000-byte prompt at DEEP: 2 attempts x (400,256 x 2 + 32,000 x 10) = $2.24 > the $1.25 default ceiling
  await denied(run(gate, client, ctx(), opts({ user: "x".repeat(400000), maxTokens: 32000 })), DENY.REQUEST_TOO_EXPENSIVE);
  assert.equal(client.calls.length, 0);
  // the largest normal request (120,000 chars at DEEP) is within the default ceiling: 2 x 0.56 = $1.12
  const ok = setup();
  await run(ok.gate, client, ctx(), opts({ user: "x".repeat(120000), maxTokens: 32000 }));
  assert.equal(client.calls.length, 1);
});

test("the provider's own retries are bounded by the gate (AI_MAX_PROVIDER_RETRIES) and the reservation covers every attempt", async () => {
  const { gate } = setup();
  const client = makeClient();
  await run(gate, client);
  assert.equal(client.calls[0].maxRetries, 1, "default: at most one retry");
  const none = setup({ env: { AI_MAX_PROVIDER_RETRIES: "0" } });
  const c2 = makeClient();
  await run(none.gate, c2);
  assert.equal(c2.calls[0].maxRetries, 0);
  assert.equal(none.gate.estimateMaxCost(opts()).reservationMicro, ATTEMPT, "no retries: reservation is one attempt");
  assert.equal(gate.estimateMaxCost(opts()).reservationMicro, RESERVATION, "one retry: reservation is two attempts");
});

// ------------------------------------------------------------------------------------------------ budgets

test("user daily budget: calls are allowed until spend + reservation would exceed it, then refused with no provider call", async () => {
  const { gate, store, clock } = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.5" } });
  const client = makeClient({ costUsd: 0.1 });
  // allowed while 100,000 x k + 125,024 <= 500,000  ->  k = 0..3  ->  4 calls
  for (let i = 0; i < 4; i += 1) await run(gate, client, ctx(), opts({ user: `question ${i}`.padEnd(1000, "a") }));
  assert.equal(client.calls.length, 4);
  await denied(run(gate, client, ctx(), opts({ user: "one more".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED);
  assert.equal(client.calls.length, 4);
  const p = await peek(gate, store, "user", ctx(), clock);
  assert.equal(p.spentMicro, 400000, "charged the real cost of each call");
  assert.equal(p.reservedMicro, 0, "nothing left reserved");
});

test("scopes are independent: another user keeps working, the same user is stopped; project, tenant and global each stop the call", async () => {
  const a = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.15" } });
  const client = makeClient({ costUsd: 0.1 });
  await run(a.gate, client, ctx({ uid: "u1" }));
  await denied(run(a.gate, client, ctx({ uid: "u1" }), opts({ user: "second".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED);
  await run(a.gate, client, ctx({ uid: "u2" }), opts({ user: "other user".padEnd(1000, "a") })); // different user, same tenant/project: allowed

  for (const [name, envKey, scope] of [["project", "AI_BUDGET_PROJECT_DAILY_USD", "project"], ["tenant", "AI_BUDGET_TENANT_DAILY_USD", "tenant"], ["global", "AI_BUDGET_GLOBAL_DAILY_USD", "global"]]) {
    const s = setup({ env: { [envKey]: "0.15" } });
    const c = makeClient({ costUsd: 0.1 });
    await run(s.gate, c, ctx({ uid: "u1" }));
    await assert.rejects(run(s.gate, c, ctx({ uid: "u2" }), opts({ user: `${name} second`.padEnd(1000, "a") })), (e) => e.category === DENY.BUDGET_EXCEEDED && e.details.scope === scope, name);
    assert.equal(c.calls.length, 1, name);
  }
});

test("a reservation is held BEFORE the call: concurrent calls cannot jointly overspend, and the unused part is released afterwards", async () => {
  // user budget $0.2 leaves room for exactly one worst-case reservation ($0.125) at a time
  const { gate, store, clock } = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.2" } });
  const client = makeClient({ costUsd: 0.01, hold: true });
  const first = run(gate, client, ctx(), opts({ user: "first".padEnd(1000, "a") }));
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.length, 1, "the first call is in flight");
  assert.equal((await peek(gate, store, "user", ctx(), clock)).reservedMicro, RESERVATION);
  await denied(run(gate, client, ctx(), opts({ user: "second".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED); // 125,024 + 125,024 > 200,000 although nothing has been spent yet
  assert.equal(client.calls.length, 1);
  client.release();
  await first;
  const after = await peek(gate, store, "user", ctx(), clock);
  assert.equal(after.reservedMicro, 0, "released");
  assert.equal(after.spentMicro, 10000, "only the real $0.01 is charged, not the worst case");
  client.next.costUsd = 0.01;
  const third = run(gate, makeClient({ costUsd: 0.01 }), ctx(), opts({ user: "third".padEnd(1000, "a") }));
  await third; // room again
});

test("concurrency limits: a third simultaneous call for one user is refused, and slots free up when calls finish", async () => {
  const { gate } = setup({ env: { AI_CONCURRENCY_WAIT_MS: "0" } }); // user max concurrent = 2 by default; refuse immediately
  const client = makeClient({ hold: true });
  const p1 = run(gate, client, ctx(), opts({ user: "c1".padEnd(1000, "a") }));
  const p2 = run(gate, client, ctx(), opts({ user: "c2".padEnd(1000, "a") }));
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.length, 2);
  await denied(run(gate, client, ctx(), opts({ user: "c3".padEnd(1000, "a") })), DENY.CONCURRENCY_LIMIT);
  await run(gate, makeClient(), ctx({ uid: "someone_else" }), opts({ user: "c4".padEnd(1000, "a") })); // another user is unaffected
  client.release();
  await Promise.all([p1, p2]);
  await run(gate, makeClient(), ctx(), opts({ user: "c5".padEnd(1000, "a") }));
});

test("concurrency limits: a call that cannot get a slot waits briefly and proceeds when one frees; it is refused when none frees in time", async () => {
  const { gate } = setup({ env: { AI_CONCURRENCY_WAIT_MS: "3000" } });
  const client = makeClient({ hold: true });
  const p1 = run(gate, client, ctx(), opts({ user: "w1".padEnd(1000, "a") }));
  const p2 = run(gate, client, ctx(), opts({ user: "w2".padEnd(1000, "a") }));
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.length, 2);
  const waiting = makeClient();
  const p3 = run(gate, waiting, ctx(), opts({ user: "w3".padEnd(1000, "a") }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(waiting.calls.length, 0, "no provider call while it waits for a slot");
  client.release(); // frees two slots
  await Promise.all([p1, p2]);
  await p3;
  assert.equal(waiting.calls.length, 1, "it proceeded once a slot freed");

  const tight = setup({ env: { AI_CONCURRENCY_WAIT_MS: "400" } }).gate;
  const held = makeClient({ hold: true });
  const h1 = run(tight, held, ctx(), opts({ user: "x1".padEnd(1000, "a") }));
  const h2 = run(tight, held, ctx(), opts({ user: "x2".padEnd(1000, "a") }));
  await new Promise((r) => setImmediate(r));
  const t0 = Date.now();
  await denied(run(tight, makeClient(), ctx(), opts({ user: "x3".padEnd(1000, "a") })), DENY.CONCURRENCY_LIMIT);
  assert.ok(Date.now() - t0 >= 350, "it waited before refusing");
  held.release();
  await Promise.all([h1, h2]);
});

test("budget refusals are never waited for", async () => {
  const { gate } = setup({ env: { AI_CONCURRENCY_WAIT_MS: "5000", AI_BUDGET_USER_DAILY_USD: "0.0001" } });
  const t0 = Date.now();
  await denied(run(gate, makeClient(), ctx(), opts({ user: "b1".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED);
  assert.ok(Date.now() - t0 < 1000);
});

test("optional daily call counts per scope", async () => {
  const { gate } = setup({ env: { AI_BUDGET_PROJECT_DAILY_CALLS: "2" } });
  const client = makeClient({ costUsd: 0.001 });
  await run(gate, client, ctx(), opts({ user: "n1".padEnd(1000, "a") }));
  await run(gate, client, ctx(), opts({ user: "n2".padEnd(1000, "a") }));
  await denied(run(gate, client, ctx(), opts({ user: "n3".padEnd(1000, "a") })), DENY.CALL_LIMIT);
});

test("day rollover: counters are per UTC day and a new day starts from the (re-seeded) ledger", async () => {
  const { gate, clock, seeds } = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.15" } });
  const client = makeClient({ costUsd: 0.1 });
  await run(gate, client);
  await denied(run(gate, client, ctx(), opts({ user: "x2".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED);
  const before = seeds.length;
  clock.t = Date.UTC(2026, 9, 7, 0, 0, 1);
  assert.notEqual(dayKey(T0), dayKey(clock.t));
  await run(gate, client, ctx(), opts({ user: "x3".padEnd(1000, "a") }));
  assert.ok(seeds.length > before, "a new day's counters are seeded again from Postgres");
});

// ------------------------------------------------------------------------------------------------ Postgres authority

test("Postgres is authoritative: a missing counter is seeded from the ledger, so a flushed Redis cannot reset the day to zero", async () => {
  const ledgerSpend = { user: 450000, global: 450000, tenant: 450000, project: 450000 }; // already spent today, per the ai_usage ledger
  const seed = async (scope) => ({ spentMicro: ledgerSpend[scope.kind], calls: 3 });
  const { gate } = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.5" }, seed });
  const client = makeClient({ costUsd: 0.01 });
  await denied(run(gate, client), DENY.BUDGET_EXCEEDED); // 450,000 + 125,024 > 500,000
  assert.equal(client.calls.length, 0);

  // a "restart": brand-new store (as after Redis was flushed) with the same ledger gives the same answer
  const again = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.5" }, seed });
  await denied(run(again.gate, client), DENY.BUDGET_EXCEEDED);
});

test("seeding failure fails closed: the call is refused when the ledger cannot be read", async () => {
  const { gate } = setup({ seed: async () => { throw new Error("pg down"); } });
  const client = makeClient();
  await denied(run(gate, client), DENY.BUDGET_UNAVAILABLE);
  assert.equal(client.calls.length, 0);
});

// ------------------------------------------------------------------------------------------------ settlement and release

test("settlement: a measured cost is charged exactly; an unmeasured cost is charged at the ceiling (never zero)", async () => {
  const a = setup();
  await run(a.gate, makeClient({ costUsd: 0.0123 }));
  assert.equal((await peek(a.gate, a.store, "user", ctx(), a.clock)).spentMicro, 12300);
  const b = setup();
  await run(b.gate, makeClient({ costUsd: null }));
  assert.equal((await peek(b.gate, b.store, "user", ctx(), b.clock)).spentMicro, ATTEMPT, "usage missing: one attempt's worst case is charged");
});

test("failure: errors the provider rejects before generating release the whole reservation; ambiguous ones are charged conservatively", async () => {
  for (const category of ["RATE_LIMITED", "PROVIDER_5XX", "INVALID_REQUEST", "INVALID_CREDENTIAL", "INSUFFICIENT_CREDITS", "MODEL_UNAVAILABLE"]) {
    const { gate, store, clock } = setup();
    await assert.rejects(run(gate, makeClient({ fail: err(category) })), (e) => e.category === category && !e.policyDenied);
    const p = await peek(gate, store, "user", ctx(), clock);
    assert.deepEqual([p.spentMicro, p.reservedMicro, p.concurrent], [0, 0, 0], `${category}: nothing charged, nothing left held`);
  }
  for (const category of ["TIMEOUT", "NETWORK_ERROR", "MALFORMED_RESPONSE", "NO_TEXT_CONTENT", "TRUNCATED_NO_TEXT", "REFUSAL", "UNKNOWN"]) {
    const { gate, store, clock } = setup();
    await assert.rejects(run(gate, makeClient({ fail: err(category) })));
    const p = await peek(gate, store, "user", ctx(), clock);
    assert.deepEqual([p.spentMicro, p.reservedMicro, p.concurrent], [ATTEMPT, 0, 0], `${category}: possibly billed, so one attempt's ceiling is charged and the reservation is gone`);
  }
  const { gate, store, clock } = setup();
  await assert.rejects(run(gate, { callMessages: async () => { throw new TypeError("bug"); } }));
  assert.equal((await peek(gate, store, "user", ctx(), clock)).reservedMicro, 0, "even an unexpected exception releases the reservation");
});

test("a reservation that is never settled (process died) expires by itself and stops blocking the budget", async () => {
  const { gate, store, clock } = setup({ env: { AI_BUDGET_USER_DAILY_USD: "0.2" } });
  const hung = makeClient({ hold: true });
  run(gate, hung, ctx(), opts({ user: "stuck".padEnd(1000, "a") })).catch(() => {}); // never resolves: the "crashed" call
  await new Promise((r) => setImmediate(r));
  await denied(run(gate, makeClient(), ctx(), opts({ user: "next".padEnd(1000, "a") })), DENY.BUDGET_EXCEEDED);
  clock.t += 60000 * 2 + 45000 + 1; // past timeout x attempts + margin
  await run(gate, makeClient({ costUsd: 0.01 }), ctx(), opts({ user: "after expiry".padEnd(1000, "a") }));
  assert.equal((await peek(gate, store, "user", ctx(), clock)).reservedMicro, 0);
  hung.release();
});

test("a failed settlement never loses the provider's real answer (the reservation expires on its own)", async () => {
  const { gate, store } = setup();
  const real = store.settle.bind(store);
  store.settle = async () => { throw new Error("redis went away"); };
  const out = await run(gate, makeClient());
  assert.equal(out.text, "ok");
  store.settle = real;
});

// ------------------------------------------------------------------------------------------------ duplicates

test("concurrent duplicate expensive requests: only one reaches the provider; a later identical request runs normally", async () => {
  const { gate } = setup();
  const client = makeClient({ hold: true });
  const same = opts({ user: "identical request".padEnd(1000, "a") });
  const first = run(gate, client, ctx(), same);
  await new Promise((r) => setImmediate(r));
  await denied(run(gate, client, ctx(), same), DENY.DUPLICATE_IN_FLIGHT);
  await denied(run(gate, client, ctx({ uid: "user_2" }), same), DENY.DUPLICATE_IN_FLIGHT); // same tenant, same prompt: also a duplicate
  assert.equal(client.calls.length, 1);
  // a different tenant asking the same text is NOT a duplicate of another tenant's request
  await run(gate, makeClient(), ctx({ tenantId: "tenant_b", projectId: "prj_9", uid: "user_9" }), same);
  client.release();
  await first;
  await run(gate, makeClient(), ctx(), same); // the lock was released
});

test("the duplicate lock is released when the call fails", async () => {
  const { gate } = setup();
  const same = opts({ user: "will fail then retry".padEnd(1000, "a") });
  await assert.rejects(run(gate, makeClient({ fail: err("TIMEOUT") }), ctx(), same));
  await run(gate, makeClient(), ctx(), same);
});

// ------------------------------------------------------------------------------------------------ retry storms / breaker

test("circuit breaker: repeated provider failures open it and stop calls; a successful probe after the cooldown closes it", async () => {
  const { gate, clock } = setup();
  const failing = makeClient({ fail: err("PROVIDER_5XX", { httpStatus: 503 }) });
  for (let i = 0; i < 5; i += 1) await assert.rejects(run(gate, failing, ctx(), opts({ user: `storm ${i}`.padEnd(1000, "a") })));
  assert.equal(failing.calls.length, 5);
  for (let i = 0; i < 20; i += 1) await denied(run(gate, failing, ctx(), opts({ user: `storm after ${i}`.padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
  assert.equal(failing.calls.length, 5, "a retry storm of 20 more requests reaches the provider 0 times");
  const st = await gate.status();
  assert.equal(st.breaker.open, true);
  clock.t += 31000;
  const healthy = makeClient();
  await run(gate, healthy, ctx(), opts({ user: "probe".padEnd(1000, "a") }));
  assert.equal(healthy.calls.length, 1);
  assert.equal((await gate.status()).breaker.open, false);
  await run(gate, healthy, ctx(), opts({ user: "normal again".padEnd(1000, "a") }));
});

test("circuit breaker: half-open allows ONE probe at a time; a failed probe re-opens it", async () => {
  const { gate, clock } = setup();
  const failing = makeClient({ fail: err("NETWORK_ERROR") });
  for (let i = 0; i < 5; i += 1) await assert.rejects(run(gate, failing, ctx(), opts({ user: `n${i}`.padEnd(1000, "a") })));
  clock.t += 31000;
  const slow = makeClient({ hold: true });
  const probe = run(gate, slow, ctx(), opts({ user: "the probe".padEnd(1000, "a") }));
  await new Promise((r) => setImmediate(r));
  await denied(run(gate, makeClient(), ctx({ uid: "user_2" }), opts({ user: "second caller".padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
  slow.next.fail = err("NETWORK_ERROR");
  slow.release();
  await assert.rejects(probe);
  await denied(run(gate, makeClient(), ctx({ uid: "user_3" }), opts({ user: "third caller".padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
});

test("circuit breaker: a credential or credit failure opens it immediately for the long cooldown; 429 Retry-After is respected", async () => {
  const a = setup();
  await assert.rejects(run(a.gate, makeClient({ fail: err("INSUFFICIENT_CREDITS") })));
  await denied(run(a.gate, makeClient(), ctx(), opts({ user: "x".padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
  a.clock.t += 100000;
  await denied(run(a.gate, makeClient(), ctx(), opts({ user: "y".padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
  a.clock.t += 201000; // 301 s in total
  await run(a.gate, makeClient(), ctx(), opts({ user: "z".padEnd(1000, "a") }));

  const b = setup({ env: { AI_BREAKER_FAILURES: "1" } });
  await assert.rejects(run(b.gate, makeClient({ fail: err("RATE_LIMITED", { retryAfterSeconds: 120 }) })));
  b.clock.t += 60000;
  await denied(run(b.gate, makeClient(), ctx(), opts({ user: "w".padEnd(1000, "a") })), DENY.PROVIDER_COOLDOWN);
  b.clock.t += 61000;
  await run(b.gate, makeClient(), ctx(), opts({ user: "v".padEnd(1000, "a") }));
});

test("errors that do not indicate an unhealthy provider (bad request, refusal) do not open the breaker", async () => {
  const { gate } = setup();
  for (let i = 0; i < 8; i += 1) await assert.rejects(run(gate, makeClient({ fail: err(i % 2 ? "REFUSAL" : "INVALID_REQUEST") }), ctx(), opts({ user: `q${i}`.padEnd(1000, "a") })));
  await run(gate, makeClient(), ctx(), opts({ user: "still open".padEnd(1000, "a") }));
});

// ------------------------------------------------------------------------------------------------ store failure and observe mode

test("fail closed: if the spend-control store is unreachable the paid call is refused and the provider is never contacted", async () => {
  const { gate, store } = setup();
  store.reserve = async () => { throw new Error("ECONNRESET"); };
  const client = makeClient();
  await denied(run(gate, client), DENY.BUDGET_UNAVAILABLE);
  assert.equal(client.calls.length, 0);
  const b = setup();
  b.store.lock = async () => { throw new Error("ECONNRESET"); };
  await denied(run(b.gate, client), DENY.BUDGET_UNAVAILABLE);
});

test("observe mode: budget and concurrency limits are measured but not enforced; spend is still tracked", async () => {
  const { gate, store, clock } = setup({ env: { AI_BUDGET_MODE: "observe", AI_BUDGET_USER_DAILY_USD: "0.15" } });
  const client = makeClient({ costUsd: 0.1 });
  await run(gate, client);
  await run(gate, client, ctx(), opts({ user: "over the limit".padEnd(1000, "a") })); // would be refused in enforce mode
  assert.equal(client.calls.length, 2);
  const st = await gate.status();
  assert.deepEqual(Object.keys(st.counters.wouldDeny), ["BUDGET_EXCEEDED:user"]);
  assert.equal((await peek(gate, store, "user", ctx(), clock)).spentMicro, 200000);
});

// ------------------------------------------------------------------------------------------------ status

test("status reports limits, kill switch, today's global spend and breaker, with nothing invented", async () => {
  const { gate } = setup();
  await run(gate, makeClient({ costUsd: 0.25 }));
  const s = await gate.status();
  assert.equal(s.mode, "enforce");
  assert.equal(s.killSwitch.engaged, false);
  assert.equal(s.limits.scopes.user.dailyUsd, 2);
  assert.equal(s.limits.maxProviderRetries, 1);
  assert.equal(s.today.globalSpentUsd, 0.25);
  assert.equal(s.today.paidCalls, 1);
  assert.equal(s.counters.scope, "THIS_REPLICA_SINCE_START");
  const broken = setup();
  broken.store.peek = async () => { throw new Error("down"); };
  assert.equal((await broken.gate.status()).today, null, "not measured rather than guessed");
});

// ------------------------------------------------------------------------------------------------ through the real pipeline

const PAPER_ID = "arxiv:2401.00001";
const chunks = [
  { chunkId: `${PAPER_ID}_chunk_1`, paperId: PAPER_ID, ordinal: 1, section: "ABSTRACT", heading: "Abstract", text: "We study sparse coding in cortex. Accuracy rose to 91.2 percent." },
  { chunkId: `${PAPER_ID}_chunk_2`, paperId: PAPER_ID, ordinal: 2, section: "RESULTS", heading: "Results", text: "On the held-out set the method reached 91.2 percent accuracy." }
];
function pipelineHarness({ env = {}, budgetEnv = {} } = {}) {
  const stub = modelStub({ costUsd: 0.002, costStatus: "ESTIMATED" });
  const { gate, store, clock } = setup({ env: budgetEnv });
  const paperService = { async resolve() { return { paper: { paperId: PAPER_ID, title: "Sparse coding", coverage: "FULL_TEXT", coverageNotice: null, authors: [], year: 2024 } }; }, async loadChunks() { return chunks; } };
  const pipeline = createAiPipeline({ paperService, client: stub, budget: gate, env: { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001", ANTHROPIC_MODEL: "claude-sonnet-5-5", ...env }, replicaId: "r1", logger: quiet });
  return { pipeline, stub, gate, store, clock };
}
const scope = { tenantId: "tenant_a", projectId: "prj_1" };

test("pipeline: with the gate open the model is called once, and the answer is the real (UNVERIFIED) one", async () => {
  const { pipeline, stub } = pipelineHarness();
  const out = await pipeline.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID }, { scope, uid: "u1" });
  assert.equal(stub.calls.length, 1);
  assert.equal(out.body.modelMode, "EXTERNAL_CLAUDE");
  assert.equal(out.body.fallbackUsed, false);
});

test("pipeline: kill switch engaged -> NO provider call, a clearly labelled local fallback, never labelled real or verified", async () => {
  const { pipeline, stub, gate } = pipelineHarness();
  await gate.setKillSwitch({ engaged: true, reason: "test" });
  for (const out of [
    await pipeline.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID }, { scope, uid: "u1" }),
    await pipeline.analyzePaper({ paperId: PAPER_ID }, { scope, uid: "u1" })
  ]) {
    assert.equal(stub.calls.length, 0);
    assert.equal(out.body.fallbackUsed, true);
    assert.equal(out.body.fallbackReason, "AI_POLICY_AI_DISABLED");
    assert.equal(out.body.modelMode, "LOCAL_DETERMINISTIC");
    assert.notEqual(out.body.verificationStatus, "VERIFIED");
    assert.equal(out.body.tokens.source, "FALLBACK");
    assert.notEqual(out.body.aiCalled, true);
  }
});

test("pipeline: an unpriced configured model fails closed (fallback, zero provider calls)", async () => {
  const { pipeline, stub } = pipelineHarness({ env: { ANTHROPIC_MODEL: "claude-brand-new-model" } });
  const out = await pipeline.analyzePaper({ paperId: PAPER_ID }, { scope, uid: "u1" });
  assert.equal(stub.calls.length, 0);
  assert.equal(out.body.fallbackReason, "AI_POLICY_UNPRICED_MODEL");
});

test("pipeline: a request whose worst case exceeds the user's budget is refused before the call (fallback, zero provider calls)", async () => {
  const { pipeline, stub } = pipelineHarness({ budgetEnv: { AI_BUDGET_USER_DAILY_USD: "0.1" } });
  const out = await pipeline.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID }, { scope, uid: "u1" });
  assert.equal(stub.calls.length, 0);
  assert.equal(out.body.fallbackUsed, true);
  assert.equal(out.body.fallbackReason, "AI_POLICY_BUDGET_EXCEEDED");
});

test("pipeline: a refusal is not poisoned into the cache - once the gate reopens the same question gets a real answer, then a cache hit", async () => {
  const m = new Map();
  const redis = {
    async command(op, key, val, ...rest) {
      op = String(op).toUpperCase();
      if (op === "GET") return m.has(key) ? m.get(key) : null;
      if (op === "EXISTS") return m.has(key) ? 1 : 0;
      if (op === "SET") { if (rest.includes("NX") && m.has(key)) return null; m.set(key, val); return "OK"; }
      throw new Error(`unexpected redis command ${op}`);
    },
    async eval(_s, keys, argv) { if (m.get(keys[0]) === argv[0]) { m.delete(keys[0]); return 1; } return 0; }
  };
  const { createResultCache } = require("../../llm/resultCache");
  const stub = modelStub({ costUsd: 0.002, costStatus: "ESTIMATED" });
  const { gate } = setup();
  const paperService = { async resolve() { return { paper: { paperId: PAPER_ID, title: "Sparse coding", coverage: "FULL_TEXT", coverageNotice: null, authors: [], year: 2024 } }; }, async loadChunks() { return chunks; } };
  const pipeline = createAiPipeline({ paperService, cache: createResultCache({ redis, pollMs: 1, lockMs: 50 }), client: stub, budget: gate, env: { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001", ANTHROPIC_MODEL: "claude-sonnet-5-5" }, replicaId: "r1", logger: quiet });
  const ask = () => pipeline.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID }, { scope, uid: "u1" });
  await gate.setKillSwitch({ engaged: true, reason: "test" });
  assert.equal((await ask()).body.fallbackReason, "AI_POLICY_AI_DISABLED");
  await gate.setKillSwitch({ engaged: false });
  const real = await ask();
  assert.equal(real.body.fallbackUsed, false);
  assert.equal(stub.calls.length, 1);
  await gate.setKillSwitch({ engaged: true, reason: "test again" });
  const hit = await ask(); // a cached answer costs nothing, so it is still served while the switch is engaged
  assert.equal(hit.body.cache.status, "HIT");
  assert.equal(stub.calls.length, 1);
});

test("pipeline: telemetry does not count a policy refusal as a provider error", async () => {
  const records = [];
  const { gate } = setup({ env: { AI_ENABLED: "false" } });
  const stub = modelStub();
  const paperService = { async resolve() { return { paper: { paperId: PAPER_ID, title: "t", coverage: "FULL_TEXT", authors: [], year: 2024 } }; }, async loadChunks() { return chunks; } };
  const pipeline = createAiPipeline({ paperService, client: stub, budget: gate, telemetry: { record: (r) => records.push(r) }, env: { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001" }, replicaId: "r1", logger: quiet });
  await pipeline.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID }, { scope, uid: "u1" });
  const fb = records.find((r) => r.served === "FALLBACK");
  assert.equal(fb.fallbackReason, "AI_POLICY_AI_DISABLED");
  assert.equal(fb.providerError, null);
});

// ------------------------------------------------------------------------------------------------ structure: nothing bypasses the gate

test("structure: the only code that calls the provider client is the gate-wrapped path; the runtime always supplies a gate", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "tests" || e.name === "node_modules" || e.name === "__pycache__" ? [] : walk(path.join(d, e.name))) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []));
  const callers = walk(root).filter((f) => /\.callMessages\(/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f)).sort();
  assert.deepEqual(callers, ["llm/aiBudget.js", "llm/copilotService.js", "llm/intelligence.js"], "a new module that calls the provider must be routed through the spend gate and added here deliberately");
  const rt = fs.readFileSync(path.join(root, "runtime.js"), "utf8");
  assert.ok(/createAiBudget\(/.test(rt) && /createAiPipeline\(\{[^}]*budget/.test(rt), "runtime.js builds a gate and gives it to the pipeline");
  const pl = fs.readFileSync(path.join(root, "llm/aiPipeline.js"), "utf8");
  assert.equal((pl.match(/client: clientFor\(ctx\)/g) || []).length, 2, "both model paths (question and structured analysis) use the gated client");
});
