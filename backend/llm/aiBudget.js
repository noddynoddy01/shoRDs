"use strict";
/**
 * AI spend safety: everything that decides, BEFORE a paid provider call, whether the call may happen.
 *
 *   kill switch -> price known? -> per-request ceiling -> provider circuit breaker -> duplicate in-flight lock
 *   -> reserve budget (global, tenant, project, user: daily spend, concurrency, optional call counts)
 *   -> provider call -> settle (charge actual) or release
 *
 * Authority and coordination
 *   - PostgreSQL `ai_usage` is the authoritative record of what was actually spent (written by usageLedger after each request).
 *   - Redis only coordinates: atomic reservations across replicas, concurrency, locks, the circuit breaker, the kill-switch key.
 *     When a day's counter is missing (new day, Redis flushed, new replica) it is SEEDED from `ai_usage` before the first
 *     reservation, so losing Redis never resets the day's spending to zero.
 *   - Fail closed: if the budget store cannot be read the paid call is refused (BUDGET_UNAVAILABLE). Cache hits never reach this
 *     module, so cached answers keep working. Refused calls surface through the existing labelled local fallback.
 *
 * What "maximum cost" means here (an upper bound from stated assumptions, NOT a measurement):
 *   input tokens  <= UTF-8 bytes of system+user prompt (+ framing). A byte-level tokenizer cannot emit more tokens than bytes.
 *   output tokens <= max_tokens of the request (thinking tokens count toward max_tokens and are billed as output).
 *   per attempt   =  input bound x input price + max_tokens x output price.
 *   reservation   =  per attempt x (1 + maxRetries): a retried attempt resends the whole prompt.
 * A model with no verified price (see anthropicClient.resolvePrice) cannot be bounded and is refused: UNPRICED_MODEL.
 *
 * All amounts are integer micro-USD (1 micro-USD = $0.000001); a price in USD per million tokens is therefore numerically the
 * price per token in micro-USD.
 */

const crypto = require("crypto");
const { resolvePrice } = require("./anthropicClient");
const { hashUser } = require("./usageLedger");

const KEY_VERSION = "v1";
const DAY_TTL_SEC = 2 * 86400;
const FRAMING_TOKENS = 256; // message envelope / role markers, generous
const RESERVATION_MARGIN_MS = 45000;

const DENY = {
  AI_DISABLED: "AI_DISABLED",
  UNPRICED_MODEL: "UNPRICED_MODEL",
  COST_UNBOUNDED: "COST_UNBOUNDED",
  REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
  REQUEST_TOO_EXPENSIVE: "REQUEST_TOO_EXPENSIVE",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  CONCURRENCY_LIMIT: "CONCURRENCY_LIMIT",
  CALL_LIMIT: "CALL_LIMIT",
  DUPLICATE_IN_FLIGHT: "DUPLICATE_IN_FLIGHT",
  PROVIDER_COOLDOWN: "PROVIDER_COOLDOWN",
  BUDGET_UNAVAILABLE: "BUDGET_UNAVAILABLE"
};

/** Thrown instead of calling the provider. `category` flows into the existing fallback path as `AI_POLICY_<category>`. */
class AiPolicyDenied extends Error {
  constructor(category, message, details = {}) {
    super(`[AI_POLICY_${category}] ${message}`);
    this.name = "AiPolicyDenied";
    this.category = category;
    this.policyDenied = true;
    this.retryable = false;
    this.details = details;
  }
}

// ------------------------------------------------------------------------------------------------ configuration

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** AI_ENABLED: unset/empty = enabled; a recognised false value disables; anything unrecognised ALSO disables (fail closed). */
function parseEnabled(raw) {
  if (raw === undefined || String(raw).trim() === "") return { enabled: true, invalid: false };
  const v = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return { enabled: true, invalid: false };
  if (FALSE_VALUES.has(v)) return { enabled: false, invalid: false };
  return { enabled: false, invalid: true };
}

function parseUsd(env, name, defaultMicro) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return defaultMicro;
  if (String(raw).trim().toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of USD or "unlimited" (got "${String(raw).slice(0, 40)}")`);
  return Math.round(n * 1e6);
}

function parseCount(env, name, dflt) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return dflt;
  if (String(raw).trim().toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer or "unlimited" (got "${String(raw).slice(0, 40)}")`);
  return n;
}

/**
 * Defaults are conservative starting points chosen by the engineers, not business decisions: the owner should set real values.
 * A malformed value throws (the process fails at startup instead of running with a limit nobody intended).
 */
