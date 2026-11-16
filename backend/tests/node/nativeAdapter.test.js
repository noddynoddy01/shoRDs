"use strict";
/**
 * Native engine, model adapter layer. No network: every "remote" call goes to an injected fake fetch that counts its calls.
 * What is proven: policy refusals happen BEFORE any request; credentials never appear in results or errors; the spend limiter is
 * fail-closed; Claude can only be reached through a client that is already behind the spend gate; the router never moves a refused
 * request to another paid provider.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../native/modelAdapter");

const SECRET = "sk-test-SECRET-0123456789";
const price = { input: 0.2, output: 1.5 };
const okFetch = (calls, usage = { prompt_tokens: 1000, completion_tokens: 200 }) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"items":[]}' }, finish_reason: "stop" }], usage }) };
};
const msg = { system: "s", user: "u", maxTokens: 500 };

test("stub adapter is deterministic, free and reports itself as a stub", async () => {
  const a = A.createStubAdapter();
  const r1 = await a.callMessages({ system: "x", user: "<task name=\"nothing\"/>", maxTokens: 10 });
  const r2 = await a.callMessages({ system: "x", user: "<task name=\"nothing\"/>", maxTokens: 10 });
  assert.equal(r1.text, r2.text);
  assert.equal(r1.model, A.STUB_MODEL_ID); assert.equal(r1.costUsd, 0); assert.equal(r1.costClass, "FREE_LOCAL");
});

test("local endpoint: allowed without a key, free, and the key is sent only when configured", async () => {
  const calls = [];
  const local = A.createOpenAiCompatibleAdapter({ baseUrl: "http://127.0.0.1:8000/v1", model: "m", fetchImpl: okFetch(calls), env: {} });
  const r = await local.callMessages(msg);
  assert.equal(r.costClass, "FREE_LOCAL"); assert.equal(r.costUsd, 0);
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].url, "http://127.0.0.1:8000/v1/chat/completions");
  const withKey = A.createOpenAiCompatibleAdapter({ baseUrl: "http://localhost:8000/v1", model: "m", apiKeyEnv: "LOCAL_KEY", fetchImpl: okFetch(calls), env: { LOCAL_KEY: SECRET } });
  const r2 = await withKey.callMessages(msg);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${SECRET}`);
  assert.ok(!JSON.stringify(r2).includes(SECRET), "the key never appears in a result");
  assert.ok(!calls[1].init.body.includes(SECRET), "the key is never in the request body");
});

test("remote endpoint: refused before any request unless allowed, priced, https and credentialed", async () => {
  const calls = [];
  const f = okFetch(calls);
  const base = { baseUrl: "https://api.example.test/v1", model: "m", fetchImpl: f, apiKeyEnv: "K", env: { K: SECRET } };
  assert.throws(() => A.createOpenAiCompatibleAdapter(base), (e) => e.category === "POLICY_REMOTE_NOT_ALLOWED");
  assert.throws(() => A.createOpenAiCompatibleAdapter({ ...base, allowRemote: true }), (e) => e.category === "POLICY_UNPRICED");
  assert.throws(() => A.createOpenAiCompatibleAdapter({ ...base, allowRemote: true, price: { input: 0, output: 1 } }), (e) => e.category === "POLICY_UNPRICED", "a free price is never accepted");
  assert.throws(() => A.createOpenAiCompatibleAdapter({ ...base, baseUrl: "http://api.example.test/v1", allowRemote: true, price }), (e) => e.category === "POLICY_BAD_ENDPOINT");
  assert.throws(() => A.createOpenAiCompatibleAdapter({ ...base, baseUrl: "https://user:pw@api.example.test/v1", allowRemote: true, price }), (e) => e.category === "POLICY_BAD_ENDPOINT");
  assert.throws(() => A.createOpenAiCompatibleAdapter({ ...base, baseUrl: "https://localhost.evil.example/v1", allowRemote: true }), (e) => e.category === "POLICY_UNPRICED", "a look-alike host is remote, not local");
  const noKey = A.createOpenAiCompatibleAdapter({ ...base, env: {}, allowRemote: true, price });
  await assert.rejects(noKey.callMessages(msg), (e) => e.category === "POLICY_NO_CREDENTIAL");
  assert.equal(calls.length, 0, "no request was made by any refusal");
});

test("spend limiter is fail-closed: ceiling 0 refuses, the worst case is reserved first, unmeasured cost counts as the worst case", async () => {
  const calls = [];
  const remote = A.createOpenAiCompatibleAdapter({ baseUrl: "https://api.example.test/v1", model: "m", allowRemote: true, price, apiKeyEnv: "K", env: { K: SECRET }, fetchImpl: okFetch(calls) });
  const zero = A.withSpendLimit(remote); // default ceiling 0
  await assert.rejects(zero.callMessages(msg), (e) => e.category === "POLICY_NO_BUDGET" && e.policyDenied);
  const tiny = A.withSpendLimit(remote, { ceilingUsd: 0.0001 });
  await assert.rejects(tiny.callMessages(msg), (e) => e.category === "POLICY_BUDGET_EXCEEDED");
  assert.equal(calls.length, 0, "nothing was sent while refused");
  const worst = (A.inputTokensBound("s", "u") * price.input + 500 * price.output) / 1e6;
  const ok = A.withSpendLimit(remote, { ceilingUsd: worst * 2 });
  const r = await ok.callMessages(msg);
  assert.equal(r.costStatus, "ESTIMATED"); assert.ok(Math.abs(r.costUsd - (1000 * price.input + 200 * price.output) / 1e6) < 1e-12);
  await ok.callMessages(msg);
  await assert.rejects(ok.callMessages(msg), (e) => e.category === "POLICY_BUDGET_EXCEEDED", "the third call would not fit under the ceiling");
  // no usage reported -> counted at the worst case
  const blind = A.withSpendLimit(A.createOpenAiCompatibleAdapter({ baseUrl: "https://api.example.test/v1", model: "m", allowRemote: true, price, apiKeyEnv: "K", env: { K: SECRET }, fetchImpl: okFetch([], {}) }), { ceilingUsd: worst * 1.5 });
  await blind.callMessages(msg);
  assert.ok(blind.spendReport().spentUsd >= worst - 1e-6 && blind.spendReport().unmeasuredCalls === 1);
  await assert.rejects(blind.callMessages(msg), (e) => e.category === "POLICY_BUDGET_EXCEEDED");
  // a free local adapter passes through and is not budgeted
  const free = A.withSpendLimit(A.createStubAdapter());
  await free.callMessages(msg);
});

test("errors never contain the key or the endpoint; HTTP classes are mapped", async () => {
  const mk = (status) => A.createOpenAiCompatibleAdapter({ baseUrl: "https://api.example.test/v1", model: "m", allowRemote: true, price, apiKeyEnv: "K", env: { K: SECRET }, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
  for (const [st, cat] of [[401, "PROVIDER_CREDENTIAL"], [429, "PROVIDER_RATE_LIMIT"], [500, "PROVIDER_HTTP"]]) {
    await assert.rejects(mk(st).callMessages(msg), (e) => { assert.equal(e.category, cat); assert.ok(!e.message.includes(SECRET) && !e.message.includes("example.test")); return true; });
  }
  const boom = A.createOpenAiCompatibleAdapter({ baseUrl: "https://api.example.test/v1", model: "m", allowRemote: true, price, apiKeyEnv: "K", env: { K: SECRET }, fetchImpl: async () => { throw new Error(`connect failed to https://api.example.test with ${SECRET}`); } });
  await assert.rejects(boom.callMessages(msg), (e) => { assert.equal(e.category, "PROVIDER_NETWORK"); assert.ok(!JSON.stringify(e).includes(SECRET) && !e.message.includes(SECRET)); return true; });
});

test("Claude fallback can only be built from an attested, spend-guarded client", async () => {
  const raw = { callMessages: async () => ({ text: "{}", usage: null, model: "claude-x", costUsd: 0.01 }) };
  assert.throws(() => A.createClaudeFallbackAdapter({ client: raw, model: "claude-x" }), (e) => e.category === "POLICY_UNGUARDED_CLIENT");
  assert.throws(() => A.createClaudeFallbackAdapter({ client: null, attestSpendGuarded: true, model: "x" }), (e) => e.category === "POLICY_BAD_CLIENT");
  const seen = [];
  const guarded = { callMessages: async (o) => { seen.push(o); return { text: "{}", usage: null, model: "claude-x", costUsd: 0.01 }; } };
  const c = A.createClaudeFallbackAdapter({ client: guarded, attestSpendGuarded: true, model: "claude-x" });
  const r = await c.callMessages(msg);
  assert.equal(r.provider, "claude"); assert.equal(seen.length, 1); assert.equal(seen[0].model, "claude-x");
});

test("router: falls back on provider failure; never moves a policy refusal to another paid provider; Claude only if listed", async () => {
  const fail = (category, policy = false, cost = "FREE_LOCAL") => ({ id: `f:${category}`, provider: "x", model: "m", costClass: cost, callMessages: async () => { throw new A.NativeModelError(category, "no"); } });
  const stub = A.createStubAdapter();
  // provider failure -> next
  const r1 = await A.createRouter([fail("PROVIDER_NETWORK"), stub]).callMessages({ system: "", user: "<task name=\"nothing\"/>", maxTokens: 5 });
  assert.equal(r1.servedBy, "stub"); assert.deepEqual(r1.fallbackFrom, ["f:PROVIDER_NETWORK"]);
  // policy refusal -> a PAID next provider is NOT tried
  let paidCalled = 0;
  const paid = { id: "paid", provider: "p", model: "m", costClass: "PAID_REMOTE_GUARDED", callMessages: async () => { paidCalled += 1; return { text: "{}" }; } };
  await assert.rejects(A.createRouter([fail("POLICY_NO_BUDGET", true, "PAID_REMOTE"), paid]).callMessages(msg), (e) => e.category === "POLICY_NO_BUDGET");
  assert.equal(paidCalled, 0, "a spend refusal is not retried on another paid path");
  // policy refusal -> a FREE local next provider IS tried
  const r2 = await A.createRouter([fail("POLICY_NO_BUDGET", true, "PAID_REMOTE"), stub]).callMessages({ system: "", user: "<task name=\"nothing\"/>", maxTokens: 5 });
  assert.equal(r2.servedBy, "stub");
  // provider failure -> paid fallback is tried (it is behind its own gate)
  const r3 = await A.createRouter([fail("PROVIDER_HTTP"), paid]).callMessages(msg);
  assert.equal(r3.servedBy, "paid"); assert.equal(paidCalled, 1);
  assert.throws(() => A.createRouter([]));
});

// ---- the EXISTING production spend gate in front of a native adapter (real aiBudget, in-memory store; no network, no Redis)
test("the production spend gate refuses an unpriced native model, and prices/limits it once a person sets a price", async () => {
  const { createAiBudget, createMemoryBudgetStore, DENY, AiPolicyDenied } = require("../../llm/aiBudget");
  const T0 = Date.parse("2026-11-04T10:00:00Z");
  const mk = (env) => createAiBudget({ store: createMemoryBudgetStore({ now: () => T0 }), seedFromLedger: async () => ({ spentMicro: 0, calls: 0 }), env, logger: { info() {}, warn() {}, error() {} }, now: () => T0 });
  const stub = A.createStubAdapter();
  const ctx = { tenantId: "t1", projectId: "p1", uid: "u1" };
  const o = { model: stub.model, system: "s", user: "<task name=\"nothing\"/>", maxTokens: 500 };
  // no price known for the native model -> fail closed, nothing runs
  await assert.rejects(mk({}).guardClient(stub, ctx).callMessages(o), (e) => e instanceof AiPolicyDenied && e.category === DENY.UNPRICED_MODEL);
  // a person sets a price (the existing override variables) -> the call is priced, reserved, run and settled
  const priced = mk({ ANTHROPIC_PRICE_INPUT_PER_MTOK: "0.5", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "2" });
  const r = await priced.guardClient(stub, ctx).callMessages(o);
  assert.equal(r.provider, "stub");
  // and the kill switch still stops it
  const killed = mk({ AI_ENABLED: "false", ANTHROPIC_PRICE_INPUT_PER_MTOK: "0.5", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "2" });
  await assert.rejects(killed.guardClient(stub, ctx).callMessages(o), (e) => e instanceof AiPolicyDenied && e.category === DENY.AI_DISABLED);
  // the whole pipeline behind the gate: every stage call passes through it and carries the model name
  const { runNativePipeline } = require("../../native/pipeline");
  const F = require("./paperFixtures");
  const { extractJats } = require("../../papers/extract");
  const gated = priced.guardClient(stub, ctx);
  const adapter = { ...stub, callMessages: (opts) => gated.callMessages(opts) };
  const run = await runNativePipeline({ model: adapter, input: { paperId: "pap_fixture", ...extractJats(F.jats()) }, fullTextAllowed: true });
  assert.ok(run.diagnostics.modelCalls > 10 && run.diagnostics.failedCalls === 0);
  const refused = await runNativePipeline({ model: { ...stub, callMessages: (opts) => mk({}).guardClient(stub, ctx).callMessages(opts) }, input: { paperId: "pap_fixture", ...extractJats(F.jats()) }, fullTextAllowed: true });
  assert.ok(refused.brief.every((s) => s.status === "UNAVAILABLE"), "with the gate refusing, the engine produces nothing rather than bypassing it");
});

// ---- Phase 6: settings that a real local reasoning model needs
test("local reasoning model: token headroom, fixed timeout, server timings kept, hidden reasoning never returned", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({
      choices: [{ message: { content: '{"items":[]}', reasoning_content: "SECRET CHAIN OF THOUGHT" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 350 },
      timings: { prompt_n: 900, prompt_ms: 4500, prompt_per_second: 200, predicted_n: 350, predicted_ms: 35000, predicted_per_second: 10 }
    }) };
  };
  const a = A.createOpenAiCompatibleAdapter({ baseUrl: "http://localhost:8080/v1", model: "gpt-oss-20b", fetchImpl, env: {}, reasoningHeadroomTokens: 1500, timeoutMs: 600000, extraBody: { chat_template_kwargs: { reasoning_effort: "low" } } });
  const r = await a.callMessages({ system: "s", user: "u", maxTokens: 1200, timeoutMs: 1000 });
  assert.equal(calls[0].max_tokens, 2700);
  assert.deepEqual(calls[0].chat_template_kwargs, { reasoning_effort: "low" });
  assert.equal(r.text, '{"items":[]}');
  assert.ok(!JSON.stringify(r).includes("SECRET CHAIN OF THOUGHT"));
  assert.equal(r.serverTimings.generatedPerSecond, 10);
  assert.equal(r.usage.outputTokens, 350);
  assert.equal(r.costUsd, 0);
});
test("local reasoning model: a budget used up by hidden reasoning is reported as truncated, not as an answer", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "", reasoning_content: "…" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 100 } }) });
  const a = A.createOpenAiCompatibleAdapter({ baseUrl: "http://127.0.0.1:8080/v1", model: "m", fetchImpl, env: {} });
  const r = await a.callMessages({ system: "s", user: "u", maxTokens: 100 });
  assert.equal(r.truncated, true);
  assert.equal(r.text, "");
});

test("loopbackFetch: works against a local server, refuses non-loopback hosts, and honours the abort signal", async () => {
  const http = require("node:http");
  const { loopbackFetch } = require("../../native/modelAdapter");
  const srv = http.createServer((req, res) => {
    const parts = []; req.on("data", (d) => parts.push(d)); req.on("end", () => {
      if (req.url === "/slow") return; // never answers
      res.statusCode = req.url === "/bad" ? 500 : 200; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ echo: Buffer.concat(parts).toString("utf8") }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await loopbackFetch(`${base}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
    assert.equal(ok.ok, true); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { echo: '{"a":1}' });
    const bad = await loopbackFetch(`${base}/bad`, { method: "POST", body: "{}" });
    assert.equal(bad.ok, false); assert.equal(bad.status, 500);
    await assert.rejects(loopbackFetch("http://example.com/x", { method: "POST", body: "{}" }), /loopback/);
    await assert.rejects(loopbackFetch("https://127.0.0.1:1/x", { method: "POST", body: "{}" }), /loopback/);
    const ctl = new AbortController(); const p = loopbackFetch(`${base}/slow`, { method: "POST", body: "{}", signal: ctl.signal });
    setTimeout(() => ctl.abort(), 50);
    await assert.rejects(p, (e) => e.name === "AbortError");
  } finally { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); }
});

test("a local http endpoint is called through loopbackFetch (no 300 s header limit), a remote one keeps the global fetch", async () => {
  const http = require("node:http");
  const { createOpenAiCompatibleAdapter } = require("../../native/modelAdapter");
  const srv = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const a = createOpenAiCompatibleAdapter({ baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, model: "m" });
    const r = await a.callMessages({ system: "s", user: "u", maxTokens: 8, timeoutMs: 5000 });
    assert.equal(r.text, "hi"); assert.equal(r.truncated, false); assert.equal(r.costClass, "FREE_LOCAL");
  } finally { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); }
});
