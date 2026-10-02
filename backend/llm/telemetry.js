"use strict";
/**
 * In-process LLM telemetry for the production entrypoint.
 *
 * Only real, observed events are counted. Anything that is not measured on this code path is reported as
 * `null` or `NOT_WIRED` rather than a plausible-looking number. Counters are per replica and reset on restart;
 * they are NOT aggregated across Railway replicas.
 */

function createTelemetry({ now = Date.now, replicaId = "unknown" } = {}) {
  const startedAt = now();
  const state = {
    served: { realProvider: 0, fallback: 0, cacheHit: 0 },
    fallbackReasons: {},
    providerErrors: {},
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    realWithUsage: 0,
    realWithCost: 0,
    lastSuccess: null,
    lastError: null
  };
  const cache = { hits: 0, misses: 0, stores: 0, dedupWaits: 0, errors: 0 };
  // Components are reported NOT_WIRED until the entrypoint declares them wired (setComponents). Wiring is a fact about
  // the running process, not a default.
  let components = { cache: "NOT_WIRED", deduplication: "NOT_WIRED", rateLimiter: "NOT_WIRED" };
  let rateLimiterSnapshot = null;

  function recordCache(kind) {
    const k = { hit: "hits", miss: "misses", store: "stores", dedup_wait: "dedupWaits", error: "errors" }[kind];
    if (k) cache[k] += 1;
  }
  function setComponents(next) {
    components = { ...components, ...next };
  }
  function setRateLimiterSource(fn) {
    rateLimiterSnapshot = fn;
  }

  /**
   * @param {object} e
   * @param {"REAL_PROVIDER"|"FALLBACK"|"CACHE_HIT"} e.served       how the response was actually produced
   * @param {string} [e.fallbackReason]
   * @param {{category:string, httpStatus?:number}} [e.providerError]  set when a provider call failed
   * @param {{inputTokens:number, outputTokens:number}|null} [e.usage] real usage reported by the provider
   * @param {number|null} [e.costUsd]
   */
  function record(e) {
    const at = new Date(now()).toISOString();
    if (e.served === "REAL_PROVIDER") {
      state.served.realProvider += 1;
      state.lastSuccess = { at, model: e.model || null };
      if (e.usage) {
        state.realWithUsage += 1;
        state.inputTokens += e.usage.inputTokens;
        state.outputTokens += e.usage.outputTokens;
      }
      if (typeof e.costUsd === "number") {
        state.realWithCost += 1;
        state.costUsd += e.costUsd;
      }
    } else if (e.served === "CACHE_HIT") {
      state.served.cacheHit += 1; // answered from the shared cache: no provider call, no tokens, not a fallback
    } else {
      state.served.fallback += 1;
      const reason = e.fallbackReason || "UNSPECIFIED";
      state.fallbackReasons[reason] = (state.fallbackReasons[reason] || 0) + 1;
    }
    if (e.providerError) {
      const cat = e.providerError.category || "UNKNOWN";
      state.providerErrors[cat] = (state.providerErrors[cat] || 0) + 1;
      state.lastError = { at, category: cat, httpStatus: e.providerError.httpStatus || null };
    }
  }

  function snapshot() {
    const real = state.served.realProvider;
    return {
      scope: "REPLICA_LOCAL",
      replicaId,
      since: new Date(startedAt).toISOString(),
      note: "In-memory counters for this replica only; reset on restart; not aggregated across replicas.",
      requests: {
        total: real + state.served.fallback + state.served.cacheHit,
        realProvider: real,
        fallback: state.served.fallback,
        cacheHit: state.served.cacheHit
      },
      fallbackReasons: { ...state.fallbackReasons },
      providerErrors: { ...state.providerErrors },
      tokens:
        state.realWithUsage > 0
          ? {
              status: "MEASURED",
              source: "REAL_PROVIDER",
              requestsCounted: state.realWithUsage,
              inputTokens: state.inputTokens,
              outputTokens: state.outputTokens,
              totalTokens: state.inputTokens + state.outputTokens
            }
          : { status: "NOT_MEASURED", source: null, requestsCounted: 0, inputTokens: null, outputTokens: null, totalTokens: null },
      cost:
        state.realWithCost > 0
          ? { costStatus: "ESTIMATED", requestsCounted: state.realWithCost, estimatedCostUsd: Number(state.costUsd.toFixed(6)) }
          : { costStatus: "NOT_MEASURED", requestsCounted: 0, estimatedCostUsd: null },
      runtimeComponents: { ...components },
      cache: components.cache === "WIRED" ? { ...cache } : null,
      cacheHitRatio: cache.hits + cache.misses > 0 ? Number((cache.hits / (cache.hits + cache.misses)).toFixed(4)) : null,
      rateLimiter: rateLimiterSnapshot ? rateLimiterSnapshot() : null,
      lastSuccess: state.lastSuccess,
      lastError: state.lastError
    };
  }

  return { record, recordCache, setComponents, setRateLimiterSource, snapshot };
}

module.exports = { createTelemetry };