function loadBudgetConfig(env = process.env) {
  const { enabled, invalid } = parseEnabled(env.AI_ENABLED);
  const mode = (env.AI_BUDGET_MODE || "enforce").trim().toLowerCase();
  if (mode !== "enforce" && mode !== "observe") throw new Error(`AI_BUDGET_MODE must be "enforce" or "observe" (got "${mode.slice(0, 20)}")`);
  const maxRetries = env.AI_MAX_PROVIDER_RETRIES === undefined || env.AI_MAX_PROVIDER_RETRIES === "" ? 1 : Number(env.AI_MAX_PROVIDER_RETRIES);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new Error("AI_MAX_PROVIDER_RETRIES must be an integer from 0 to 3");
  const num = (name, dflt, min = 1) => {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === "") return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
    return n;
  };
  return {
    enabled,
    enabledInvalid: invalid,
    mode,
    maxRetries,
    requestMaxMicro: parseUsd(env, "AI_BUDGET_REQUEST_MAX_USD", 1_250_000),
    maxOutputTokens: num("AI_REQUEST_MAX_OUTPUT_TOKENS", 32000),
    maxInputTokensBound: num("AI_REQUEST_MAX_INPUT_TOKENS_BOUND", 600000),
    scopes: {
      global: { dailyMicro: parseUsd(env, "AI_BUDGET_GLOBAL_DAILY_USD", 25_000_000), maxConcurrent: parseCount(env, "AI_BUDGET_GLOBAL_MAX_CONCURRENT", 16), maxCalls: parseCount(env, "AI_BUDGET_GLOBAL_DAILY_CALLS", null) },
      tenant: { dailyMicro: parseUsd(env, "AI_BUDGET_TENANT_DAILY_USD", 5_000_000), maxConcurrent: parseCount(env, "AI_BUDGET_TENANT_MAX_CONCURRENT", 6), maxCalls: parseCount(env, "AI_BUDGET_TENANT_DAILY_CALLS", null) },
      project: { dailyMicro: parseUsd(env, "AI_BUDGET_PROJECT_DAILY_USD", 2_000_000), maxConcurrent: parseCount(env, "AI_BUDGET_PROJECT_MAX_CONCURRENT", null), maxCalls: parseCount(env, "AI_BUDGET_PROJECT_DAILY_CALLS", null) },
      user: { dailyMicro: parseUsd(env, "AI_BUDGET_USER_DAILY_USD", 2_000_000), maxConcurrent: parseCount(env, "AI_BUDGET_USER_MAX_CONCURRENT", 2), maxCalls: parseCount(env, "AI_BUDGET_USER_DAILY_CALLS", null) }
    },
    breaker: {
      failures: num("AI_BREAKER_FAILURES", 5),
      cooldownMs: num("AI_BREAKER_COOLDOWN_SEC", 30) * 1000,
      credentialCooldownMs: num("AI_BREAKER_CREDENTIAL_COOLDOWN_SEC", 300) * 1000
    }
  };
}

// ------------------------------------------------------------------------------------------------ cost bound

/**
 * Upper bound of one attempt and of the whole request (all permitted attempts), in micro-USD, or a refusal reason.
 * Never returns 0 for an unknown price: an unpriced model is refused.
 */
function estimateMaxCost({ model, system, user, maxTokens, attempts = 1, env = process.env }) {
  const price = resolvePrice(model, env);
  if (!price) return { ok: false, category: DENY.UNPRICED_MODEL, message: `model "${String(model).slice(0, 60)}" has no verified price, so its cost cannot be bounded` };
  if (!Number.isInteger(maxTokens) || maxTokens < 1) return { ok: false, category: DENY.COST_UNBOUNDED, message: "max_tokens is not a positive integer, so output cost cannot be bounded" };
  if (typeof user !== "string") return { ok: false, category: DENY.COST_UNBOUNDED, message: "prompt is not a string, so input cost cannot be bounded" };
  const inputTokensBound = Buffer.byteLength(system || "", "utf8") + Buffer.byteLength(user, "utf8") + FRAMING_TOKENS;
  const perAttemptMicro = Math.ceil(inputTokensBound * price.input + maxTokens * price.output);
  return { ok: true, inputTokensBound, outputTokensBound: maxTokens, perAttemptMicro, reservationMicro: perAttemptMicro * attempts, attempts, price };
}

