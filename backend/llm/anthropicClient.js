"use strict";
/**
 * Anthropic Messages API client used by the production entrypoint (backend/start_local_server.js).
 *
 * Targets Claude Sonnet 5.5 (`claude-sonnet-5-5`). Request rules below were taken from the current docs
 * (https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide and .../build-with-claude/effort):
 *   - `temperature`, `top_p`, `top_k` set to a non-default value return HTTP 400  -> never sent.
 *   - Adaptive thinking is ON when no `thinking` field is sent. `thinking: {type: "disabled"}` and
 *     `{type: "enabled", budget_tokens}` return HTTP 400 -> `thinking` is never sent (adaptive default).
 *   - Effort is `output_config.effort` (low | medium | high | xhigh | max); default is `high`.
 *   - Thinking tokens count toward `max_tokens` and are billed as output tokens, even when thinking text is
 *     not returned (Sonnet 5.5 default display is "omitted": an empty `thinking` block comes BEFORE the text),
 *     so the answer must be read from the `text` block(s), never from `content[0]`.
 *   - `stop_reason` may be `refusal` or `model_context_window_exceeded` in addition to `end_turn`/`max_tokens`.
 *
 * Nothing here estimates or invents numbers: if the provider does not report usage, usage is `null`; if the
 * model has no verified price, cost is `null`.
 *
 * All network access goes through an injectable `transport`, so tests never need a real key or network.
 */

const https = require("https");

const API_HOST = "api.anthropic.com";
const API_PATH = "/v1/messages";
const API_VERSION = "2023-06-01";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MAX_OUTPUT_TOKENS_LIMIT = 128000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Models listed as Retired on https://platform.claude.com/docs/en/about-claude/model-deprecations
 * (checked 2026-10-01). Requests to these fail, so a configuration that points at one is overridden.
 */
const RETIRED_MODELS = new Set([
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
  "claude-3-haiku-20240307",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-opus-4-1-20250805"
]);

/**
 * USD per million tokens, only for models whose price has been verified (docs models overview, 2026-10-01).
 * A model that is not listed gets cost `null` (NOT_AVAILABLE) instead of a guessed price.
 * The invoice in the Anthropic Console is the source of truth; these are estimates from reported usage.
 */
const PRICING_PER_MTOK = {
  "claude-sonnet-5-5": { input: 2, output: 10 }
};

/**
 * Starting points per analysis depth. Docs recommend running an effort sweep on real workloads before relying
 * on a level; thinking tokens count toward maxTokens, so these leave room for thinking plus the reply.
 */
const ANALYSIS_PROFILES = {
  QUICK: { effort: "low", maxTokens: 6000, timeoutMs: 60000 },
  STANDARD: { effort: "high", maxTokens: 16000, timeoutMs: 180000 },
  DEEP: { effort: "xhigh", maxTokens: 32000, timeoutMs: 300000 }
};

const RETRYABLE_CATEGORIES = new Set(["RATE_LIMITED", "PROVIDER_5XX", "NETWORK_ERROR"]);

class ClientError extends Error {
  /**
   * @param {string} category  INVALID_CREDENTIAL | INSUFFICIENT_CREDITS | RATE_LIMITED | TIMEOUT | NETWORK_ERROR |
   *                           PROVIDER_5XX | INVALID_REQUEST | MODEL_UNAVAILABLE | MALFORMED_RESPONSE |
   *                           NO_TEXT_CONTENT | TRUNCATED_NO_TEXT | REFUSAL | UNKNOWN
   */
  constructor(category, message, details = {}) {
    super(`[ANTHROPIC_${category}] ${message}`);
    this.name = "ClientError";
    this.category = category;
    this.httpStatus = details.httpStatus;
    this.providerErrorType = details.providerErrorType;
    this.requestId = details.requestId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.retryable = RETRYABLE_CATEGORIES.has(category);
  }
}

