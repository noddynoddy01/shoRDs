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
    served: { realProvider: 0, fallback: 0 },
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

  /**
   * @param {object} e
   * @param {"REAL_PROVIDER"|"FALLBACK"} e.served       how the response was actually produced
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
        total: real + state.served.fallback,
        realProvider: real,
        fallback: state.served.fallback
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
      // Verified by inspection: backend/start_local_server.js does not import the TypeScript cache,
      // rate limiter or deduplicator, so none of these run on the production request path.
      runtimeComponents: { cache: "NOT_WIRED", deduplication: "NOT_WIRED", rateLimiter: "NOT_WIRED" },
      cacheHitRatio: null,
      lastSuccess: state.lastSuccess,
      lastError: state.lastError
    };
  }

  return { record, snapshot };
}

module.exports = { createTelemetry };
