"use strict";
/**
 * Model adapter layer of the shoRDs-native research engine (Phase 5B, PROTOTYPE, not wired into the production analysis path).
 *
 * One interface for every model the engine may use:
 *     adapter.callMessages({ system, user, maxTokens, timeoutMs, task }) -> {
 *         text, usage:{inputTokens,outputTokens,totalTokens}, stopReason, truncated, model, provider, costClass,
 *         latencyMs, attempts, requestId, costUsd, costStatus }
 * The shape is deliberately the same as the existing `client.callMessages` seam (llm/anthropicClient.js), so an adapter can sit
 * behind `aiBudget.guardClient(...)` unchanged, and it fits the GatewayRequest/GatewayResult contract of
 * docs/architecture/AI_GATEWAY_DESIGN.md (ADR-005).
 *
 * Adapters
 *   stub              built-in deterministic extractive component (extractiveStub.js). NOT a language model; free, offline.
 *   openaiCompatible  any server that speaks the OpenAI chat-completions protocol: a local llama.cpp / vLLM / Ollama process
 *                     (costClass FREE_LOCAL) or a hosted open-weight endpoint (costClass PAID_REMOTE). Never contacted by a test.
 *   claudeFallback    optional fallback to the EXISTING Anthropic client. It needs the client that is ALREADY wrapped by the spend
 *                     gate (aiBudget.guardClient) and refuses to be built from anything else.
 *
 * Safety properties (each one is tested in backend/tests/node/nativeAdapter.test.js)
 *   - Credentials are read from the process environment at call time, only on the server, and never appear in a result, an error
 *     message, a log line or a cache key.
 *   - A remote (non-loopback) endpoint is refused unless the caller opted in AND gave a verified price AND a spend ceiling above 0.
 *   - The spend limiter is fail-closed: its default ceiling is 0 USD, so a paid adapter cannot make a call until a person sets one.
 *     Worst case is reserved BEFORE the call exactly like the production gate (bytes of the prompt as an upper bound on input tokens,
 *     max output tokens at the output price); an unmeasured cost is counted at its worst case, never at zero.
 *   - The router never retries a spend/policy refusal on another paid provider, and Claude is used only when it was listed explicitly.
 *   - Raw model text is returned to the pipeline only; the pipeline never returns it to a caller (see pipeline.js).
 */

const crypto = require("crypto");
const { stubComplete, STUB_MODEL_ID } = require("./extractiveStub");

const FRAMING_TOKENS = 64; // same allowance as llm/aiBudget.js
const MAX_RESPONSE_CHARS = 400_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

class NativeModelError extends Error {
  constructor(category, message, extra = {}) {
    super(message);
    this.name = "NativeModelError";
    this.category = category; // POLICY_* = refused before any call; PROVIDER_* = the call was attempted
    this.policyDenied = String(category).startsWith("POLICY_");
    Object.assign(this, extra);
  }
}

const usageOf = (inputTokens, outputTokens) => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
const approxTokens = (s) => Math.ceil(Buffer.byteLength(String(s || ""), "utf8") / 3.5); // report-only estimate, never used as a bound

/** Upper bound of input tokens: one byte = one token, the same conservative rule the production spend gate uses. */
function inputTokensBound(system, user) {
  return Buffer.byteLength(system || "", "utf8") + Buffer.byteLength(user || "", "utf8") + FRAMING_TOKENS;
}

function validPrice(p) {
  return Boolean(p) && Number.isFinite(p.input) && Number.isFinite(p.output) && p.input > 0 && p.output > 0; // a free price is never produced
}

/**
 * The ONE place the rest of the native engine calls a model through. Keeping every call site in this file means the structure guard in
 * tests/node/aiBudget.test.js ("the only code that calls the provider client is the gate-wrapped path") needs a single deliberate entry for
 * the native engine instead of one per stage, and a stage cannot reach a provider by any other route.
 */
function invoke(model, opts) { return model.callMessages({ model: model.model, ...opts }); } // carries the model name so a spend gate placed in front can price the call

// ------------------------------------------------------------------------------------------------------------- stub

function createStubAdapter() {
  let n = 0;
  return {
    id: "stub",
    provider: "stub",
    model: STUB_MODEL_ID,
    costClass: "FREE_LOCAL",
    async callMessages(opts) {
      const t0 = Date.now();
      const text = stubComplete(opts.system || "", opts.user || "");
      n += 1;
      return {
        text,
        usage: usageOf(approxTokens((opts.system || "") + (opts.user || "")), approxTokens(text)),
        stopReason: "end_turn", truncated: false, model: STUB_MODEL_ID, provider: "stub", costClass: "FREE_LOCAL",
        latencyMs: Date.now() - t0, attempts: 1, requestId: `stub_${n}`, costUsd: 0, costStatus: "FREE_LOCAL"
      };
    }
  };
}