/** API key from the environment; never logged or returned. LLM_API_KEY is only honoured for the anthropic provider. */
function resolveApiKey(env = process.env) {
  const candidates = [env.ANTHROPIC_API_KEY];
  const provider = (env.LLM_PROVIDER || "").trim().toLowerCase();
  if (provider === "" || provider === "anthropic") candidates.push(env.LLM_API_KEY);
  for (const c of candidates) {
    const key = typeof c === "string" ? c.trim() : "";
    if (key && !key.includes("REPLACE_WITH")) return key;
  }
  return null;
}

/** Resolve the model from ANTHROPIC_MODEL, then LLM_MODEL, then the default. Retired IDs are never used. */
function resolveModelConfig(env = process.env) {
  const fromAnthropic = (env.ANTHROPIC_MODEL || "").trim();
  const fromGeneric = (env.LLM_MODEL || "").trim();
  const configured = fromAnthropic || fromGeneric;
  const source = fromAnthropic ? "ANTHROPIC_MODEL" : fromGeneric ? "LLM_MODEL" : "DEFAULT";
  if (!configured) {
    return { model: DEFAULT_MODEL, source, configuredModel: null, configuredModelRetired: false };
  }
  if (RETIRED_MODELS.has(configured)) {
    return { model: DEFAULT_MODEL, source: "DEFAULT_RETIRED_MODEL_OVERRIDDEN", configuredModel: configured, configuredModelRetired: true };
  }
  return { model: configured, source, configuredModel: configured, configuredModelRetired: false };
}

function resolveProfile(depth) {
  const key = typeof depth === "string" ? depth.trim().toUpperCase() : "STANDARD";
  return { name: ANALYSIS_PROFILES[key] ? key : "STANDARD", ...(ANALYSIS_PROFILES[key] || ANALYSIS_PROFILES.STANDARD) };
}

/**
 * Build the Messages API request body. Exactly these keys are sent: no temperature/top_p/top_k, no `thinking`.
 */
function buildRequestBody({ model, system, user, maxTokens, effort }) {
  if (typeof model !== "string" || !model) throw new ClientError("INVALID_REQUEST", "model is required");
  if (!EFFORT_LEVELS.includes(effort)) throw new ClientError("INVALID_REQUEST", `unsupported effort level: ${effort}`);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS_LIMIT) {
    throw new ClientError("INVALID_REQUEST", `max_tokens must be an integer between 1 and ${MAX_OUTPUT_TOKENS_LIMIT}`);
  }
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: user }],
    output_config: { effort }
  };
  if (system) body.system = system;
  return body;
}

/**
 * Convert a successful (2xx) Messages API JSON payload into { text, usage, stopReason, ... } or throw ClientError.
 * Reads every `text` block; ignores `thinking` blocks (which can be empty and come first).
 */
function parseMessageResponse(json, requestedModel) {
  if (!json || typeof json !== "object" || !Array.isArray(json.content)) {
    throw new ClientError("MALFORMED_RESPONSE", "response has no content array");
  }
  const stopReason = typeof json.stop_reason === "string" ? json.stop_reason : null;
  const blockTypes = json.content.map((b) => (b && typeof b.type === "string" ? b.type : "unknown"));

  if (stopReason === "refusal") {
    throw new ClientError("REFUSAL", "model declined to answer (stop_reason=refusal)");
  }

  const text = json.content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  // Output that stopped because it hit the output budget OR the context window is incomplete, whichever the provider calls it.
  const cutOff = stopReason === "max_tokens" || stopReason === "model_context_window_exceeded";

  if (!text.trim()) {
    if (stopReason === "model_context_window_exceeded") {
      throw new ClientError("TRUNCATED_NO_TEXT", "the context window was exhausted before any text was produced; send less paper text");
    }
    if (stopReason === "max_tokens") {
      throw new ClientError(
        "TRUNCATED_NO_TEXT",
        "output budget was used up before any text was produced (thinking counts toward max_tokens); raise max_tokens or lower effort"
      );
    }
    throw new ClientError("NO_TEXT_CONTENT", `response contained no text block (blocks: ${blockTypes.join(",") || "none"}, stop_reason: ${stopReason})`);
  }

  const u = json.usage;
  const usage =
    u && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens)
      ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.input_tokens + u.output_tokens }
      : null;

  return {
    text,
    usage,
    stopReason,
    truncated: cutOff,
    model: typeof json.model === "string" && json.model ? json.model : requestedModel,
    blockTypes
  };
}

