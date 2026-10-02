"use strict";
/**
 * Honest readiness. `/health` says the process is alive; `/ready` says whether this replica can do its job:
 *
 *   database  : DATABASE_URL set, a real `SELECT 1` answered, schema at the expected migration  (required)
 *   redis     : REDIS_URL set, a real PING answered                                           (required)
 *   auth      : FIREBASE_PROJECT_ID set and the token signing keys are loadable               (required)
 *   aiProvider: key configured? provider reachable with that key/model? (token-free metadata probe)
 *               required only when REQUIRE_AI_PROVIDER=true; otherwise a missing/unreachable provider makes the replica
 *               DEGRADED (the grounded local fallback still answers, labelled) but still ready.
 *
 * A dependency whose configuration is missing is reported NOT_CONFIGURED and fails readiness; it is never reported healthy.
 * Nothing here contains a connection string, key or hostname: errors are category codes only.
 */

const { probeModel } = require("./llm/anthropicClient");
const { resolveApiKey, resolveModelConfig } = require("./llm/anthropicClient");
const { schemaStatus } = require("./data/migrations");

const withTimeout = (promise, ms, onTimeout) => {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

function createAiProbe({ env = process.env, probe = probeModel, ttlMs, now = Date.now } = {}) {
  const ttl = ttlMs !== undefined ? ttlMs : Math.max(5, Number(env.AI_PROBE_TTL_SEC || 60)) * 1000;
  let cached = null;
  return async function check() {
    const apiKey = resolveApiKey(env);
    const { model } = resolveModelConfig(env);
    if (!apiKey) return { status: "NOT_CONFIGURED", detail: "NO_API_KEY", model, probedAt: null };
    if (cached && now() - cached.at < ttl) return cached.value;
    const r = await probe({ apiKey, model });
    const value = { status: r.status, detail: r.detail, model, probedAt: new Date(now()).toISOString() };
    cached = { at: now(), value };
    return value;
  };
}

function createReadinessChecker({ pool, redis, verifier, aiCheck, env = process.env, replicaId, worker = null, checkTimeoutMs = 2500, now = Date.now }) {
  let inflight = null;

  async function run() {
    const requireAi = env.REQUIRE_AI_PROVIDER === "true";

    const dbCheck = async () => {
      if (!pool) return { status: "NOT_CONFIGURED", required: true };
      const ping = await withTimeout(pool.ping(), checkTimeoutMs, { ok: false, latencyMs: checkTimeoutMs, error: "CHECK_TIMEOUT" });
      if (!ping.ok) return { status: "DOWN", required: true, latencyMs: ping.latencyMs, error: ping.error };
      const schema = await withTimeout(schemaStatus(pool), checkTimeoutMs, { ok: false, current: null, expected: null, error: "CHECK_TIMEOUT" });
      if (!schema.ok) return { status: "SCHEMA_NOT_READY", required: true, latencyMs: ping.latencyMs, schema: { current: schema.current, expected: schema.expected, error: schema.error } };
      return { status: "OK", required: true, latencyMs: ping.latencyMs, schema: { current: schema.current, expected: schema.expected } };
    };

    const redisCheck = async () => {
      if (!redis) return { status: "NOT_CONFIGURED", required: true };
      const ping = await withTimeout(redis.ping(), checkTimeoutMs, { ok: false, latencyMs: checkTimeoutMs, error: "CHECK_TIMEOUT" });
      return ping.ok ? { status: "OK", required: true, latencyMs: ping.latencyMs } : { status: "DOWN", required: true, latencyMs: ping.latencyMs, error: ping.error };
    };

    const authCheck = async () => {
      const s = await withTimeout(verifier.status(), checkTimeoutMs, { configured: true, ready: false, keysLoaded: 0, lastError: { message: "CHECK_TIMEOUT" } });
      if (!s.configured) return { status: "NOT_CONFIGURED", required: true };
      return s.ready ? { status: "OK", required: true, keysLoaded: s.keysLoaded } : { status: "KEYS_UNAVAILABLE", required: true, keysLoaded: s.keysLoaded };
    };

    const aiCheckRun = async () => {
      const r = await withTimeout(aiCheck(), checkTimeoutMs + 2000, { status: "UNREACHABLE", detail: "CHECK_TIMEOUT", model: null, probedAt: null });
      return { ...r, required: requireAi };
    };

    const [database, redisRes, auth, aiProvider] = await Promise.all([dbCheck(), redisCheck(), authCheck(), aiCheckRun()]);
    const checks = { database, redis: redisRes, auth, aiProvider };
    if (worker) checks.worker = { enabled: true, ...worker() };
    else checks.worker = { enabled: false };

    const requiredOk = database.status === "OK" && redisRes.status === "OK" && auth.status === "OK";
    const aiOk = aiProvider.status === "REACHABLE";
    const ready = requiredOk && (!requireAi || aiOk);
    const status = !ready ? "NOT_READY" : aiOk ? "READY" : "DEGRADED";
    const warnings = [];
    if (ready && !aiOk) warnings.push(`AI provider ${aiProvider.status}: answers use the labelled local fallback`);

    return { ready, status, replicaId, timestamp: new Date(now()).toISOString(), checks, warnings };
  }

  // concurrent probes share one evaluation (cheap protection against a probe flood)
  return async function check() {
    if (!inflight) inflight = run().finally(() => { inflight = null; });
    return inflight;
  };
}

module.exports = { createReadinessChecker, createAiProbe };
