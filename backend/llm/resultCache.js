"use strict";
/**
 * Redis result cache + single-flight de-duplication for model answers (shared by every replica).
 *
 * Wired on the real runtime path: backend/app.js (copilot route) and backend/jobs/analysisProcessor.js both call
 * `cachedCopilotQuery`. Only real provider answers are cached; local fallbacks, content-unavailable results, truncated
 * answers and errors are never stored (a later request with a working key must get a real answer).
 *
 * Key isolation: the key is a SHA-256 over every field that can change the answer or the audience:
 *   tenant, project, paper, content hash of the evidence, model, analysis depth, prompt version, schema version, question.
 * Two tenants (or projects) asking the same question about the same paper therefore never share an entry; a changed
 * paper text, model or prompt version never serves a stale answer.
 *
 * De-duplication: concurrent identical requests take a Redis lock (SET NX PX). The holder calls the model; the others
 * wait for its cache entry instead of paying for a second call. If the holder dies the lock expires and a waiter proceeds.
 */

const crypto = require("crypto");

const CACHE_SCHEMA_VERSION = 1;
const KEY_PREFIX = "shords:cache:copilot";
const UNLOCK_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function contentHash(chunks) {
  const parts = [...chunks]
    .sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
    .map((c) => [c.chunkId, c.section || "", c.page === null || c.page === undefined ? "" : c.page, c.text].join("\u0000"));
  return sha256(parts.join("\u0001"));
}

/**
 * @param {object} p
 * @param {string} p.tenantId @param {string} p.projectId @param {string} p.paperId @param {string} p.contentHash
 * @param {string} p.model @param {string} p.mode @param {string} p.promptVersion @param {string} p.query
 */
function buildCacheKey(p) {
  for (const f of ["tenantId", "projectId", "paperId", "contentHash", "model", "mode", "promptVersion", "query"]) {
    if (typeof p[f] !== "string" || p[f] === "") throw new Error(`cache key field "${f}" is required`);
  }
  // Fixed field order and JSON encoding: no delimiter ambiguity between fields.
  const material = JSON.stringify([CACHE_SCHEMA_VERSION, p.tenantId, p.projectId, p.paperId, p.contentHash, p.model, p.mode, p.promptVersion, sha256(p.query)]);
  return `${KEY_PREFIX}:v${CACHE_SCHEMA_VERSION}:${sha256(material)}`;
}

