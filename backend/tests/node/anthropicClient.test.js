"use strict";
/**
 * Tests for backend/llm/anthropicClient.js. No network and no API key: every call goes through a stub transport.
 * Run: node --test backend/tests/node/anthropicClient.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MODEL,
  RETIRED_MODELS,
  ANALYSIS_PROFILES,
  ClientError,
  resolveApiKey,
  resolveModelConfig,
  resolveProfile,
  buildRequestBody,
  parseMessageResponse,
  classifyHttpError,
  computeCost,
  resolvePrice,
  parsePriceOverride,
  costMicroUsd,
  ceilMicro,
  PRICING_PER_MTOK,
  callMessages
} = require("../../llm/anthropicClient");

const KEY = "TESTKEY-not-a-real-credential-0001";

function stubTransport(responses) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}

const messageJson = (over = {}) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: "Answer [c1]." }
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 500 },
  ...over
});
const ok = (over) => ({ statusCode: 200, headers: { "request-id": "req_abc" }, body: JSON.stringify(messageJson(over)) });
const httpErr = (statusCode, message, headers = {}) => ({
  statusCode,
  headers,
  body: JSON.stringify({ type: "error", error: { type: "some_error", message } })
});

function opts(transport, extra = {}) {
  return {
    apiKey: KEY,
    model: "claude-sonnet-5-5",
    system: "system prompt",
    user: "user prompt",
    maxTokens: 1000,
    effort: "high",
    transport,
    sleep: async () => {},
    random: () => 0,
    env: {},
    ...extra
  };
}

// ---------------------------------------------------------------- request format (15: Sonnet 5.5 request format)

test("request body for Sonnet 5.5 has exactly the supported keys and no sampling or thinking params", () => {
  const body = buildRequestBody({ model: "claude-sonnet-5-5", system: "s", user: "u", maxTokens: 16000, effort: "high" });
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "output_config", "system"]);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.deepEqual(body.output_config, { effort: "high" });
  assert.deepEqual(body.messages, [{ role: "user", content: "u" }]);
  for (const forbidden of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools"]) {
    assert.equal(forbidden in body, false, `${forbidden} must not be sent to Sonnet 5.5`);
  }
  assert.equal(body.messages[body.messages.length - 1].role, "user", "no assistant prefill: the conversation must end with a user message");
  for (const level of ["low", "medium", "high", "xhigh", "max"]) assert.deepEqual(buildRequestBody({ model: "claude-sonnet-5-5", user: "u", maxTokens: 100, effort: level }).output_config, { effort: level });
  for (const p of Object.values(ANALYSIS_PROFILES)) assert.ok(["low", "medium", "high", "xhigh", "max"].includes(p.effort) && Number.isInteger(p.maxTokens) && p.timeoutMs > 0);
});

test("a stop_reason of model_context_window_exceeded is incomplete output, never a finished answer", () => {
  const cut = parseMessageResponse({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"tldr\": \"half" }], stop_reason: "model_context_window_exceeded", usage: { input_tokens: 5, output_tokens: 7 }, model: "claude-sonnet-5-5" }, "claude-sonnet-5-5");
  assert.equal(cut.truncated, true);
  assert.throws(() => parseMessageResponse({ content: [{ type: "thinking", thinking: "" }], stop_reason: "model_context_window_exceeded" }, "claude-sonnet-5-5"), (e) => e.category === "TRUNCATED_NO_TEXT");
});

test("the request that goes over the wire has the right headers and body", async () => {
  const t = stubTransport([ok()]);
  await callMessages(opts(t));
  const sent = t.calls[0];
  assert.equal(sent.headers["x-api-key"], KEY);
  assert.equal(sent.headers["anthropic-version"], "2023-06-01");
  assert.equal(sent.headers["content-type"], "application/json");
  const body = JSON.parse(sent.body);
  assert.equal(body.max_tokens, 1000);
  assert.equal("temperature" in body, false);
  assert.equal("thinking" in body, false);
  assert.equal(sent.headers["content-length"], Buffer.byteLength(sent.body));
});

test("invalid effort or max_tokens is rejected before any request is made", async () => {
  assert.throws(() => buildRequestBody({ model: "m", user: "u", maxTokens: 10, effort: "adaptive" }), /effort/);
  assert.throws(() => buildRequestBody({ model: "m", user: "u", maxTokens: 0, effort: "low" }), /max_tokens/);
  assert.throws(() => buildRequestBody({ model: "m", user: "u", maxTokens: 128001, effort: "low" }), /max_tokens/);
  const t = stubTransport([ok()]);
  await assert.rejects(callMessages(opts(t, { effort: "bogus" })), (e) => e.category === "INVALID_REQUEST");
  assert.equal(t.calls.length, 0);
});

// ---------------------------------------------------------------- model configuration

test("model defaults to claude-sonnet-5-5 and ANTHROPIC_MODEL wins over LLM_MODEL", () => {
  assert.equal(DEFAULT_MODEL, "claude-sonnet-5-5");
  assert.equal(resolveModelConfig({}).model, "claude-sonnet-5-5");
  assert.equal(resolveModelConfig({}).source, "DEFAULT");
  const both = resolveModelConfig({ ANTHROPIC_MODEL: "claude-opus-5-5", LLM_MODEL: "claude-sonnet-4-6" });
  assert.equal(both.model, "claude-opus-5-5");
  assert.equal(both.source, "ANTHROPIC_MODEL");
  assert.equal(resolveModelConfig({ LLM_MODEL: "claude-sonnet-4-6" }).source, "LLM_MODEL");
});

test("a configured retired model is never used and is flagged", () => {
  for (const retired of ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022"]) {
    assert.ok(RETIRED_MODELS.has(retired));
    const cfg = resolveModelConfig({ ANTHROPIC_MODEL: retired });
    assert.equal(cfg.model, "claude-sonnet-5-5");
    assert.equal(cfg.configuredModelRetired, true);
    assert.equal(cfg.configuredModel, retired);
  }
});

test("analysis profiles leave room for thinking and fall back to STANDARD", () => {
  assert.equal(resolveProfile("quick").effort, "low");
  assert.equal(resolveProfile("QUICK").name, "QUICK");
  assert.equal(resolveProfile(undefined).name, "STANDARD");
  assert.equal(resolveProfile("nonsense").name, "STANDARD");
  assert.ok(resolveProfile("STANDARD").maxTokens >= 16000);
});

test("API key resolution ignores placeholders and a non-Anthropic LLM_API_KEY", () => {
  assert.equal(resolveApiKey({}), null);
  assert.equal(resolveApiKey({ ANTHROPIC_API_KEY: "  sk-a  " }), "sk-a");
  assert.equal(resolveApiKey({ ANTHROPIC_API_KEY: "REPLACE_WITH_REAL_KEY" }), null);
  assert.equal(resolveApiKey({ LLM_API_KEY: "sk-generic" }), "sk-generic");
  assert.equal(resolveApiKey({ LLM_API_KEY: "sk-openai", LLM_PROVIDER: "openai" }), null);
  assert.equal(resolveApiKey({ ANTHROPIC_API_KEY: "sk-a", LLM_API_KEY: "sk-b", LLM_PROVIDER: "openai" }), "sk-a");
});

// ---------------------------------------------------------------- 1: success, 12: usage, 13: cost

test("success reads the text block even when an empty thinking block comes first", async () => {
  const t = stubTransport([ok()]);
  const r = await callMessages(opts(t));
  assert.equal(r.text, "Answer [c1].");
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.truncated, false);
  assert.equal(r.attempts, 1);
  assert.equal(r.requestId, "req_abc");
  assert.deepEqual(r.blockTypes, ["thinking", "text"]);
});

test("usage is taken from the provider response, not estimated", async () => {
  const r = await callMessages(opts(stubTransport([ok({ usage: { input_tokens: 123, output_tokens: 45 } })])));
  assert.deepEqual(r.usage, { inputTokens: 123, outputTokens: 45, totalTokens: 168 });
});

test("missing usage yields null usage and no cost instead of invented numbers", async () => {
  const r = await callMessages(opts(stubTransport([ok({ usage: undefined })])));
  assert.equal(r.usage, null);
  assert.equal(r.costUsd, null);
  assert.equal(r.costStatus, "NOT_AVAILABLE");
});

test("cost is calculated from usage with the Sonnet 5.5 price and labelled ESTIMATED", async () => {
  // 1000 input * $2/M + 500 output * $10/M = 0.002 + 0.005
  const r = await callMessages(opts(stubTransport([ok()])));
  assert.equal(r.costUsd, 0.007);
  assert.equal(r.costStatus, "ESTIMATED");
});

test("cost is null for a model without a verified price, and honours explicit price overrides", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
  assert.deepEqual(computeCost("claude-some-unpriced-model", usage, {}), { costUsd: null, costStatus: "NOT_AVAILABLE" });
  assert.deepEqual(computeCost("claude-sonnet-5-5", null, {}), { costUsd: null, costStatus: "NOT_AVAILABLE" });
  assert.deepEqual(computeCost("claude-sonnet-5-5", usage, {}), { costUsd: 12, costStatus: "ESTIMATED" });
  const over = computeCost("claude-some-unpriced-model", usage, { ANTHROPIC_PRICE_INPUT_PER_MTOK: "1", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "5" });
  assert.deepEqual(over, { costUsd: 6, costStatus: "ESTIMATED" });
  assert.equal(computeCost("claude-sonnet-5-5", usage, { ANTHROPIC_PRICE_INPUT_PER_MTOK: "abc", ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "5" }).costUsd, 12);
});

// ---- price override (audit D1): a blank, zero or malformed override must never produce a free price
const IN = "ANTHROPIC_PRICE_INPUT_PER_MTOK";
const OUT = "ANTHROPIC_PRICE_OUTPUT_PER_MTOK";
const REAL = PRICING_PER_MTOK["claude-sonnet-5-5"];
const USAGE_1M = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };

test("price override: both variables blank (or whitespace) are treated as unset - the real price stays", () => {
  for (const env of [{ [IN]: "", [OUT]: "" }, { [IN]: "   ", [OUT]: "\t" }, {}, { [IN]: undefined, [OUT]: undefined }]) {
    assert.equal(parsePriceOverride(env).state, "UNSET");
    assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), REAL);
    assert.equal(resolvePrice("claude-future-9", env), null, "an unknown model stays unpriced, never free");
    assert.equal(computeCost("claude-sonnet-5-5", USAGE_1M, env).costUsd, 12);
    assert.deepEqual(computeCost("claude-future-9", USAGE_1M, env), { costUsd: null, costStatus: "NOT_AVAILABLE" });
  }
});

test("price override: zero values never establish a zero-cost model", () => {
  for (const env of [{ [IN]: "0", [OUT]: "0" }, { [IN]: "0.0", [OUT]: "0.00" }, { [IN]: "0", [OUT]: "10" }, { [IN]: "2", [OUT]: "0" }]) {
    assert.equal(parsePriceOverride(env).state, "INVALID", JSON.stringify(env));
    assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), REAL, "a known model keeps its real price");
    assert.equal(resolvePrice("claude-future-9", env), null, "an unknown model is not given a free price");
  }
});

test("price override: only one variable set (the other blank or absent) is invalid and not applied", () => {
  for (const env of [{ [IN]: "5", [OUT]: "" }, { [IN]: "", [OUT]: "25" }, { [IN]: "5" }, { [OUT]: "25" }]) {
    assert.equal(parsePriceOverride(env).state, "INVALID", JSON.stringify(env));
    assert.match(parsePriceOverride(env).reason, /both/);
    assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), REAL);
    assert.equal(resolvePrice("claude-future-9", env), null);
  }
});

test("price override: negative and non-finite values are invalid and not applied", () => {
  for (const bad of ["-1", "-0.5", "Infinity", "-Infinity", "NaN", "1e999"]) {
    for (const env of [{ [IN]: bad, [OUT]: "10" }, { [IN]: "2", [OUT]: bad }]) {
      assert.equal(parsePriceOverride(env).state, "INVALID", JSON.stringify(env));
      assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), REAL);
      assert.equal(resolvePrice("claude-future-9", env), null);
    }
  }
});

test("price override: non-numeric values are invalid and not applied", () => {
  for (const bad of ["abc", "1,5", "$2", "2 USD", "0x10", "1e3", ".5", "5.", "--1", "null", "[]"]) {
    const env = { [IN]: bad, [OUT]: "10" };
    assert.equal(parsePriceOverride(env).state, "INVALID", bad);
    assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), REAL, bad);
    assert.equal(resolvePrice("claude-future-9", env), null, bad);
  }
});

test("price override: a valid positive pair applies to EVERY model, known or unknown, and drives the cost", () => {
  const env = { [IN]: "3", [OUT]: "15" };
  assert.deepEqual(parsePriceOverride(env), { state: "VALID", input: 3, output: 15 });
  assert.deepEqual(resolvePrice("claude-future-9", env), { input: 3, output: 15 });
  assert.deepEqual(resolvePrice("claude-sonnet-5-5", env), { input: 3, output: 15 }, "the override replaces a built-in price too");
  assert.equal(computeCost("claude-future-9", USAGE_1M, env).costUsd, 18);
  assert.equal(computeCost("claude-sonnet-5-5", USAGE_1M, env).costUsd, 18);
  const spaced = { [IN]: " 0.5 ", [OUT]: " 2.25 " };
  assert.deepEqual(parsePriceOverride(spaced), { state: "VALID", input: 0.5, output: 2.25 });
  assert.equal(computeCost("claude-future-9", USAGE_1M, spaced).costUsd, 2.75);
});

test("price override: an unknown model with no valid override has no price (fail closed)", () => {
  assert.equal(resolvePrice("claude-future-9", {}), null);
  assert.equal(resolvePrice("", {}), null);
  assert.equal(resolvePrice(undefined, {}), null);
  assert.equal(resolvePrice("constructor", {}), null, "prototype names are not models");
  assert.equal(resolvePrice("__proto__", {}), null);
});

test("a truncated but non-empty answer is returned and flagged", async () => {
  const r = await callMessages(opts(stubTransport([ok({ stop_reason: "max_tokens" })])));
  assert.equal(r.truncated, true);
  assert.equal(r.text, "Answer [c1].");
});

// ---------------------------------------------------------------- 2-7: HTTP errors

for (const [status, category] of [[401, "INVALID_CREDENTIAL"], [403, "INVALID_CREDENTIAL"], [404, "MODEL_UNAVAILABLE"]]) {
  test(`HTTP ${status} maps to ${category} and is not retried`, async () => {
    const t = stubTransport([httpErr(status, "nope")]);
    await assert.rejects(callMessages(opts(t)), (e) => {
      assert.ok(e instanceof ClientError);
      assert.equal(e.category, category);
      assert.equal(e.httpStatus, status);
      assert.equal(e.retryable, false);
      assert.equal(e.attempts, 1);
      return true;
    });
    assert.equal(t.calls.length, 1);
  });
}

test("HTTP 429 is retried honouring retry-after, then succeeds", async () => {
  const sleeps = [];
  const t = stubTransport([httpErr(429, "slow down", { "retry-after": "2" }), ok()]);
  const r = await callMessages(opts(t, { sleep: async (ms) => sleeps.push(ms) }));
  assert.equal(r.attempts, 2);
  assert.equal(t.calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("HTTP 429 that never clears fails with RATE_LIMITED after 1 try + 2 retries", async () => {
  const t = stubTransport([httpErr(429, "slow down")]);
  await assert.rejects(callMessages(opts(t)), (e) => e.category === "RATE_LIMITED" && e.httpStatus === 429 && e.attempts === 3);
  assert.equal(t.calls.length, 3);
});

for (const status of [500, 502, 503, 529]) {
  test(`HTTP ${status} maps to PROVIDER_5XX and is retried with backoff`, async () => {
    const sleeps = [];
    const t = stubTransport([httpErr(status, "provider trouble")]);
    await assert.rejects(callMessages(opts(t, { sleep: async (ms) => sleeps.push(ms) })), (e) => e.category === "PROVIDER_5XX" && e.httpStatus === status && e.attempts === 3);
    assert.equal(t.calls.length, 3);
    assert.deepEqual(sleeps, [500, 1000]);
  });
}

test("a 5xx followed by success recovers", async () => {
  const r = await callMessages(opts(stubTransport([httpErr(503, "busy"), ok()])));
  assert.equal(r.attempts, 2);
  assert.equal(r.text, "Answer [c1].");
});

test("400 with a credit-balance message is INSUFFICIENT_CREDITS; other 400s are INVALID_REQUEST", async () => {
  await assert.rejects(callMessages(opts(stubTransport([httpErr(400, "Your credit balance is too low to access the API")]))), (e) => e.category === "INSUFFICIENT_CREDITS");
  await assert.rejects(callMessages(opts(stubTransport([httpErr(400, "`temperature` may only be set to 1")]))), (e) => e.category === "INVALID_REQUEST" && e.attempts === 1);
});

test("an unexpected status such as 418 is UNKNOWN and not retried", async () => {
  const t = stubTransport([httpErr(418, "teapot")]);
  await assert.rejects(callMessages(opts(t)), (e) => e.category === "UNKNOWN");
  assert.equal(t.calls.length, 1);
});

test("error messages are bounded and never contain the API key", async () => {
  const echoed = httpErr(401, `invalid x-api-key ${"x".repeat(5000)}`);
  await assert.rejects(callMessages(opts(stubTransport([echoed]))), (e) => {
    assert.ok(!e.message.includes(KEY));
    assert.ok(e.message.length < 400);
    return true;
  });
});

test("classifyHttpError keeps the provider request id for support", () => {
  const e = classifyHttpError(500, "{not json", { "request-id": "req_123" });
  assert.equal(e.category, "PROVIDER_5XX");
  assert.equal(e.requestId, "req_123");
});

// ---------------------------------------------------------------- 8-9: network failure and timeout

test("network failures are retried and then reported as NETWORK_ERROR", async () => {
  const t = stubTransport([new ClientError("NETWORK_ERROR", "network failure: ECONNRESET")]);
  await assert.rejects(callMessages(opts(t)), (e) => e.category === "NETWORK_ERROR" && e.attempts === 3);
  assert.equal(t.calls.length, 3);
});

test("a raw (non-ClientError) transport exception is wrapped as NETWORK_ERROR", async () => {
  const t = stubTransport([new Error("boom")]);
  await assert.rejects(callMessages(opts(t, { maxRetries: 0 })), (e) => e instanceof ClientError && e.category === "NETWORK_ERROR");
});

test("timeouts are reported as TIMEOUT and are not retried", async () => {
  const t = stubTransport([new ClientError("TIMEOUT", "request timed out after 180000ms")]);
  await assert.rejects(callMessages(opts(t)), (e) => e.category === "TIMEOUT" && e.attempts === 1);
  assert.equal(t.calls.length, 1);
});

// ---------------------------------------------------------------- 10-11: malformed / missing text

test("a 200 response that is not JSON is MALFORMED_RESPONSE", async () => {
  const t = stubTransport([{ statusCode: 200, headers: {}, body: "<html>gateway</html>" }]);
  await assert.rejects(callMessages(opts(t)), (e) => e.category === "MALFORMED_RESPONSE");
});

test("a 200 response without a content array is MALFORMED_RESPONSE", () => {
  assert.throws(() => parseMessageResponse({ id: "x" }, "m"), (e) => e.category === "MALFORMED_RESPONSE");
  assert.throws(() => parseMessageResponse(null, "m"), (e) => e.category === "MALFORMED_RESPONSE");
  assert.throws(() => parseMessageResponse({ content: "text" }, "m"), (e) => e.category === "MALFORMED_RESPONSE");
});

test("a response with only a thinking block is NO_TEXT_CONTENT", () => {
  const json = messageJson({ content: [{ type: "thinking", thinking: "", signature: "s" }] });
  assert.throws(() => parseMessageResponse(json, "m"), (e) => e.category === "NO_TEXT_CONTENT");
  const blank = messageJson({ content: [{ type: "text", text: "   " }] });
  assert.throws(() => parseMessageResponse(blank, "m"), (e) => e.category === "NO_TEXT_CONTENT");
});

test("thinking that consumed max_tokens before any text is TRUNCATED_NO_TEXT", () => {
  const json = messageJson({ content: [{ type: "thinking", thinking: "", signature: "s" }], stop_reason: "max_tokens" });
  assert.throws(() => parseMessageResponse(json, "m"), (e) => e.category === "TRUNCATED_NO_TEXT");
});

test("stop_reason refusal is REFUSAL", () => {
  const json = messageJson({ content: [], stop_reason: "refusal" });
  assert.throws(() => parseMessageResponse(json, "m"), (e) => e.category === "REFUSAL");
});

test("multiple text blocks are concatenated and the response model is preserved", () => {
  const json = messageJson({ model: "claude-sonnet-5-5", content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] });
  const r = parseMessageResponse(json, "requested");
  assert.equal(r.text, "AB");
  assert.equal(r.model, "claude-sonnet-5-5");
});

// ---------------------------------------------------------------- credentials

test("calling without an API key fails fast without touching the transport", async () => {
  const t = stubTransport([ok()]);
  await assert.rejects(callMessages(opts(t, { apiKey: null })), (e) => e.category === "INVALID_CREDENTIAL");
  assert.equal(t.calls.length, 0);
});

// ---- minimum price (final hardening): no arbitrary floor; the cost arithmetic rounds UP so no positive price makes a call free
//
// Units: a price in USD per million tokens equals micro-USD per token, and micro-USD (0.000001 USD) is the finest unit the budget
// gate and the ledger use. Rounding to nearest made any call under half a micro-USD cost 0; rounding up cannot.

test("tiny positive prices never produce a free call (the cost is at least 1 micro-USD, never 0)", () => {
  const usages = [{ inputTokens: 1, outputTokens: 1 }, { inputTokens: 300, outputTokens: 200 }, { inputTokens: 100_000, outputTokens: 32_000 }];
  for (const p of ["0.000000000001", "0.000001", "0.0001", "0.001", "0.01", "0.1", "0.4999", "0.5", "0.999999", "1"]) {
    const env = { [IN]: p, [OUT]: p };
    assert.equal(parsePriceOverride(env).state, "VALID", p);
    for (const u of usages) {
      const trueMicro = (u.inputTokens + u.outputTokens) * Number(p);
      const c = computeCost("claude-future-9", u, env);
      assert.equal(c.costStatus, "ESTIMATED", p);
      assert.ok(c.costUsd >= 1e-6, `price ${p}, ${u.inputTokens}+${u.outputTokens} tokens: cost ${c.costUsd} must be at least one micro-USD`);
      assert.ok(c.costUsd * 1e6 >= trueMicro - 1e-6, `never below the true cost (${p})`);
      assert.ok(c.costUsd * 1e6 < trueMicro + 1 + 1e-6, `over-charge is under one micro-USD (${p})`);
      assert.ok(Number.isInteger(costMicroUsd(u, { input: Number(p), output: Number(p) })), "whole micro-USD");
    }
  }
});

test("a call that used no tokens costs 0; a price too small to be a number is invalid, not free", () => {
  assert.equal(computeCost("claude-future-9", { inputTokens: 0, outputTokens: 0 }, { [IN]: "0.001", [OUT]: "0.001" }).costUsd, 0);
  const underflow = "0." + "0".repeat(400) + "1"; // parses to the number 0
  assert.equal(Number(underflow), 0);
  assert.equal(parsePriceOverride({ [IN]: underflow, [OUT]: "10" }).state, "INVALID");
  assert.equal(parsePriceOverride({ [IN]: "2", [OUT]: underflow }).state, "INVALID");
  // the smallest positive number that is still a number stays safe
  const smallest = "0." + "0".repeat(323) + "5"; // 5e-324, the smallest positive double
  assert.equal(Number(smallest), 5e-324);
  assert.equal(parsePriceOverride({ [IN]: smallest, [OUT]: smallest }).state, "VALID");
  assert.equal(computeCost("claude-future-9", { inputTokens: 5, outputTokens: 5 }, { [IN]: smallest, [OUT]: smallest }).costUsd, 1e-6, "even the smallest positive price charges one micro-USD for a call that used tokens");
});

test("legitimate prices keep their exact cost (no float drift, no extra micro-USD)", () => {
  const cases = [
    // [input $/MTok, output $/MTok, in tokens, out tokens, expected micro-USD = in*pIn + out*pOut]
    ["2", "10", 1000, 500, 7000],
    ["3", "15", 1234, 567, 12207],
    ["1", "5", 999_999, 1, 1_000_004],
    ["15", "75", 100_000, 32_000, 3_900_000],
    ["0.25", "1.25", 4000, 2000, 3500],
    ["0.15", "0.6", 10_000, 10_000, 7500],
    ["2.75", "0.5", 1_000_000, 1_000_000, 3_250_000]
  ];
  for (const [pi, po, ti, to, micro] of cases) {
    const env = { [IN]: pi, [OUT]: po };
    const c = computeCost("claude-future-9", { inputTokens: ti, outputTokens: to }, env);
    assert.equal(c.costUsd, micro / 1e6, `${pi}/${po} ${ti}+${to}`);
    assert.equal(costMicroUsd({ inputTokens: ti, outputTokens: to }, { input: Number(pi), output: Number(po) }), micro);
  }
  // the built-in price is unchanged by the rounding
  assert.equal(computeCost("claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 500 }, {}).costUsd, 0.007);
});

test("ceilMicro: rounds up real fractions, forgives only floating-point noise just above a whole number", () => {
  assert.equal(ceilMicro(0), 0);
  assert.equal(ceilMicro(1e-9), 1);
  assert.equal(ceilMicro(0.4), 1);
  assert.equal(ceilMicro(7000), 7000);
  assert.equal(ceilMicro(7000.001), 7001, "a real thousandth of a micro-USD is rounded up");
  assert.equal(ceilMicro(0.007 * 1e6), 7000, "0.007 * 1e6 is 7000.000000000001 in binary floating point");
  let wrong = 0;
  for (let n = 1; n <= 200_000; n++) if (ceilMicro((n / 1e6) * 1e6) !== n) wrong++;
  assert.equal(wrong, 0, "a whole number of micro-USD survives the USD round trip");
  assert.equal(costMicroUsd({ inputTokens: NaN, outputTokens: 1 }, { input: 1, output: 1 }), null);
  assert.equal(computeCost("claude-sonnet-5-5", { inputTokens: NaN, outputTokens: 1 }, {}).costStatus, "NOT_AVAILABLE");
});

