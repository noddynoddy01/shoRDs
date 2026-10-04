"use strict";
/**
 * Per-request AI accounting, shared by every replica (PostgreSQL `ai_usage`). One row for every request that goes through the
 * AI path, including cache hits and requests that never reached the model (no content), so the numbers add up:
 *
 *   provider, model, input/output/total tokens, estimated cost (only when a verified price exists, else NULL = NOT_MEASURED),
 *   cache hit, fallback, request id, paper id, duration.
 *
 * Nothing is invented: tokens come from the provider's own usage report (NULL when the provider did not report them, or when
 * the answer came from cache/fallback), and cost is NULL unless the price of that model has been verified.
 * Recording is best-effort by design: an accounting failure is logged and counted but never fails the user's request.
 * No token, key or request content is stored.
 */

const crypto = require("crypto");

const hashUser = (uid) => (uid ? crypto.createHash("sha256").update(uid).digest("hex").slice(0, 16) : null);

/**
 * @param {{httpStatus:number, body:object}} out the AI path result
 * @param {{kind:string, scope?:{tenantId:string, projectId:string}, uid?:string, jobId?:string, paperId?:string, replicaId?:string}} ctx
 */
function toUsageRow(out, ctx) {
  const b = out.body || {};
  const cacheStatus = b.cache && b.cache.status;
  const cacheHit = cacheStatus === "HIT" || cacheStatus === "DEDUPLICATED";
  const aiCalled = cacheHit ? false : b.aiCalled !== undefined ? Boolean(b.aiCalled) : b.modelMode === "EXTERNAL_CLAUDE";
  const t = b.tokens || {};
  const spent = aiCalled && t.source === "REAL_PROVIDER";
  const outcome = out.httpStatus !== 200 ? (b.error || `HTTP_${out.httpStatus}`) : cacheHit ? "CACHE_HIT" : String(b.status || "OK");
  return {
    request_id: String(b.requestId || "unknown"),
    job_id: ctx.jobId || null,
    tenant_id: ctx.scope ? ctx.scope.tenantId : null,
    project_id: ctx.scope ? ctx.scope.projectId : null,
    user_hash: hashUser(ctx.uid),
    paper_id: ctx.paperId || (b.paper && b.paper.paperId) || null,
    mode: ctx.kind,
    coverage: b.contentCoverage || null,
    provider: cacheHit ? (b.provider || "cache") : b.provider || "none",
    model: b.model || null,
    ai_called: aiCalled,
    cache_hit: cacheHit,
    fallback: Boolean(b.fallbackUsed),
    fallback_reason: b.fallbackReason || null,
    input_tokens: spent && Number.isInteger(t.inputTokens) ? t.inputTokens : null,
    output_tokens: spent && Number.isInteger(t.outputTokens) ? t.outputTokens : null,
    total_tokens: spent && Number.isInteger(t.totalTokens) ? t.totalTokens : null,
    cost_usd: spent && typeof t.estimatedCostUsd === "number" ? t.estimatedCostUsd : null,
    cost_status: cacheHit ? "NO_NEW_SPEND" : spent ? t.costStatus || "NOT_MEASURED" : aiCalled ? "NOT_MEASURED" : t.costStatus === "NO_AI_CALL" ? "NO_AI_CALL" : "NOT_AVAILABLE",
    duration_ms: Number.isFinite(b.latencyMs) ? Math.round(b.latencyMs) : null,
    replica_id: ctx.replicaId || b.replicaId || null,
    outcome: outcome.slice(0, 80)
  };
}

function createUsageLedger({ pool, logger = console }) {
  const stats = { written: 0, failed: 0 };

  async function record(out, ctx) {
    let row;
    try {
      row = toUsageRow(out, ctx);
      await pool.query(
        `INSERT INTO ai_usage (request_id, job_id, tenant_id, project_id, user_hash, paper_id, mode, coverage, provider, model, ai_called, cache_hit, fallback, fallback_reason,
           input_tokens, output_tokens, total_tokens, cost_usd, cost_status, duration_ms, replica_id, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [row.request_id, row.job_id, row.tenant_id, row.project_id, row.user_hash, row.paper_id, row.mode, row.coverage, row.provider, row.model, row.ai_called, row.cache_hit, row.fallback, row.fallback_reason,
          row.input_tokens, row.output_tokens, row.total_tokens, row.cost_usd, row.cost_status, row.duration_ms, row.replica_id, row.outcome]
      );
      stats.written += 1;
    } catch (e) {
      stats.failed += 1;
      // The structured log line is the fallback record; it carries no secrets or request content.
      logger.error(`[Usage] could not write ai_usage row (${e.code || e.name}); request=${row ? row.request_id : "?"} provider=${row ? row.provider : "?"} tokens=${row ? row.total_tokens : "?"}`);
    }
  }

  /** Aggregates across ALL replicas for the last `hours` (default 24). Unmeasured values stay null. */
  async function summary(hours = 24) {
    const r = await pool.query(
      `SELECT provider, COALESCE(model,'') AS model, count(*)::int AS requests,
              count(*) FILTER (WHERE ai_called)::int AS ai_calls,
              count(*) FILTER (WHERE cache_hit)::int AS cache_hits,
              count(*) FILTER (WHERE fallback)::int AS fallbacks,
              sum(input_tokens)::bigint AS input_tokens, sum(output_tokens)::bigint AS output_tokens, sum(total_tokens)::bigint AS total_tokens,
              sum(cost_usd) AS cost_usd, count(*) FILTER (WHERE ai_called AND cost_usd IS NULL)::int AS ai_calls_without_cost
         FROM ai_usage WHERE created_at > now() - ($1::int * interval '1 hour') GROUP BY provider, model ORDER BY requests DESC`,
      [hours]
    );
    return {
      scope: "ALL_REPLICAS",
      windowHours: hours,
      rows: r.rows.map((x) => ({
        provider: x.provider, model: x.model || null, requests: x.requests, aiCalls: x.ai_calls, cacheHits: x.cache_hits, fallbacks: x.fallbacks,
        inputTokens: x.input_tokens === null ? null : Number(x.input_tokens), outputTokens: x.output_tokens === null ? null : Number(x.output_tokens), totalTokens: x.total_tokens === null ? null : Number(x.total_tokens),
        estimatedCostUsd: x.cost_usd === null ? null : Number(Number(x.cost_usd).toFixed(6)), aiCallsWithoutCost: x.ai_calls_without_cost
      })),
      writer: { ...stats }
    };
  }

  return { record, summary, stats: () => ({ ...stats }) };
}

module.exports = { createUsageLedger, toUsageRow, hashUser };
