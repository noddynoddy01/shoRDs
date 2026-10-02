"use strict";
/**
 * Redis-backed fixed-window rate limiting for the production request path.
 *
 * Counters live in Redis (shared by every replica), so a limit of 20/min means 20/min across the whole service, not per
 * replica. INCR + EXPIRE run in one Lua script, so a crash between the two cannot leave an immortal key.
 *
 * Scopes (what the counter is keyed by): ip, user (Firebase uid), tenant (the project's tenant). Identifiers are hashed
 * before use in keys, so no user input can alter the key structure and keys stay short.
 *
 * Policies are env-configurable: RATE_LIMIT_<NAME>="<limit>/<windowSeconds>", e.g. RATE_LIMIT_COPILOT_USER=30/60.
 * An invalid value stops startup (loadPolicies throws) instead of silently running with a different limit.
 *
 * If Redis cannot answer, RateLimiterUnavailable is thrown and the caller answers 503 (fail closed). That is deliberate:
 * with open sign-up, "no limiter" means unbounded model spend. RATE_LIMIT_FAIL_MODE=open exists as an explicit,
 * counted opt-out.
 */

const crypto = require("crypto");

const LUA_INCR = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) ttl = tonumber(ARGV[1]) end
return {c, ttl}
`;

// name -> default "limit/windowSeconds"
const DEFAULT_POLICIES = {
  GLOBAL_IP: "300/60",
  AUTH_FAIL_IP: "20/60",
  READ_USER: "240/60",
  WRITE_USER: "30/60",
  COPILOT_USER: "20/60",
  COPILOT_USER_DAILY: "400/86400",
  COPILOT_TENANT: "120/60",
  COPILOT_TENANT_DAILY: "2000/86400",
  ANALYSIS_USER: "10/60",
  ANALYSIS_USER_DAILY: "100/86400",
  ANALYSIS_TENANT: "60/60",
  ANALYSIS_TENANT_DAILY: "1000/86400"
};

class RateLimiterUnavailable extends Error {
  constructor(cause) {
    super("rate limiter backend unavailable");
    this.name = "RateLimiterUnavailable";
    this.code = "RATE_LIMITER_UNAVAILABLE";
    this.cause = cause && cause.code ? cause.code : "UNKNOWN";
  }
}

function parsePolicy(name, value) {
  const m = /^(\d{1,9})\/(\d{1,9})$/.exec(String(value).trim());
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) {
    throw new Error(`RATE_LIMIT_${name} must look like "<limit>/<windowSeconds>" with positive integers (got "${String(value).slice(0, 40)}")`);
  }
  return { name, limit: Number(m[1]), windowSec: Number(m[2]) };
}

function loadPolicies(env = process.env) {
  const out = {};
  for (const [name, def] of Object.entries(DEFAULT_POLICIES)) {
    const override = env[`RATE_LIMIT_${name}`];
    out[name] = parsePolicy(name, override !== undefined && override !== "" ? override : def);
  }
  return out;
}

function scopeKey(policy, scope, id) {
  const h = crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 24);
  return `shords:rl:${policy.name}:${scope}:${h}`;
}

/** Client IP. X-Forwarded-For is only trusted when TRUST_PROXY=true, and then only the entry `hops` from the right. */
function clientIp(req, { trustProxy = false, hops = 1 } = {}) {
  if (trustProxy) {
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (xff.length >= hops) return xff[xff.length - hops];
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function createRateLimiter({ redis, policies, failMode = "closed", now = Date.now }) {
  const stats = { allowed: 0, limited: 0, backendErrors: 0, failedOpen: 0, byPolicy: {} };
  const bump = (name, field) => {
    const p = (stats.byPolicy[name] = stats.byPolicy[name] || { allowed: 0, limited: 0 });
    p[field] += 1;
  };

  /** Count one hit. Returns { allowed, limit, remaining, resetSec, policy }. */
  async function hit(policyName, scope, id) {
    const policy = policies[policyName];
    if (!policy) throw new Error(`unknown rate-limit policy ${policyName}`);
    try {
      const [count, ttl] = await redis.eval(LUA_INCR, [scopeKey(policy, scope, id)], [policy.windowSec]);
      const allowed = count <= policy.limit;
      stats[allowed ? "allowed" : "limited"] += 1;
      bump(policyName, allowed ? "allowed" : "limited");
      return { allowed, limit: policy.limit, remaining: Math.max(0, policy.limit - count), resetSec: Math.max(1, ttl), policy: policyName, scope };
    } catch (e) {
      stats.backendErrors += 1;
      if (failMode === "open") {
        stats.failedOpen += 1;
        return { allowed: true, limit: policy.limit, remaining: null, resetSec: null, policy: policyName, scope, failedOpen: true };
      }
      throw new RateLimiterUnavailable(e);
    }
  }

  /** Read the counter without incrementing it (used to refuse an IP that has already failed authentication too often). */
  async function peek(policyName, scope, id) {
    const policy = policies[policyName];
    try {
      const raw = await redis.command("GET", scopeKey(policy, scope, id));
      const count = raw === null ? 0 : Number(raw);
      return { allowed: count < policy.limit, limit: policy.limit, remaining: Math.max(0, policy.limit - count), policy: policyName, scope };
    } catch (e) {
      stats.backendErrors += 1;
      if (failMode === "open") {
        stats.failedOpen += 1; // counted, like hit(): the bypass must be visible in metrics
        return { allowed: true, limit: policy.limit, remaining: null, policy: policyName, scope, failedOpen: true };
      }
      throw new RateLimiterUnavailable(e);
    }
  }

  return {
    hit,
    peek,
    policies,
    failMode,
    snapshot: () => ({ failMode, ...stats, byPolicy: JSON.parse(JSON.stringify(stats.byPolicy)) })
  };
}

function rateLimitHeaders(result) {
  const h = {};
  if (result.limit !== undefined) h["RateLimit-Limit"] = String(result.limit);
  if (result.remaining !== null && result.remaining !== undefined) h["RateLimit-Remaining"] = String(result.remaining);
  if (result.resetSec) h["RateLimit-Reset"] = String(result.resetSec);
  if (!result.allowed && result.resetSec) h["Retry-After"] = String(result.resetSec);
  return h;
}

module.exports = { createRateLimiter, loadPolicies, parsePolicy, clientIp, rateLimitHeaders, RateLimiterUnavailable, DEFAULT_POLICIES, LUA_INCR };