function createResultCache({ redis, ttlSec = 86400, lockMs = 120000, pollMs = 250, telemetry = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const note = (kind) => telemetry && telemetry.recordCache && telemetry.recordCache(kind);

  async function get(key) {
    try {
      const raw = await redis.command("GET", key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      note("error");
      return null; // a cache problem must never fail a request; the model call proceeds
    }
  }

  async function set(key, value) {
    try {
      await redis.command("SET", key, JSON.stringify(value), "EX", ttlSec);
      note("store");
    } catch (e) {
      note("error");
    }
  }

  /**
   * Returns { value, source: "CACHE_HIT" | "DEDUPLICATED" | "COMPUTED" }.
   * `produce()` -> { value, cacheable }.
   */
  async function getOrCompute(key, produce) {
    const hit = await get(key);
    if (hit) {
      note("hit");
      return { value: hit, source: "CACHE_HIT" };
    }
    note("miss");

    const lockKey = `${key}:lock`;
    const token = crypto.randomBytes(8).toString("hex");
    let locked = false;
    try {
      locked = (await redis.command("SET", lockKey, token, "NX", "PX", lockMs)) === "OK";
    } catch (e) {
      note("error"); // no lock available: just compute (cannot dedup, still correct)
    }

    if (!locked) {
      const deadline = now() + lockMs;
      while (now() < deadline) {
        await sleep(pollMs);
        const waited = await get(key);
        if (waited) {
          note("dedup_wait");
          return { value: waited, source: "DEDUPLICATED" };
        }
        let held = true;
        try {
          held = (await redis.command("EXISTS", lockKey)) === 1;
        } catch (_) {
          held = false;
        }
        if (!held) break; // holder finished without caching (fallback/error) or died: compute ourselves
      }
    }

    try {
      const { value, cacheable } = await produce();
      if (cacheable) await set(key, value);
      return { value, source: "COMPUTED" };
    } finally {
      if (locked) {
        try {
          await redis.eval(UNLOCK_LUA, [lockKey], [token]);
        } catch (_) {
          /* lock expires on its own */
        }
      }
    }
  }

  return { get, set, getOrCompute, buildCacheKey };
}

/**
 * Run any AI call through the cache. `key === null` means "not cacheable": the plain producer runs (BYPASS / NOT_WIRED).
 * @param {object} p
 * @param {object|null} p.cache  createResultCache()
 * @param {string|null} p.key    from buildCacheKey
 * @param {Function} p.produce   async () => ({ httpStatus, body })
 * @param {Function} p.cacheableOf  (out) => boolean; only real, complete, non-fallback provider answers may be stored
 * @param {string} p.replicaId @param {Function} [p.now] @param {object} [p.telemetry]
 */
async function cachedAiCall({ cache, key, produce, cacheableOf, replicaId, now = Date.now, telemetry = null }) {
  if (!cache || !key) {
    const out = await produce();
    return { ...out, body: { ...out.body, cache: { status: cache ? "BYPASS" : "NOT_WIRED" } } };
  }
  const started = now();
  const res = await cache.getOrCompute(key, async () => {
    const out = await produce();
    return { value: { httpStatus: out.httpStatus, body: out.body }, cacheable: cacheableOf(out) };
  });
  if (res.source === "COMPUTED") return { httpStatus: res.value.httpStatus, body: { ...res.value.body, cache: { status: "MISS" } } };

  // Served from the shared cache: it is a stored answer, so say so, and do not report tokens that were not spent now.
  telemetry && telemetry.record && telemetry.record({ served: "CACHE_HIT" });
  const orig = res.value.body;
  return {
    httpStatus: res.value.httpStatus,
    body: {
      ...orig,
      replicaId,
      cache: { status: res.source === "DEDUPLICATED" ? "DEDUPLICATED" : "HIT", originalRequestId: orig.requestId },
      requestId: `req_cache_${now()}_${Math.random().toString(36).slice(2, 7)}`,
      tokens: { source: "CACHE", inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: 0, costStatus: "NO_NEW_SPEND", originalTokens: orig.tokens },
      latencyMs: now() - started
    }
  };
}

const isRealCompleteAnswer = (out) => out.httpStatus === 200 && out.body.modelMode === "EXTERNAL_CLAUDE" && out.body.fallbackUsed === false && out.body.truncated !== true && out.body.status !== "ANALYSIS_FAILED";

/**
 * Run a copilot query (question + supplied chunks) through the cache. Kept for the question-answering path.
 * @param {object} p  see cachedAiCall; plus `copilot`, `validate`, `rawBody`, `scope`, `model`, `promptVersion`, `hasProviderKey`
 */
async function cachedCopilotQuery({ cache, copilot, validate, rawBody, scope, model, promptVersion, hasProviderKey, replicaId, now = Date.now, telemetry = null }) {
  const v = validate(rawBody);
  // Invalid requests, requests with no content and requests that cannot reach a provider are not cacheable:
  // the plain handler produces the (400 / fallback) answer.
  const cacheable = cache && v.ok && v.value.chunks.length > 0 && hasProviderKey;
  const key = cacheable
    ? buildCacheKey({ tenantId: scope.tenantId, projectId: scope.projectId, paperId: v.value.paperId, contentHash: contentHash(v.value.chunks), model, mode: v.value.depth || "STANDARD", promptVersion, query: v.value.query })
    : null;
  return cachedAiCall({ cache, key, produce: () => copilot(rawBody), cacheableOf: isRealCompleteAnswer, replicaId, now, telemetry });
}

module.exports = { createResultCache, buildCacheKey, contentHash, cachedAiCall, cachedCopilotQuery, isRealCompleteAnswer, CACHE_SCHEMA_VERSION };