/** Map a non-2xx response to a ClientError with a sanitized, bounded message. */
function classifyHttpError(statusCode, bodyText, headers = {}) {
  let providerErrorType;
  let providerMessage = "";
  try {
    const parsed = JSON.parse(bodyText);
    providerErrorType = parsed && parsed.error && parsed.error.type;
    providerMessage = (parsed && parsed.error && parsed.error.message) || "";
  } catch (_) {
    providerMessage = typeof bodyText === "string" ? bodyText : "";
  }
  const summary = String(providerMessage).replace(/\s+/g, " ").slice(0, 200);
  const retryAfter = Number(headers["retry-after"]);
  const details = {
    httpStatus: statusCode,
    providerErrorType,
    requestId: headers["request-id"],
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined
  };

  let category = "UNKNOWN";
  if (statusCode === 401 || statusCode === 403) category = "INVALID_CREDENTIAL";
  else if (statusCode === 404) category = "MODEL_UNAVAILABLE";
  else if (statusCode === 429) category = "RATE_LIMITED";
  else if (statusCode === 400 && /credit balance/i.test(providerMessage)) category = "INSUFFICIENT_CREDITS";
  else if (statusCode === 400 || statusCode === 413 || statusCode === 422) category = "INVALID_REQUEST";
  else if (statusCode >= 500) category = "PROVIDER_5XX";

  return new ClientError(category, `HTTP ${statusCode}${summary ? `: ${summary}` : ""}`, details);
}

/** Cost estimate from reported usage and a verified price; `null` when either is unavailable. */
function computeCost(model, usage, env = process.env) {
  if (!usage) return { costUsd: null, costStatus: "NOT_AVAILABLE" };
  let price = PRICING_PER_MTOK[model];
  const overrideIn = Number(env.ANTHROPIC_PRICE_INPUT_PER_MTOK);
  const overrideOut = Number(env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK);
  if (env.ANTHROPIC_PRICE_INPUT_PER_MTOK !== undefined && env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK !== undefined &&
      Number.isFinite(overrideIn) && Number.isFinite(overrideOut) && overrideIn >= 0 && overrideOut >= 0) {
    price = { input: overrideIn, output: overrideOut };
  }
  if (!price) return { costUsd: null, costStatus: "NOT_AVAILABLE" };
  const costUsd = (usage.inputTokens / 1e6) * price.input + (usage.outputTokens / 1e6) * price.output;
  return { costUsd: Number(costUsd.toFixed(6)), costStatus: "ESTIMATED" };
}

