"use strict";
/**
 * Assembles the production runtime from environment variables: PostgreSQL pool, Redis client, token verifier, rate
 * limiter, cache, job store, worker, readiness and the HTTP handler. `backend/start_local_server.js` is a thin wrapper that
 * listens on a port; tests build runtimes with the same function (and overrides) to run real replicas in one process.
 *
 * Required configuration (a missing one fails readiness and the dependent routes answer 503; nothing falls back silently):
 *   DATABASE_URL, REDIS_URL, FIREBASE_PROJECT_ID, CORS_ORIGINS (production)
 * Optional: ANTHROPIC_API_KEY (absent -> labelled local fallback), ANTHROPIC_MODEL, ADMIN_UIDS, AI_ENABLED, AI_BUDGET_* (see docs/architecture/AI_SPEND_SAFETY.md), RATE_LIMIT_*, WORKER_ENABLED,
 *           WORKER_CONCURRENCY, REQUIRE_AI_PROVIDER, TRUST_PROXY, TRUST_PROXY_HOPS, MAX_REQUEST_BODY_BYTES, AI_CACHE_ENABLED.
 */

const { PgPool, PgError } = require("./data/pgClient");
const { RedisClient, RedisError } = require("./data/redisClient");
const { runMigrations } = require("./data/migrations");
const { createVerifierFromEnv } = require("./security/auth");
const { loadCorsConfig } = require("./security/cors");
const { createRateLimiter, loadPolicies } = require("./security/rateLimit");
const { createResultCache } = require("./llm/resultCache");
const { createTelemetry } = require("./llm/telemetry");
const { createJobStore } = require("./jobs/jobStore");
const { createWorker } = require("./jobs/worker");
const { createAnalysisProcessor } = require("./jobs/analysisProcessor");
const { createProviders } = require("./papers/providers");
const { createPaperService, PaperError } = require("./papers/paperService");
const { createAiPipeline } = require("./llm/aiPipeline");
const { createUsageLedger } = require("./llm/usageLedger");
const { createAiBudget, createRedisBudgetStore, createLedgerSeeder } = require("./llm/aiBudget");
const { createReadinessChecker, createAiProbe } = require("./readiness");
const { createApp } = require("./app");

/** A pool/redis stand-in for a missing URL: every call rejects with a categorised "not configured" error (-> 503). */
function unconfiguredPool(err) {
  const reject = async () => { throw err; };
  return { query: reject, withClient: reject, transaction: reject, ping: async () => ({ ok: false, error: err.code }), end: async () => {} };
}
function unconfiguredRedis(err) {
  const reject = async () => { throw err; };
  return { command: reject, eval: reject, ping: async () => ({ ok: false, error: err.code }), duplicate: () => unconfiguredRedis(err), close: async () => {} };
}

