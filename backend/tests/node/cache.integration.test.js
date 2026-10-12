"use strict";
/** Redis result cache + single-flight de-duplication on the real copilot path, with regression tests for key isolation. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("cache-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAPER = `doi:${fx.FIXTURE_DOI}`;
const PAPER_B = `doi:${fx.DOI_B}`;
const PAPER_MISSING = `doi:${fx.DOI_MISSING}`;

/** A model stub whose answers are numbered ("Answer #n"), so a cache hit is distinguishable from a fresh call. Cites real server chunk ids. */
function countingClient(opts = {}) {
  const c = modelStub({ ...opts, costUsd: 0.002, costStatus: "ESTIMATED", usage: { inputTokens: 500, outputTokens: 60, totalTokens: 560 }, mutate: (kind, payload) => (kind === "question" ? `Answer #${c.calls.length} ${payload}` : payload) });
  return c;
}
const env = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "true" };

test("result cache and de-duplication (real Redis)", { skip }, async (t) => {
  await resetInfra();

  async function twoTenants(R) {
    const a = uniq("a-"), b = uniq("b-"), h = ipHeader();
    const pa = (await R.call("POST", "/api/v1/projects", { token: tok(a), body: { name: "A" }, headers: h })).json.projectId;
    const pb = (await R.call("POST", "/api/v1/projects", { token: tok(b), body: { name: "B" }, headers: h })).json.projectId;
    const ask = (uid, projectId, body = {}) => R.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: { projectId, query: "What was the effect on blood pressure?", paperId: PAPER, ...body }, headers: ipHeader() });
    return { a, b, pa, pb, ask };
  }

  await t.test("an identical request is served from the cache: one model call, honest labelling, no phantom tokens", async () => {
    const model = countingClient();
    const R = await startReplica({ keys, env, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(R);
    const first = await ask(a, pa);
    const second = await ask(a, pa);
    assert.equal(first.status, 200);
    assert.equal(first.json.cache.status, "MISS");
    assert.equal(first.json.tokens.source, "REAL_PROVIDER");
    assert.equal(second.json.cache.status, "HIT");
    assert.equal(second.json.answer, first.json.answer);
    assert.equal(second.json.tokens.source, "CACHE");
    assert.equal(second.json.tokens.inputTokens, null, "a hit spends no tokens, so none are reported as spent");
    assert.equal(second.json.tokens.estimatedCostUsd, 0);
    assert.notEqual(second.json.requestId, first.json.requestId);
    assert.equal(second.json.cache.originalRequestId, first.json.requestId);
    assert.equal(model.calls.length, 1);
    const m = (await R.call("GET", "/api/v1/llm/metrics", { token: tok("x"), headers: ipHeader() }));
    assert.equal(m.status, 403, "metrics are admin-only");
    const snap = R.runtime.telemetry.snapshot();
    assert.equal(snap.cache.hits, 1);
    assert.equal(snap.cache.misses, 1);
    assert.equal(snap.cacheHitRatio, 0.5);
    assert.equal(snap.requests.cacheHit, 1);
    assert.equal(snap.requests.realProvider, 1);
    assert.equal(snap.tokens.totalTokens, 560, "only the real call is counted in token totals");
    await R.close();
  });

  await t.test("isolation: another tenant, another project, another user's personal scope never receive someone else's cached answer", async () => {
    const model = countingClient();
    const R = await startReplica({ keys, env, overrides: { client: model } });
    const { a, b, pa, pb, ask } = await twoTenants(R);
    assert.equal((await ask(a, pa)).json.cache.status, "MISS");
    assert.equal((await ask(b, pb)).json.cache.status, "MISS", "same paper, same text, same question, different tenant");
    assert.equal(model.calls.length, 2);
    // same user, a second project of their own: separate cache scope
    const pa2 = (await R.call("POST", "/api/v1/projects", { token: tok(a), body: { name: "A2" }, headers: ipHeader() })).json.projectId;
    assert.equal((await ask(a, pa2)).json.cache.status, "MISS");
    // no project: personal scope, distinct per user
    assert.equal((await ask(a, undefined)).json.cache.status, "MISS");
    assert.equal((await ask(a, undefined)).json.cache.status, "HIT");
    assert.equal((await ask(b, undefined)).json.cache.status, "MISS", "another user's personal scope is separate");
    assert.equal(model.calls.length, 5);
    await R.close();
  });

  await t.test("isolation: a change in paper, content, question or analysis depth is a different entry", async () => {
    const model = countingClient();
    const R = await startReplica({ keys, env, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(R);
    await ask(a, pa);
    // "content changed": the stored chunks of the paper change (e.g. a re-retrieval found a corrected text) => different content hash
    const changeContent = async () => {
      await R.runtime.pool.query("UPDATE paper_chunks SET text = text || ' (corrected: the effect size was revised)', text_hash = 'changed' WHERE paper_id = $1 AND section = 'RESULTS'", [PAPER]);
    };
    const variants = [
      { paperId: PAPER_B },
      { query: "What were the limitations?" },
      { analysisDepth: "DEEP" }
    ];
    for (const v of variants) assert.equal((await ask(a, pa, v)).json.cache.status, "MISS", JSON.stringify(Object.keys(v)));
    assert.equal(model.calls.length, 4);
    for (const v of variants) assert.equal((await ask(a, pa, v)).json.cache.status, "HIT", "and each variant is cached under its own key");
    assert.equal(model.calls.length, 4);
    assert.equal((await ask(a, pa)).json.cache.status, "HIT", "the original is still its own entry");
    await changeContent();
    assert.equal((await ask(a, pa)).json.cache.status, "MISS", "changed paper content is a different entry");
    assert.equal(model.calls.length, 5);
    assert.equal((await ask(a, pa)).json.cache.status, "HIT");
    await R.close();
  });

  await t.test("isolation: a different model (ANTHROPIC_MODEL) never serves an answer produced by another model", async () => {
    const model = countingClient();
    const A = await startReplica({ keys, env: { ...env, ANTHROPIC_MODEL: "claude-sonnet-5-5" }, overrides: { client: model } });
    const B = await startReplica({ keys, env: { ...env, ANTHROPIC_MODEL: "claude-opus-5-5", ANTHROPIC_PRICE_INPUT_PER_MTOK: "5", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "25" } /* test price: spend control refuses unpriced models, so the second model needs an operator-supplied price */, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(A);
    assert.equal((await ask(a, pa)).json.cache.status, "MISS");
    const askB = (body = {}) => B.call("POST", "/api/v1/copilot/query", { token: tok(a), body: { projectId: pa, query: "What was the effect on blood pressure?", paperId: PAPER, ...body }, headers: ipHeader() });
    const onB = await askB();
    assert.equal(onB.json.cache.status, "MISS");
    assert.equal(model.calls.map((c) => c.model).join(","), "claude-sonnet-5-5,claude-opus-5-5");
    await A.close(); await B.close();
  });

  await t.test("the cache is shared by replicas: computed on A, served as a HIT on B", async () => {
    const model = countingClient();
    const A = await startReplica({ keys, env, overrides: { client: model } });
    const B = await startReplica({ keys, env, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(A);
    assert.equal((await ask(a, pa)).json.cache.status, "MISS");
    const onB = await B.call("POST", "/api/v1/copilot/query", { token: tok(a), body: { projectId: pa, query: "What was the effect on blood pressure?", paperId: PAPER }, headers: ipHeader() });
    assert.equal(onB.json.cache.status, "HIT");
    assert.equal(onB.json.replicaId, B.replicaId, "the response names the replica that served it");
    assert.equal(model.calls.length, 1);
    await A.close(); await B.close();
  });

  await t.test("de-duplication: 8 concurrent identical requests cost ONE model call", async () => {
    const model = countingClient({ delayMs: 400 });
    const R = await startReplica({ keys, env, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(R);
    const rs = await Promise.all(Array.from({ length: 8 }, () => ask(a, pa)));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(model.calls.length, 1, "single-flight: seven callers waited for the first");
    const kinds = rs.map((r) => r.json.cache.status).sort();
    assert.equal(kinds.filter((k) => k === "MISS").length, 1);
    assert.ok(kinds.filter((k) => k === "DEDUPLICATED" || k === "HIT").length === 7, kinds.join(","));
    assert.equal(new Set(rs.map((r) => r.json.answer)).size, 1);
    assert.ok(R.runtime.telemetry.snapshot().cache.dedupWaits >= 1);
    await R.close();
  });

  await t.test("de-duplication across replicas", async () => {
    const model = countingClient({ delayMs: 400 });
    const A = await startReplica({ keys, env, overrides: { client: model } });
    const B = await startReplica({ keys, env, overrides: { client: model } });
    const { a, pa } = await twoTenants(A);
    const body = { projectId: pa, query: "Cross-replica question?", paperId: PAPER };
    const rs = await Promise.all([A, B, A, B].map((R) => R.call("POST", "/api/v1/copilot/query", { token: tok(a), body, headers: ipHeader() })));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(model.calls.length, 1);
    await A.close(); await B.close();
  });

  await t.test("fallbacks, content-unavailable results and truncated answers are never cached", async () => {
    // no key -> local fallback, bypasses the cache entirely
    const F = await startReplica({ keys, env: { AI_CACHE_ENABLED: "true" } });
    const { a, pa, ask } = await twoTenants(F);
    const f1 = await ask(a, pa), f2 = await ask(a, pa);
    assert.equal(f1.json.verificationStatus, "FALLBACK");
    assert.equal(f1.json.cache.status, "BYPASS");
    assert.equal(f2.json.cache.status, "BYPASS");
    // no evidence -> CONTENT_UNAVAILABLE, never cached
    const n = await ask(a, pa, { paperId: PAPER_MISSING });
    assert.equal(n.json.verificationStatus, "CONTENT_UNAVAILABLE");
    assert.equal(n.json.cache.status, "BYPASS");
    await F.close();
    // truncated model answer: served but not stored (same user, same project, same request both times)
    const model = countingClient({ truncated: true });
    const T = await startReplica({ keys, env, overrides: { client: model } });
    const u = uniq("trunc-");
    const p = (await T.call("POST", "/api/v1/projects", { token: tok(u), body: { name: "T" }, headers: ipHeader() })).json.projectId;
    const askT = () => T.call("POST", "/api/v1/copilot/query", { token: tok(u), body: { projectId: p, query: "q?", paperId: PAPER }, headers: ipHeader() });
    const t1 = await askT();
    const t2 = await askT();
    assert.equal(t1.json.truncated, true);
    assert.equal(t1.json.cache.status, "MISS");
    assert.equal(t2.json.cache.status, "MISS", "a truncated answer must not be served again from the cache");
    assert.equal(model.calls.length, 2);
    await T.close();
  });

  await t.test("a provider failure with a configured key yields a labelled fallback that is NOT cached", async () => {
    const failing = { calls: 0, async callMessages() { this.calls++; const e = new Error("[ANTHROPIC_PROVIDER_5XX] HTTP 529"); e.category = "PROVIDER_5XX"; e.httpStatus = 529; throw e; } };
    const R = await startReplica({ keys, env, overrides: { client: failing, logger: { log() {}, warn() {}, error() {} } } });
    const { a, pa, ask } = await twoTenants(R);
    const r1 = await ask(a, pa), r2 = await ask(a, pa);
    for (const r of [r1, r2]) {
      assert.equal(r.status, 200);
      assert.equal(r.json.fallbackUsed, true);
      assert.equal(r.json.modelMode, "LOCAL_DETERMINISTIC");
      assert.equal(r.json.fallbackReason, "PROVIDER_PROVIDER_5XX");
      assert.equal(r.json.cache.status, "MISS", "a fallback is never served from the cache as if it were a model answer");
    }
    assert.equal(failing.calls, 2, "the provider was asked again, so recovery is not masked by a cached fallback");
    await R.close();
  });

  await t.test("a key that later works is not shadowed by an earlier fallback (no poisoned cache)", async () => {
    const F = await startReplica({ keys, env: { AI_CACHE_ENABLED: "true" } });
    const { a, pa, ask } = await twoTenants(F);
    assert.equal((await ask(a, pa)).json.verificationStatus, "FALLBACK");
    const model = countingClient();
    const K = await startReplica({ keys, env, overrides: { client: model } });
    const real = await K.call("POST", "/api/v1/copilot/query", { token: tok(a), body: { projectId: pa, query: "What was the effect on blood pressure?", paperId: PAPER }, headers: ipHeader() });
    assert.equal(real.json.modelMode, "EXTERNAL_CLAUDE");
    assert.equal(real.json.cache.status, "MISS");
    await F.close(); await K.close();
  });

  await t.test("AI_CACHE_ENABLED=false: nothing is cached and telemetry reports it DISABLED, not WIRED", async () => {
    const model = countingClient();
    const R = await startReplica({ keys, env: { ...env, AI_CACHE_ENABLED: "false" }, overrides: { client: model } });
    const { a, pa, ask } = await twoTenants(R);
    await ask(a, pa); await ask(a, pa);
    assert.equal(model.calls.length, 2);
    const snap = R.runtime.telemetry.snapshot();
    assert.equal(snap.runtimeComponents.cache, "DISABLED");
    assert.equal(snap.cache, null);
    await R.close();
  });
});