/** Default transport: one HTTPS request with an overall deadline. Resolves with { statusCode, headers, body }. */
function httpsTransport({ headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };

    const req = https.request({ hostname: API_HOST, path: API_PATH, method: "POST", headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          done(reject, new ClientError("MALFORMED_RESPONSE", "response exceeded size limit"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => done(resolve, { statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => done(reject, new ClientError("NETWORK_ERROR", `response stream error: ${e.code || e.message}`)));
    });

    const timer = setTimeout(() => {
      req.destroy();
      done(reject, new ClientError("TIMEOUT", `request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on("error", (e) => done(reject, new ClientError("NETWORK_ERROR", `network failure: ${e.code || e.message}`)));
    req.write(body);
    req.end();
  });
}


/** Default GET transport for the free model-metadata probe. Resolves with { statusCode, headers, body }. */
function httpsGetTransport({ path, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const req = https.request({ hostname: API_HOST, path, method: "GET", headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > 262144) { req.destroy(); done(reject, new ClientError("MALFORMED_RESPONSE", "probe response too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => done(resolve, { statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => done(reject, new ClientError("NETWORK_ERROR", `response stream error: ${e.code || e.message}`)));
    });
    const timer = setTimeout(() => { req.destroy(); done(reject, new ClientError("TIMEOUT", `probe timed out after ${timeoutMs}ms`)); }, timeoutMs);
    req.on("error", (e) => done(reject, new ClientError("NETWORK_ERROR", `network failure: ${e.code || e.message}`)));
    req.end();
  });
}

/**
 * Reachability + credential + model probe that spends no tokens: GET /v1/models/{model} (metadata only).
 * Never throws. status: REACHABLE | UNREACHABLE (network, timeout, 5xx, 429) | REJECTED (401/403/404: key or model unusable) | NOT_CONFIGURED. `detail` is a category, never a key or response body.
 */
async function probeModel({ apiKey, model, timeoutMs = 3000, transport = httpsGetTransport }) {
  if (!apiKey) return { status: "NOT_CONFIGURED", detail: "NO_API_KEY" };
  try {
    const res = await transport({
      path: `/v1/models/${encodeURIComponent(model)}`,
      headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION },
      timeoutMs
    });
    if (res.statusCode >= 200 && res.statusCode < 300) return { status: "REACHABLE", detail: "OK", httpStatus: res.statusCode };
    const e = classifyHttpError(res.statusCode, res.body, res.headers || {});
    // 401/403/404: the provider answered, but this key or model cannot be used (REJECTED). Anything else (5xx, 429...) is UNREACHABLE.
    const rejected = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 404;
    return { status: rejected ? "REJECTED" : "UNREACHABLE", detail: e.category || "UNKNOWN", httpStatus: res.statusCode };
  } catch (err) {
    return { status: "UNREACHABLE", detail: (err && err.category) || "NETWORK_ERROR" };
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Messages API once (plus bounded retries for 429 / 5xx / network errors).
 * Timeouts are not retried: a retry would double both latency and potential spend.
 *
 * @returns {Promise<{text, usage, stopReason, truncated, model, latencyMs, attempts, requestId, costUsd, costStatus}>}
 */
async function callMessages(options) {
  const {
    apiKey,
    model,
    system,
    user,
    maxTokens,
    effort,
    timeoutMs = 180000,
    maxRetries = 2,
    transport = httpsTransport,
    sleep = defaultSleep,
    now = Date.now,
    random = Math.random,
    env = process.env
  } = options;

  if (!apiKey) throw new ClientError("INVALID_CREDENTIAL", "Anthropic API key is not configured");

  const payload = JSON.stringify(buildRequestBody({ model, system, user, maxTokens, effort }));
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  };

  const started = now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const res = await transport({ headers, body: payload, timeoutMs });
      if (res.statusCode < 200 || res.statusCode >= 300) throw classifyHttpError(res.statusCode, res.body, res.headers || {});

      let json;
      try {
        json = JSON.parse(res.body);
      } catch (e) {
        throw new ClientError("MALFORMED_RESPONSE", "response body was not valid JSON", { httpStatus: res.statusCode, requestId: (res.headers || {})["request-id"] });
      }
      const parsed = parseMessageResponse(json, model);
      const cost = computeCost(parsed.model, parsed.usage, env);
      return {
        ...parsed,
        latencyMs: now() - started,
        attempts: attempt,
        requestId: (res.headers || {})["request-id"],
        costUsd: cost.costUsd,
        costStatus: cost.costStatus
      };
    } catch (err) {
      const e = err instanceof ClientError ? err : new ClientError("NETWORK_ERROR", `unexpected failure: ${err && err.message ? err.message : err}`);
      e.attempts = attempt;
      if (!e.retryable || attempt > maxRetries) throw e;
      const base = e.retryAfterSeconds !== undefined ? Math.min(e.retryAfterSeconds, 10) * 1000 : Math.min(500 * 2 ** (attempt - 1), 4000);
      await sleep(base + Math.floor(random() * 250));
    }
  }
}

module.exports = {
  API_VERSION,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
  RETIRED_MODELS,
  PRICING_PER_MTOK,
  ANALYSIS_PROFILES,
  ClientError,
  resolveApiKey,
  resolveModelConfig,
  resolveProfile,
  buildRequestBody,
  parseMessageResponse,
  classifyHttpError,
  computeCost,
  httpsTransport,
  httpsGetTransport,
  probeModel,
  callMessages
};
