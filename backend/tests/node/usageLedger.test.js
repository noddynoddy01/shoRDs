"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { toUsageRow, createUsageLedger, hashUser } = require("../../llm/usageLedger");

const ctx = { kind: "COPILOT", scope: { tenantId: "t1", projectId: "p1" }, uid: "firebase-uid-123", paperId: "doi:10.9999/x.2020", replicaId: "r1" };
const real = { requestId: "req_1", provider: "anthropic", model: "claude-sonnet-5-5", modelMode: "EXTERNAL_CLAUDE", aiCalled: true, fallbackUsed: false, status: "UNVERIFIED", contentCoverage: "FULL_TEXT", latencyMs: 812.4, cache: { status: "MISS" }, tokens: { source: "REAL_PROVIDER", inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCostUsd: null, costStatus: "NOT_MEASURED" } };

test("a real model call: provider-reported tokens, cost stays NULL unless priced, no raw uid", () => {
  const r = toUsageRow({ httpStatus: 200, body: real }, ctx);
  assert.deepEqual({ p: r.provider, m: r.model, i: r.input_tokens, o: r.output_tokens, t: r.total_tokens, c: r.cost_usd, cs: r.cost_status, hit: r.cache_hit, fb: r.fallback, d: r.duration_ms, paper: r.paper_id }, { p: "anthropic", m: "claude-sonnet-5-5", i: 1000, o: 200, t: 1200, c: null, cs: "NOT_MEASURED", hit: false, fb: false, d: 812, paper: "doi:10.9999/x.2020" });
  assert.notEqual(r.user_hash, ctx.uid);
  assert.equal(r.user_hash, hashUser(ctx.uid));
  assert.ok(!JSON.stringify(r).includes("firebase-uid-123"));
  assert.equal(toUsageRow({ httpStatus: 200, body: { ...real, tokens: { ...real.tokens, estimatedCostUsd: 0.0123, costStatus: "ESTIMATED" } } }, ctx).cost_usd, 0.0123);
});

test("a cache hit spends nothing; a gated request is not an AI call; a fallback invents no tokens; an error is recorded by code", () => {
  const hit = toUsageRow({ httpStatus: 200, body: { ...real, cache: { status: "HIT" }, tokens: { source: "CACHE", inputTokens: null } } }, ctx);
  assert.deepEqual({ ai: hit.ai_called, hit: hit.cache_hit, i: hit.input_tokens, cs: hit.cost_status, o: hit.outcome }, { ai: false, hit: true, i: null, cs: "NO_NEW_SPEND", o: "CACHE_HIT" });
  const gated = toUsageRow({ httpStatus: 200, body: { requestId: "g", aiCalled: false, provider: "none", model: null, contentCoverage: "CONTENT_UNAVAILABLE", status: "CONTENT_UNAVAILABLE", tokens: { source: "NONE", costStatus: "NO_AI_CALL", inputTokens: 0 } } }, ctx);
  assert.deepEqual({ ai: gated.ai_called, i: gated.input_tokens, cs: gated.cost_status, cov: gated.coverage }, { ai: false, i: null, cs: "NO_AI_CALL", cov: "CONTENT_UNAVAILABLE" });
  const fb = toUsageRow({ httpStatus: 200, body: { requestId: "f", provider: "local_deterministic", modelMode: "LOCAL_DETERMINISTIC", fallbackUsed: true, fallbackReason: "PROVIDER_X", tokens: { source: "FALLBACK", inputTokens: null } } }, ctx);
  assert.deepEqual({ ai: fb.ai_called, fb: fb.fallback, r: fb.fallback_reason, i: fb.input_tokens }, { ai: false, fb: true, r: "PROVIDER_X", i: null });
  const err = toUsageRow({ httpStatus: 502, body: { ...real, error: "MODEL_OUTPUT_TRUNCATED" } }, ctx);
  assert.equal(err.outcome, "MODEL_OUTPUT_TRUNCATED");
  assert.equal(err.input_tokens, 1000, "a failed answer still cost tokens, and they are recorded");
});

test("recording is best-effort: a database failure is logged (no secrets) and never thrown", async () => {
  const logs = [];
  const pool = { query: async () => { const e = new Error("password authentication failed for user svc"); e.code = "PG_AUTH"; throw e; } };
  const ledger = createUsageLedger({ pool, logger: { error: (m) => logs.push(m) } });
  await ledger.record({ httpStatus: 200, body: real }, ctx);
  assert.equal(ledger.stats().failed, 1);
  assert.equal(ledger.stats().written, 0);
  assert.ok(logs[0].includes("req_1") && !logs[0].includes("password") && !logs[0].includes("firebase-uid-123"));
});