function createRuntime(env = process.env, overrides = {}) {
  const logger = overrides.logger || console;
  const replicaId = overrides.replicaId || env.RAILWAY_REPLICA_ID || env.HOSTNAME || `replica-local-${process.pid}`;

  let pool = null;
  let dbError = null;
  try {
    pool = overrides.pool || new PgPool({ url: env.DATABASE_URL, max: Number(env.PG_POOL_MAX || 8) });
  } catch (e) {
    if (!(e instanceof PgError)) throw e;
    dbError = e;
  }
  let redis = null;
  let redisError = null;
  try {
    redis = overrides.redis || new RedisClient({ url: env.REDIS_URL, tlsCa: env.REDIS_TLS_CA || undefined });
  } catch (e) {
    if (!(e instanceof RedisError)) throw e;
    redisError = e;
  }
  const appPool = pool || unconfiguredPool(dbError);
  const appRedis = redis || unconfiguredRedis(redisError);

  const telemetry = overrides.telemetry || createTelemetry({ replicaId });
  const verifier = overrides.verifier || createVerifierFromEnv(env);
  const corsConfig = loadCorsConfig(env);
  const policies = loadPolicies(env); // throws on an invalid RATE_LIMIT_* value: fail at startup, not at 3 a.m.
  const rateLimiter = createRateLimiter({ redis: appRedis, policies, failMode: env.RATE_LIMIT_FAIL_MODE === "open" ? "open" : "closed" });
  telemetry.setRateLimiterSource(() => rateLimiter.snapshot());

  const cacheEnabled = env.AI_CACHE_ENABLED !== "false";
  const cache = cacheEnabled ? createResultCache({ redis: appRedis, ttlSec: Number(env.AI_CACHE_TTL_SEC || 86400), telemetry }) : null;
  telemetry.setComponents({ rateLimiter: "WIRED", cache: cache ? "WIRED" : "DISABLED", deduplication: cache ? "WIRED" : "DISABLED" });

  const jobStore = createJobStore({ pool: appPool, redis: appRedis, logger });
  const workerEnabled = env.WORKER_ENABLED !== "false";
  const providers = overrides.providers || createProviders({ http: overrides.http, env, logger });
  const paperService = createPaperService({
    pool: appPool,
    redis: appRedis,
    providers,
    logger,
    now: overrides.now,
    // One budget for calls to the scholarly providers, shared by every replica and user (they are third-party services).
    beforeRetrieve: async () => {
      const r = await rateLimiter.hit("RETRIEVAL_PROVIDERS", "global", "providers");
      if (!r.allowed) throw new PaperError("RETRIEVAL_THROTTLED", "Paper retrieval is busy. Please retry shortly.", 503, true);
    }
  });
  const ledger = createUsageLedger({ pool: appPool, logger });
  // Spend control: every paid model call passes this gate first. A malformed AI_BUDGET_* value throws here (fail at startup).
  // Postgres (ai_usage) is the authoritative record; Redis coordinates reservations. If Redis is unreachable paid calls are refused.
  const budget = overrides.budget || createAiBudget({ store: createRedisBudgetStore(appRedis), seedFromLedger: createLedgerSeeder(appPool), env, logger, now: overrides.now });
  const pipeline = createAiPipeline({ paperService, cache, ledger, telemetry, client: overrides.client, budget, env, replicaId, logger, now: overrides.now });
  const processor = createAnalysisProcessor({ pipeline });
  const worker = workerEnabled && pool && redis
    ? createWorker({
        store: jobStore,
        redis,
        processor,
        replicaId,
        concurrency: Number(env.WORKER_CONCURRENCY || 2),
        leaseSec: Number(env.JOB_LEASE_SEC || 120),
        heartbeatSec: Number(env.JOB_HEARTBEAT_SEC || 30),
        maintenanceSec: Number(env.JOB_MAINTENANCE_SEC || 15),
        blockSec: Number(env.JOB_BLOCK_SEC || 2),
        logger
      })
    : null;

  let draining = false;
  const baseReadiness = createReadinessChecker({
    pool,
    redis,
    verifier,
    aiCheck: overrides.aiCheck || createAiProbe({ env, probe: overrides.probe || undefined }),
    env,
    replicaId,
    worker: worker ? () => ({ running: worker.stats().running, inflight: worker.stats().inflight }) : null
  });
  // While shutting down this replica is alive (/health) but must not receive new work (/ready).
  const readiness = async () => {
    if (!draining) return baseReadiness();
    return { ready: false, status: "DRAINING", replicaId, timestamp: new Date((overrides.now || Date.now)()).toISOString(), checks: {}, warnings: ["Replica is shutting down"] };
  };

  const handler = createApp({
    env,
    replicaId,
    pool: appPool,
    redis: appRedis,
    verifier,
    rateLimiter,
    corsConfig,
    telemetry,
    jobStore,
    cache,
    paperService,
    pipeline,
    budget,
    ledger,
    readiness,
    workerStats: worker ? () => worker.stats() : null,
    client: overrides.client,
    logger,
    logRequests: overrides.logRequests,
    now: overrides.now
  });

  let migrationTimer = null;
  let stopped = false;

  /**
   * Run migrations, then start the worker. Never throws.
   *  - Transient failures (database not reachable yet, connection lost) are retried every 5 s; each attempt is atomic, so a
   *    retry never sees a half-applied migration.
   *  - A permanent failure (the database rejected a migration statement) cannot be fixed by retrying: it is logged once as FATAL
   *    (version, name and SQLSTATE only, never SQL or data), retrying stops, the replica stays NOT_READY (so the deploy health
   *    check fails and the previous release keeps serving), and `onFatal` is called (the entrypoint exits non-zero).
   */
  function startBackground({ onFatal } = {}) {
    if (!pool) {
      logger.error(`[Boot] DATABASE_URL is not configured (${dbError.code}); the service will report NOT_READY`);
      return;
    }
    const attempt = async () => {
      if (stopped) return;
      try {
        const r = await runMigrations(pool, overrides.migrations);
        logger.log(`[Boot] database schema at version ${r.current}${r.applied.length ? ` (applied ${r.applied.join(",")})` : ""}`);
        if (worker && !stopped) worker.start();
      } catch (e) {
        if (e && e.code === "MIGRATION_FAILED" && e.permanent) {
          logger.error(`[Boot] FATAL: ${e.message}; not retrying. The schema is unchanged by this migration (rolled back).`);
          if (onFatal) onFatal(e);
          return;
        }
        logger.error(`[Boot] migrations not applied yet (${e.code || "ERROR"}${e.version ? ` at version ${e.version}` : ""}); retrying in 5s`);
        migrationTimer = setTimeout(attempt, Number(env.MIGRATION_RETRY_MS) > 0 ? Number(env.MIGRATION_RETRY_MS) : 5000);
        if (migrationTimer.unref) migrationTimer.unref();
      }
    };
    return attempt();
  }

  function beginDrain() {
    draining = true;
  }

  async function shutdown(graceMs = 10000) {
    stopped = true;
    draining = true;
    if (migrationTimer) clearTimeout(migrationTimer);
    if (worker) await worker.stop(graceMs);
    if (redis) await redis.close();
    if (pool) await pool.end();
  }

  return { handler, replicaId, pool, redis, worker, jobStore, rateLimiter, cache, telemetry, verifier, corsConfig, readiness, paperService, pipeline, budget, ledger, startBackground, beginDrain, shutdown };
}

module.exports = { createRuntime };