// ------------------------------------------------------------------------------------------ OpenAI-compatible endpoint

function parseBase(baseUrl) {
  let u;
  try { u = new URL(baseUrl); } catch (_) { throw new NativeModelError("POLICY_BAD_ENDPOINT", "endpoint is not a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new NativeModelError("POLICY_BAD_ENDPOINT", "endpoint must be http or https");
  if (u.username || u.password) throw new NativeModelError("POLICY_BAD_ENDPOINT", "credentials in the endpoint URL are not accepted; use the key variable");
  return u;
}


/**
 * HTTP client for a model server on this machine (loopback only). Node's built-in fetch gives up when the server has not started
 * its answer within 300 s (undici headersTimeout). A non-streaming request to a local model answers only when generation is done,
 * so a long prompt on a small GPU crossed that line and failed as "fetch failed" with nothing wrong on the server. node:http has no
 * such limit; the adapter's own timer (cfg.timeoutMs, capped at 30 min) is the only clock. Same shape as fetch for what the adapter reads.
 */
function loopbackFetch(url, init = {}) {
  const http = require("node:http");
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) return reject(new Error("loopbackFetch is for http://127.0.0.1-style endpoints only"));
    const req = http.request({ hostname: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || 80, path: u.pathname + u.search, method: init.method || "GET", headers: init.headers || {}, agent: false }, (res) => {
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => { const text = Buffer.concat(parts).toString("utf8"); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => text, json: async () => JSON.parse(text) }); });
      res.on("error", reject);
    });
    req.on("error", (e) => reject(e));
    if (init.signal) { const onAbort = () => { const e = new Error("aborted"); e.name = "AbortError"; req.destroy(e); }; if (init.signal.aborted) return onAbort(); init.signal.addEventListener("abort", onAbort, { once: true }); }
    if (init.body) req.write(init.body);
    req.end();
  });
}

/**
 * @param {{baseUrl:string, model:string, apiKeyEnv?:string, env?:object, fetchImpl?:Function, price?:{input:number,output:number},
 *          allowRemote?:boolean, jsonMode?:boolean, extraBody?:object, timeoutMs?:number, reasoningHeadroomTokens?:number}} cfg
 *   price = USD per million tokens (verified by a person).
 *   timeoutMs: per-call timeout that replaces the caller's (a local CPU model can need minutes per call; capped at 30 minutes).
 *   reasoningHeadroomTokens: tokens ADDED to the caller's max output for models that spend part of the budget on hidden reasoning (gpt-oss).
 *   The hidden reasoning text, if the server returns it, is never returned or stored by this adapter; only its absence from `text` matters.
 */