const dayKey = (nowMs) => new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
const dayStartMs = (nowMs) => Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`);

/** The scopes a request is charged to. Order matters only for reporting (the first refusing scope is named). */
function scopesFor(cfg, ctx, nowMs) {
  const day = dayKey(nowMs);
  const out = [];
  const add = (kind, id) => {
    const c = cfg.scopes[kind];
    out.push({ kind, id, key: `shords:aib:${KEY_VERSION}:${kind}:${id}:${day}`, zkey: `shords:aib:${KEY_VERSION}:${kind}:${id}:${day}:res`, limitMicro: c.dailyMicro, maxConcurrent: c.maxConcurrent, maxCalls: c.maxCalls });
  };
  add("global", "all");
  if (ctx.tenantId) add("tenant", String(ctx.tenantId));
  if (ctx.projectId) add("project", String(ctx.projectId));
  if (ctx.uid) add("user", hashUser(ctx.uid));
  return out;
}

// ------------------------------------------------------------------------------------------------ stores

const RESERVE_LUA = `
local now = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
local rid = ARGV[3]
local exp = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local n = #KEYS / 2
for i = 1, n do
  local h = KEYS[2 * i - 1]
  local z = KEYS[2 * i]
  redis.call('ZREMRANGEBYSCORE', z, '-inf', now)
  if redis.call('HEXISTS', h, 'spent') == 0 then return {-1, i - 1, 0} end
  local spent = tonumber(redis.call('HGET', h, 'spent'))
  local calls = tonumber(redis.call('HGET', h, 'calls') or '0')
  local reserved = 0
  local members = redis.call('ZRANGE', z, 0, -1)
  for _, m in ipairs(members) do
    local a = string.match(m, '|(%d+)$')
    if a then reserved = reserved + tonumber(a) end
  end
  local base = 5 + 3 * (i - 1)
  local limit = tonumber(ARGV[base + 1])
  local maxConc = tonumber(ARGV[base + 2])
  local maxCalls = tonumber(ARGV[base + 3])
  if limit >= 0 and spent + reserved + amount > limit then return {0, i - 1, 1} end
  if maxConc >= 0 and #members >= maxConc then return {0, i - 1, 2} end
  if maxCalls >= 0 and calls + #members >= maxCalls then return {0, i - 1, 3} end
end
for i = 1, n do
  local h = KEYS[2 * i - 1]
  local z = KEYS[2 * i]
  redis.call('ZADD', z, exp, rid .. '|' .. amount)
  redis.call('EXPIRE', z, ttl)
  redis.call('EXPIRE', h, ttl)
end
return {1, -1, 0}
`;

const SETTLE_LUA = `
local rid = ARGV[1]
local charge = tonumber(ARGV[2])
local prefix = rid .. '|'
local removed = 0
local n = #KEYS / 2
for i = 1, n do
  local h = KEYS[2 * i - 1]
  local z = KEYS[2 * i]
  local members = redis.call('ZRANGE', z, 0, -1)
  for _, m in ipairs(members) do
    if string.sub(m, 1, string.len(prefix)) == prefix then
      redis.call('ZREM', z, m)
      removed = removed + 1
    end
  end
  if charge > 0 and redis.call('HEXISTS', h, 'spent') == 1 then
    redis.call('HINCRBY', h, 'spent', charge)
    redis.call('HINCRBY', h, 'calls', 1)
  end