function createOpenAiCompatibleAdapter(cfg) {
  const u = parseBase(cfg.baseUrl);
  const env = cfg.env || process.env;
  const local = LOOPBACK.has(u.hostname);
  if (!cfg.model || typeof cfg.model !== "string") throw new NativeModelError("POLICY_BAD_ENDPOINT", "a model name is required");
  if (!local) {
    if (cfg.allowRemote !== true) throw new NativeModelError("POLICY_REMOTE_NOT_ALLOWED", "a remote endpoint needs allowRemote:true set by a person; nothing was contacted");
    if (!validPrice(cfg.price)) throw new NativeModelError("POLICY_UNPRICED", "a remote endpoint needs a verified positive price per million tokens; nothing was contacted");
    if (u.protocol !== "https:") throw new NativeModelError("POLICY_BAD_ENDPOINT", "a remote endpoint must use https");
  }
  const doFetch = cfg.fetchImpl || (local && u.protocol === "http:" ? loopbackFetch : (typeof fetch === "function" ? fetch : null));
  const endpoint = `${u.origin}${u.pathname.replace(/\/+$/, "")}/chat/completions`;
  let seq = 0;

  return {
    id: `openai-compatible:${cfg.model}`,
    provider: "openai-compatible",
    model: cfg.model,
    costClass: local ? "FREE_LOCAL" : "PAID_REMOTE",
    price: local ? null : cfg.price,
    async callMessages(opts) {
      if (!doFetch) throw new NativeModelError("PROVIDER_UNAVAILABLE", "no fetch implementation");
      const key = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined;
      if (!local && !key) throw new NativeModelError("POLICY_NO_CREDENTIAL", "no credential configured for the remote endpoint; nothing was contacted");
      const headers = { "content-type": "application/json" };
      if (key) headers.authorization = `Bearer ${key}`;
      const headroom = Number.isInteger(cfg.reasoningHeadroomTokens) && cfg.reasoningHeadroomTokens > 0 ? Math.min(cfg.reasoningHeadroomTokens, 16000) : 0;
      const body = {
        model: cfg.model, temperature: 0, max_tokens: (Number(opts.maxTokens) || 1024) + headroom,
        messages: [{ role: "system", content: opts.system || "" }, { role: "user", content: opts.user || "" }],
        ...(cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(cfg.extraBody || {})
      };
      const ctl = new AbortController();
      const timeoutMs = Number(cfg.timeoutMs) > 0 ? Math.min(Number(cfg.timeoutMs), 30 * 60 * 1000) : Number(opts.timeoutMs) || 180000;
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const t0 = Date.now();
      let res;
      try {
        res = await doFetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
      } catch (err) {
        throw new NativeModelError(err && err.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK", "the model endpoint could not be reached"); // message never includes the URL or key
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new NativeModelError(res.status === 401 || res.status === 403 ? "PROVIDER_CREDENTIAL" : res.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_HTTP", `the model endpoint answered HTTP ${res.status}`, { httpStatus: res.status });
      let json;
      try { json = await res.json(); } catch (_) { throw new NativeModelError("PROVIDER_BAD_RESPONSE", "the model endpoint answered with something that is not JSON"); }
      const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
      const text = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : null;
      if (text === null || text.length > MAX_RESPONSE_CHARS) throw new NativeModelError("PROVIDER_BAD_RESPONSE", "the model endpoint answered without usable text");
      const u0 = json.usage || {};
      const inTok = Number.isInteger(u0.prompt_tokens) ? u0.prompt_tokens : null;
      const outTok = Number.isInteger(u0.completion_tokens) ? u0.completion_tokens : null;
      const measured = inTok !== null && outTok !== null;
      let costUsd = 0, costStatus = "FREE_LOCAL";
      if (!local) {
        costUsd = measured ? (inTok * cfg.price.input + outTok * cfg.price.output) / 1e6 : null;
        costStatus = measured ? "ESTIMATED" : "NOT_AVAILABLE";
      }
      seq += 1;
      // llama.cpp's server reports its own timings; keep the numbers (they are the measured throughput of THIS machine) and nothing else
      const tm = json && json.timings && typeof json.timings === "object" ? json.timings : null;
      const serverTimings = tm ? { promptTokens: tm.prompt_n ?? null, promptMs: tm.prompt_ms ?? null, promptPerSecond: tm.prompt_per_second ?? null, generatedTokens: tm.predicted_n ?? null, generatedMs: tm.predicted_ms ?? null, generatedPerSecond: tm.predicted_per_second ?? null } : null;
      return {
        text, usage: measured ? usageOf(inTok, outTok) : null, serverTimings,
        stopReason: choice.finish_reason || "unknown", truncated: choice.finish_reason === "length", model: cfg.model, provider: "openai-compatible",
        costClass: local ? "FREE_LOCAL" : "PAID_REMOTE", latencyMs: Date.now() - t0, attempts: 1,
        requestId: `oai_${crypto.randomBytes(4).toString("hex")}_${seq}`, costUsd, costStatus
      };
    }
  };
}

// ---------------------------------------------------------------------------------------------- Claude as optional fallback

/**
 * @param {{client:{callMessages:Function}, attestSpendGuarded:boolean, model:string, effort?:string, apiKey?:string}} cfg
 *   `client` must be the client returned by `aiBudget.guardClient(realClient, ctx)`. The attestation is explicit on purpose: building
 *   this adapter from a raw client is a programming error, and the missing flag makes it fail loudly instead of silently bypassing the gate.
 */
function createClaudeFallbackAdapter(cfg) {
  if (!cfg || !cfg.client || typeof cfg.client.callMessages !== "function") throw new NativeModelError("POLICY_BAD_CLIENT", "a client is required");
  if (cfg.attestSpendGuarded !== true) throw new NativeModelError("POLICY_UNGUARDED_CLIENT", "the Claude fallback must be built from a client that is already behind the spend gate (aiBudget.guardClient)");
  return {
    id: `claude-fallback:${cfg.model}`,
    provider: "claude",
    model: cfg.model,
    costClass: "PAID_REMOTE_GUARDED", // priced and limited by the production spend gate, not by this module
    async callMessages(opts) {
      const r = await cfg.client.callMessages({ apiKey: cfg.apiKey, model: cfg.model, system: opts.system, user: opts.user, maxTokens: opts.maxTokens, effort: cfg.effort, timeoutMs: opts.timeoutMs });
      return { ...r, provider: "claude", costClass: "PAID_REMOTE_GUARDED" };
    }
  };
}

// ------------------------------------------------------------------------------------------------------ native spend limit

/**
 * Local, per-run ceiling for adapters that cost money and are NOT behind the production gate (hosted open-weight endpoints).
 * Fail-closed: ceilingUsd defaults to 0, so nothing paid can run until a person sets a number. FREE_LOCAL adapters pass through (they are
 * still counted for time). PAID_REMOTE_GUARDED adapters pass through because the production gate already prices and limits them.
 */
function withSpendLimit(adapter, { ceilingUsd = 0, maxCalls = 1000 } = {}) {
  let spent = 0, calls = 0, unmeasured = 0;
  const limited = {
    ...adapter,
    async callMessages(opts) {
      if (adapter.costClass === "PAID_REMOTE") {
        if (!validPrice(adapter.price)) throw new NativeModelError("POLICY_UNPRICED", "model has no verified price; no call was made");
        if (!Number.isInteger(opts.maxTokens) || opts.maxTokens < 1) throw new NativeModelError("POLICY_COST_UNBOUNDED", "max_tokens is not a positive integer; no call was made");
        const worst = (inputTokensBound(opts.system, opts.user) * adapter.price.input + opts.maxTokens * adapter.price.output) / 1e6;
        if (!(ceilingUsd > 0)) throw new NativeModelError("POLICY_NO_BUDGET", "the spend ceiling is 0 USD; no call was made");
        if (calls >= maxCalls) throw new NativeModelError("POLICY_CALL_LIMIT", "the call limit of this run is reached; no call was made");
        if (spent + worst > ceilingUsd) throw new NativeModelError("POLICY_BUDGET_EXCEEDED", `spent so far plus the worst case of this call ($${worst.toFixed(4)}) exceeds the ceiling; no call was made`);
        calls += 1;
        let r;
        try { r = await adapter.callMessages(opts); } catch (e) { spent += worst; unmeasured += 1; throw e; } // an attempted call may have been billed: count the worst case
        if (typeof r.costUsd === "number" && Number.isFinite(r.costUsd)) spent += r.costUsd; else { spent += worst; unmeasured += 1; }
        return r;
      }
      calls += 1;
      return adapter.callMessages(opts);
    },
    spendReport: () => ({ spentUsd: Math.round(spent * 1e6) / 1e6, calls, unmeasuredCalls: unmeasured, ceilingUsd })
  };
  return limited;
}

// ---------------------------------------------------------------------------------------------------------------- router

/**
 * Ordered providers: the first is the default, the rest are fallbacks. A spend/policy refusal is final for that provider and is NOT
 * retried elsewhere by the router unless the next provider is free and local (a refusal must never push traffic to another paid path).
 * Returns the adapter-shaped router plus `lastServed()` provenance. Claude appears only if the caller listed it.
 */
function createRouter(providers) {
  if (!Array.isArray(providers) || providers.length === 0) throw new NativeModelError("POLICY_BAD_CLIENT", "at least one provider is required");
  const served = { provider: null, model: null, fallbackFrom: [] };
  return {
    id: `router:${providers.map((p) => p.id).join(">")}`,
    provider: "router",
    model: providers[0].model,
    costClass: providers.some((p) => p.costClass !== "FREE_LOCAL") ? "MIXED" : "FREE_LOCAL",
    async callMessages(opts) {
      const skipped = [];
      let lastErr = null;
      for (const p of providers) {
        if (skipped.length && lastErr && lastErr.policyDenied && p.costClass !== "FREE_LOCAL") { skipped.push({ id: p.id, reason: "NOT_TRIED_AFTER_POLICY_REFUSAL" }); continue; }
        try {
          const r = await p.callMessages(opts);
          served.provider = p.provider; served.model = r.model || p.model; served.fallbackFrom = skipped.map((s) => s.id);
          return { ...r, servedBy: p.id, fallbackFrom: skipped.map((s) => s.id) };
        } catch (err) {
          lastErr = err;
          skipped.push({ id: p.id, reason: (err && err.category) || "UNKNOWN" });
        }
      }
      const e = new NativeModelError((lastErr && lastErr.category) || "PROVIDER_UNAVAILABLE", "no provider could serve the request", { tried: skipped });
      throw e;
    },
    lastServed: () => ({ ...served })
  };
}

module.exports = { invoke, loopbackFetch, NativeModelError, createStubAdapter, createOpenAiCompatibleAdapter, createClaudeFallbackAdapter, withSpendLimit, createRouter, inputTokensBound, approxTokens, validPrice, STUB_MODEL_ID };