end
return removed
`;

const UNLOCK_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const REASONS = { 1: "LIMIT", 2: "CONCURRENCY", 3: "CALLS" };

/** Redis-backed store (production). Every method may throw; the gate turns that into BUDGET_UNAVAILABLE (fail closed). */
function createRedisBudgetStore(redis) {
  return {
    kind: "redis",
    async reserve({ scopes, amountMicro, reservationId, expiresAtMs, nowMs }) {
      const keys = scopes.flatMap((s) => [s.key, s.zkey]);
      const argv = [nowMs, amountMicro, reservationId, expiresAtMs, DAY_TTL_SEC, ...scopes.flatMap((s) => [s.limitMicro === null ? -1 : s.limitMicro, s.maxConcurrent === null ? -1 : s.maxConcurrent, s.maxCalls === null ? -1 : s.maxCalls])];
      const r = await redis.eval(RESERVE_LUA, keys, argv);
      if (!Array.isArray(r)) throw new Error("unexpected reserve reply");
      if (r[0] === 1) return { ok: true };
      if (r[0] === -1) return { ok: false, needsSeed: true, scopeIndex: r[1] };
      return { ok: false, scopeIndex: r[1], reason: REASONS[r[2]] || "LIMIT" };
    },
    async settle({ scopes, reservationId, chargeMicro }) {
      await redis.eval(SETTLE_LUA, scopes.flatMap((s) => [s.key, s.zkey]), [reservationId, Math.max(0, Math.ceil(chargeMicro))]);
    },
    async seed({ scope, spentMicro, calls }) {
      await redis.command("HSETNX", scope.key, "spent", Math.max(0, Math.ceil(spentMicro)));
      await redis.command("HSETNX", scope.key, "calls", Math.max(0, calls));
      await redis.command("EXPIRE", scope.key, DAY_TTL_SEC);
    },
    async peek({ scope, nowMs }) {
      await redis.command("ZREMRANGEBYSCORE", scope.zkey, "-inf", nowMs);
      const f = await redis.command("HMGET", scope.key, "spent", "calls");
      const members = (await redis.command("ZRANGE", scope.zkey, 0, -1)) || [];
      const reservedMicro = members.reduce((n, m) => n + Number((String(m).match(/\|(\d+)$/) || [0, 0])[1]), 0);
      return { seeded: f[0] !== null, spentMicro: f[0] === null ? null : Number(f[0]), calls: f[1] === null ? 0 : Number(f[1]), reservedMicro, concurrent: members.length };
    },
    async get(key) { return redis.command("GET", key); },
    async set(key, value, ttlMs) { await (ttlMs ? redis.command("SET", key, value, "PX", ttlMs) : redis.command("SET", key, value)); },
    async del(key) { await redis.command("DEL", key); },
    async lock(key, token, ttlMs) { return (await redis.command("SET", key, token, "NX", "PX", ttlMs)) === "OK"; },
    async unlock(key, token) { await redis.eval(UNLOCK_LUA, [key], [token]); }
  };
}

/**
 * In-process store with the SAME semantics as the Redis one (single process only). Used by the deterministic unit tests and,
 * through the shared conformance tests, proven equivalent to the Redis implementation. Never use it with more than one replica.
 */
function createMemoryBudgetStore({ now: clock = Date.now } = {}) {
  const hashes = new Map(); // key -> { spent, calls }
  const zsets = new Map(); // zkey -> Map(member -> expiresAtMs)
  const kv = new Map(); // key -> { value, expiresAt|null }
  const purge = (z, nowMs) => {
    const m = zsets.get(z);
    if (!m) return new Map();
    for (const [k, exp] of m) if (exp <= nowMs) m.delete(k);
    return m;
  };
  const amountOf = (member) => Number((member.match(/\|(\d+)$/) || [0, 0])[1]);
  return {
    kind: "memory",
    async reserve({ scopes, amountMicro, reservationId, expiresAtMs, nowMs }) {
      for (let i = 0; i < scopes.length; i += 1) {
        const s = scopes[i];
        const z = purge(s.zkey, nowMs);
        const h = hashes.get(s.key);
        if (!h) return { ok: false, needsSeed: true, scopeIndex: i };
        let reserved = 0;
        for (const m of z.keys()) reserved += amountOf(m);
        if (s.limitMicro !== null && h.spent + reserved + amountMicro > s.limitMicro) return { ok: false, scopeIndex: i, reason: "LIMIT" };
        if (s.maxConcurrent !== null && z.size >= s.maxConcurrent) return { ok: false, scopeIndex: i, reason: "CONCURRENCY" };
        if (s.maxCalls !== null && h.calls + z.size >= s.maxCalls) return { ok: false, scopeIndex: i, reason: "CALLS" };
      }
      for (const s of scopes) {
        if (!zsets.has(s.zkey)) zsets.set(s.zkey, new Map());
        zsets.get(s.zkey).set(`${reservationId}|${amountMicro}`, expiresAtMs);
      }
      return { ok: true };
    },
    async settle({ scopes, reservationId, chargeMicro }) {
      const charge = Math.max(0, Math.ceil(chargeMicro));
      for (const s of scopes) {
        const z = zsets.get(s.zkey);
        if (z) for (const m of [...z.keys()]) if (m.startsWith(`${reservationId}|`)) z.delete(m);
        const h = hashes.get(s.key);
        if (charge > 0 && h) { h.spent += charge; h.calls += 1; }
      }
    },
    async seed({ scope, spentMicro, calls }) {
      if (!hashes.has(scope.key)) hashes.set(scope.key, { spent: Math.max(0, Math.ceil(spentMicro)), calls: Math.max(0, calls) });
    },
    async peek({ scope, nowMs }) {
      const z = purge(scope.zkey, nowMs);
      const h = hashes.get(scope.key);
      let reservedMicro = 0;
      for (const m of z.keys()) reservedMicro += amountOf(m);
      return { seeded: Boolean(h), spentMicro: h ? h.spent : null, calls: h ? h.calls : 0, reservedMicro, concurrent: z.size };
    },
    async get(key) {
      const e = kv.get(key);
      if (!e) return null;
      if (e.expiresAt !== null && e.expiresAt <= clock()) { kv.delete(key); return null; }
      return e.value;
    },
    async set(key, value, ttlMs) { kv.set(key, { value, expiresAt: ttlMs ? clock() + ttlMs : null }); },
    async del(key) { kv.delete(key); },
    async lock(key, token, ttlMs) {
      const e = kv.get(key);
      if (e && (e.expiresAt === null || e.expiresAt > clock())) return false;
      kv.set(key, { value: token, expiresAt: clock() + ttlMs });
      return true;
    },
    async unlock(key, token) { const e = kv.get(key); if (e && e.value === token) kv.delete(key); }
  };
}

/** Seeds a day counter from the authoritative Postgres ledger: provider-reported spend and paid calls since UTC midnight. */
function createLedgerSeeder(pool) {
  const columns = { tenant: "tenant_id", project: "project_id", user: "user_hash" };
  return async function seedFromLedger(scope, nowMs) {
    const col = columns[scope.kind];
    const params = [new Date(dayStartMs(nowMs)).toISOString()];
    let where = "";
    if (col) { where = ` AND ${col} = $2`; params.push(scope.id); }
    const r = await pool.query(
      `SELECT COALESCE(sum(cost_usd), 0) AS cost, count(*) FILTER (WHERE ai_called) AS calls FROM ai_usage WHERE created_at >= $1::timestamptz${where}`,
      params
    );
    const row = r.rows[0] || {};
    return { spentMicro: Math.ceil(Number(row.cost || 0) * 1e6), calls: Number(row.calls || 0) };
  };
}

// ------------------------------------------------------------------------------------------------ the gate

/** Provider answers that prove the request was rejected before any generation: nothing was billed. */
const NOT_BILLED = new Set(["INVALID_CREDENTIAL", "INSUFFICIENT_CREDITS", "INVALID_REQUEST", "MODEL_UNAVAILABLE", "RATE_LIMITED", "PROVIDER_5XX"]);
const BREAKER_FAILURES = new Set(["RATE_LIMITED", "PROVIDER_5XX", "NETWORK_ERROR", "TIMEOUT"]);
const BREAKER_CREDENTIAL = new Set(["INVALID_CREDENTIAL", "INSUFFICIENT_CREDITS"]);

const KILL_KEY = `shords:ai:kill:${KEY_VERSION}`;
const BREAKER_KEY = `shords:ai:breaker:${KEY_VERSION}:anthropic`;
const PROBE_KEY = `shords:ai:breaker:${KEY_VERSION}:anthropic:probe`;

function createAiBudget({ store, seedFromLedger = null, env = process.env, logger = console, now = Date.now, config = null }) {
  const cfg = config || loadBudgetConfig(env);
  const counters = { allowed: 0, denied: {}, wouldDeny: {}, settledMicro: 0, assumedChargeMicro: 0, released: 0, settleErrors: 0 };
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
  if (cfg.enabledInvalid) logger.error("[AIBudget] AI_ENABLED has an unrecognised value; paid AI calls are DISABLED (fail closed). Use true or false.");

  const deny = (category, message, details) => {
    bump(counters.denied, category);
    return new AiPolicyDenied(category, message, details);
  };

  // ---- kill switch
  /** engaged when AI_ENABLED is false (cannot be reopened from Redis), when the Redis key says so, or when the key cannot be read. */
  async function killState() {
    if (!cfg.enabled) return { engaged: true, source: "ENV", reason: cfg.enabledInvalid ? "AI_ENABLED unrecognised" : "AI_ENABLED=false" };
    try {
      const raw = await store.get(KILL_KEY);
      if (!raw) return { engaged: false, source: "NONE" };
      let parsed = {};
      try { parsed = JSON.parse(raw); } catch (_) { /* a malformed value still engages */ }
      return { engaged: true, source: "STORE", reason: String(parsed.reason || "engaged").slice(0, 200), at: parsed.at || null, by: parsed.by || null };
    } catch (_) {
      return { engaged: true, source: "UNREADABLE", reason: "kill-switch state could not be read" };
    }
  }

  async function setKillSwitch({ engaged, reason = "", by = null }) {
    if (engaged) await store.set(KILL_KEY, JSON.stringify({ reason: String(reason).slice(0, 200), at: new Date(now()).toISOString(), by }));
    else await store.del(KILL_KEY);
    logger.warn(`[AIBudget] kill switch ${engaged ? "ENGAGED" : "released"} by=${by || "unknown"} reason=${String(reason).slice(0, 80)}`);
    return killState();
  }

  // ---- circuit breaker
  async function readBreaker() {
    const raw = await store.get(BREAKER_KEY);
    if (!raw) return { failures: 0, openUntil: 0, reason: null };
    try { return JSON.parse(raw); } catch (_) { return { failures: 0, openUntil: 0, reason: null }; }
  }
  const writeBreaker = (b) => store.set(BREAKER_KEY, JSON.stringify(b), 3600000);

  /** @returns {Promise<string|null>} probe token when this call is the half-open probe, else null; throws AiPolicyDenied while open */
  async function breakerEnter() {
    const b = await readBreaker();
    const t = now();
    if (b.openUntil && t < b.openUntil) throw deny(DENY.PROVIDER_COOLDOWN, `the AI provider is in cooldown after repeated failures (${b.reason || "failures"}); no call was made`, { retryAfterSec: Math.ceil((b.openUntil - t) / 1000) });
    if (b.failures >= cfg.breaker.failures) {
      const token = crypto.randomBytes(8).toString("hex");
      if (!(await store.lock(PROBE_KEY, token, 30000))) throw deny(DENY.PROVIDER_COOLDOWN, "the AI provider is recovering; another request is probing it", { retryAfterSec: 30 });
      return token;
    }
    return null;
  }
  async function breakerRecord(err, probeToken) {
    try {
      const category = (err && err.category) || "UNKNOWN";
      if (!err) { await writeBreaker({ failures: 0, openUntil: 0, reason: null }); return; }
      if (BREAKER_CREDENTIAL.has(category)) { await writeBreaker({ failures: cfg.breaker.failures, openUntil: now() + cfg.breaker.credentialCooldownMs, reason: category }); return; }
      if (!BREAKER_FAILURES.has(category)) return;
      const b = await readBreaker();
      const failures = (b.failures || 0) + 1;
      const retryMs = Number.isFinite(err.retryAfterSeconds) ? Math.min(err.retryAfterSeconds, 300) * 1000 : 0;
      await writeBreaker({ failures, openUntil: failures >= cfg.breaker.failures ? now() + Math.max(cfg.breaker.cooldownMs, retryMs) : 0, reason: category });
    } catch (e) {
      logger.error(`[AIBudget] could not update the provider circuit breaker (${(e && e.code) || (e && e.name) || "error"})`);
    } finally {
      if (probeToken) { try { await store.unlock(PROBE_KEY, probeToken); } catch (_) { /* expires on its own */ } }
    }
  }

  // ---- reservation with seeding
  async function reserveAll(scopes, amountMicro, reservationId, expiresAtMs, nowMs) {
    for (let guard = 0; guard <= scopes.length; guard += 1) {
      const r = await store.reserve({ scopes, amountMicro, reservationId, expiresAtMs, nowMs });
      if (r.ok || !r.needsSeed) return r;
      const scope = scopes[r.scopeIndex];
      if (!seedFromLedger) throw new Error("budget counter missing and no ledger seeder configured");
      const seed = await seedFromLedger(scope, nowMs); // Postgres is authoritative: a flushed Redis never resets the day to zero
      await store.seed({ scope, spentMicro: seed.spentMicro, calls: seed.calls });
    }
    throw new Error("budget counters could not be seeded");
  }

  const unlimitedScopes = (scopes) => scopes.map((s) => ({ ...s, limitMicro: null, maxConcurrent: null, maxCalls: null }));

  /** Settle cost for a failed call: nothing when the provider certainly rejected it, otherwise the one-attempt ceiling. */
  function failureCharge(err, est) {
    const category = err && err.category;
    if (err && err.policyDenied) return 0;
    if (NOT_BILLED.has(category)) return 0;
    return est.perAttemptMicro; // ambiguous (timeout, dropped connection, empty/refused/truncated reply, unknown): assume billed
  }

  /**
   * Run one provider call through the gate.
   * @param {{callMessages:Function}} client the real (or injected) provider client
   * @param {{tenantId?:string, projectId?:string, uid?:string, kind?:string}} ctx
   * @param {object} options the callMessages options
   */
  async function guardedCall(client, ctx, options) {
    const t0 = now();
    const attempts = 1 + cfg.maxRetries;

    const ks = await killState();
    if (ks.engaged) throw deny(DENY.AI_DISABLED, `paid AI calls are switched off (${ks.source}); no call was made`, { source: ks.source });

    const est = estimateMaxCost({ model: options.model, system: options.system, user: options.user, maxTokens: options.maxTokens, attempts, env: options.env || env });
    if (!est.ok) throw deny(est.category, `${est.message}; no call was made`);
    if (options.maxTokens > cfg.maxOutputTokens) throw deny(DENY.REQUEST_TOO_LARGE, `max_tokens ${options.maxTokens} exceeds the per-request output limit ${cfg.maxOutputTokens}; no call was made`);
    if (est.inputTokensBound > cfg.maxInputTokensBound) throw deny(DENY.REQUEST_TOO_LARGE, `the prompt could contain up to ${est.inputTokensBound} tokens, above the per-request input limit ${cfg.maxInputTokensBound}; no call was made`);
    if (cfg.requestMaxMicro !== null && est.reservationMicro > cfg.requestMaxMicro) {
      throw deny(DENY.REQUEST_TOO_EXPENSIVE, `the worst-case cost of this request ($${(est.reservationMicro / 1e6).toFixed(4)}) exceeds the per-request limit ($${(cfg.requestMaxMicro / 1e6).toFixed(4)}); no call was made`);
    }

    let probe = null;
    let lockKey = null;
    let lockToken = null;
    let reservationId = null;
    let scopes = [];
    let reserved = false;
    try {
      try {
        probe = await breakerEnter();

        const fp = crypto.createHash("sha256").update(JSON.stringify([ctx.tenantId || "", options.model, options.system || "", options.user, options.maxTokens, options.effort || ""])).digest("hex");
        lockKey = `shords:ai:inflight:${KEY_VERSION}:${fp}`;
        lockToken = crypto.randomBytes(8).toString("hex");
        const lockTtl = Math.min(900000, (Number(options.timeoutMs) || 180000) * attempts + 15000);
        if (!(await store.lock(lockKey, lockToken, lockTtl))) { lockKey = null; throw deny(DENY.DUPLICATE_IN_FLIGHT, "an identical request is already running; no second call was made"); }

        scopes = scopesFor(cfg, ctx, t0);
        reservationId = `${t0.toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
        const expiresAtMs = t0 + (Number(options.timeoutMs) || 180000) * attempts + RESERVATION_MARGIN_MS;
        let r = await reserveAll(scopes, est.reservationMicro, reservationId, expiresAtMs, t0);
        if (!r.ok) {
          const scope = scopes[r.scopeIndex];
          const category = r.reason === "CONCURRENCY" ? DENY.CONCURRENCY_LIMIT : r.reason === "CALLS" ? DENY.CALL_LIMIT : DENY.BUDGET_EXCEEDED;
          if (cfg.mode === "observe") {
            bump(counters.wouldDeny, `${category}:${scope.kind}`);
            logger.warn(`[AIBudget] OBSERVE would refuse: ${category} scope=${scope.kind} reservation=$${(est.reservationMicro / 1e6).toFixed(4)}`);
            r = await reserveAll(unlimitedScopes(scopes), est.reservationMicro, reservationId, expiresAtMs, t0);
          }
          if (!r.ok) throw deny(category, `the ${scope.kind} ${r.reason === "CONCURRENCY" ? "concurrency" : r.reason === "CALLS" ? "daily call" : "daily spend"} limit would be exceeded; no call was made`, { scope: scope.kind });
        }
        reserved = true;
      } catch (e) {
        if (e instanceof AiPolicyDenied) throw e;
        logger.error(`[AIBudget] budget store unavailable (${(e && e.code) || (e && e.name) || "error"}); refusing the paid call (fail closed)`);
        throw deny(DENY.BUDGET_UNAVAILABLE, "the spend-control store is unavailable; no call was made");
      }

      let result;
      try {
        result = await client.callMessages({ ...options, maxRetries: cfg.maxRetries });
      } catch (err) {
        const charge = failureCharge(err, est);
        if (charge > 0) counters.assumedChargeMicro += charge; else counters.released += 1;
        await settle(scopes, reservationId, charge);
        reserved = false;
        await breakerRecord(err, probe);
        probe = null;
        throw err;
      }
      const costMicro = typeof result.costUsd === "number" && Number.isFinite(result.costUsd) ? Math.ceil(result.costUsd * 1e6) : null;
      const charge = costMicro === null ? est.perAttemptMicro : costMicro; // cost not measurable: charge the ceiling rather than zero
      if (costMicro === null) counters.assumedChargeMicro += charge; else counters.settledMicro += charge;
      await settle(scopes, reservationId, charge);
      reserved = false;
      await breakerRecord(null, probe);
      probe = null;
      counters.allowed += 1;
      return result;
    } finally {
      if (reserved) await settle(scopes, reservationId, 0); // defensive: an unexpected throw must never leave the reservation held
      if (probe) { try { await store.unlock(PROBE_KEY, probe); } catch (_) { /* expires */ } }
      if (lockKey) { try { await store.unlock(lockKey, lockToken); } catch (_) { /* expires on its own */ } }
    }
  }

  async function settle(scopes, reservationId, chargeMicro) {
    try {
      await store.settle({ scopes, reservationId, chargeMicro });
    } catch (e) {
      counters.settleErrors += 1;
      // The reservation expires by itself; the Postgres ledger already carries (or will carry) the real spend.
      logger.error(`[AIBudget] could not settle a reservation (${(e && e.code) || (e && e.name) || "error"}); it will expire on its own`);
    }
  }

  /** A client with the same `callMessages` shape, bound to one request's audience. Everything above runs on every call. */
  function guardClient(client, ctx) {
    return { callMessages: (options) => guardedCall(client, ctx, options) };
  }

  async function status() {
    const t = now();
    const out = {
      enabled: cfg.enabled,
      mode: cfg.mode,
      killSwitch: await killState(),
      limits: {
        requestMaxUsd: cfg.requestMaxMicro === null ? null : cfg.requestMaxMicro / 1e6,
        maxOutputTokens: cfg.maxOutputTokens,
        maxInputTokensBound: cfg.maxInputTokensBound,
        maxProviderRetries: cfg.maxRetries,
        scopes: Object.fromEntries(Object.entries(cfg.scopes).map(([k, v]) => [k, { dailyUsd: v.dailyMicro === null ? null : v.dailyMicro / 1e6, maxConcurrent: v.maxConcurrent, dailyCalls: v.maxCalls }]))
      },
      today: null,
      breaker: null,
      counters: { scope: "THIS_REPLICA_SINCE_START", allowed: counters.allowed, denied: { ...counters.denied }, wouldDeny: { ...counters.wouldDeny }, released: counters.released, settleErrors: counters.settleErrors }
    };
    try {
      const g = (await store.peek({ scope: scopesFor(cfg, {}, t)[0], nowMs: t }));
      out.today = { scope: "ALL_REPLICAS", dayUtc: dayKey(t), globalSeeded: g.seeded, globalSpentUsd: g.spentMicro === null ? null : g.spentMicro / 1e6, globalReservedUsd: g.reservedMicro / 1e6, globalConcurrent: g.concurrent, paidCalls: g.calls };
      const b = await readBreaker();
      out.breaker = { open: Boolean(b.openUntil && t < b.openUntil), consecutiveFailures: b.failures || 0, reason: b.reason || null, retryAfterSec: b.openUntil && t < b.openUntil ? Math.ceil((b.openUntil - t) / 1000) : 0 };
    } catch (_) {
      out.today = null; // not measured rather than guessed
    }
    return out;
  }

  return { config: cfg, guardClient, guardedCall, killState, setKillSwitch, status, estimateMaxCost: (o) => estimateMaxCost({ ...o, attempts: 1 + cfg.maxRetries, env }) };
}

module.exports = {
  AiPolicyDenied,
  DENY,
  loadBudgetConfig,
  parseEnabled,
  estimateMaxCost,
  scopesFor,
  dayKey,
  dayStartMs,
  createAiBudget,
  createRedisBudgetStore,
  createMemoryBudgetStore,
  createLedgerSeeder,
  KILL_KEY,
  BREAKER_KEY
};
