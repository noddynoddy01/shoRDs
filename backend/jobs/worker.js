"use strict";
/**
 * Analysis worker: pulls job ids from the Redis queue, claims them atomically in PostgreSQL, runs the processor, and
 * records the outcome. Runs inside every API replica by default (WORKER_ENABLED != "false"); `node backend/worker.js`
 * runs it alone. Any worker on any replica can process any job.
 */

const os = require("os");

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function createWorker({
  store,
  redis,
  processor,
  replicaId,
  workerId = `${replicaId}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`,
  concurrency = 2,
  leaseSec = 120,
  heartbeatSec = 30,
  maintenanceSec = 15,
  staleRequeueSec = 30,
  blockSec = 2,
  logger = console
}) {
  let running = false;
  const conns = [];
  const loops = [];
  let maintenanceTimer = null;
  const inflight = new Set();
  const stats = { claimed: 0, completed: 0, failed: 0, cancelled: 0, lost: 0, loopErrors: 0, lastLoopError: null, started: null };

  async function handle(jobId) {
    const row = await store.claim(jobId, workerId, replicaId, leaseSec);
    if (!row) return; // already taken, cancelled, or finished: duplicate queue entries are expected and harmless
    stats.claimed += 1;
    let leaseLost = false;
    const hb = setInterval(async () => {
      try {
        const r = await store.heartbeat(jobId, workerId, leaseSec);
        if (!r.held) leaseLost = true;
      } catch (_) {
        /* a failed heartbeat is retried on the next tick; the lease is long enough to survive a few misses */
      }
    }, heartbeatSec * 1000);
    try {
      const result = await processor.process(row);
      if (leaseLost) {
        stats.lost += 1;
        return; // someone else owns the job now; do not overwrite
      }
      const done = await store.complete(jobId, workerId, result);
      if (done && done.status === "CANCELLED") stats.cancelled += 1;
      else if (done) stats.completed += 1;
      else stats.lost += 1;
    } catch (err) {
      const code = (err && err.code) || "PROCESSING_ERROR";
      const retryable = err && typeof err.retryable === "boolean" ? err.retryable : true;
      logger.error(`[Worker] job ${jobId} failed (code=${code}, retryable=${retryable}): ${err && err.message ? String(err.message).slice(0, 200) : err}`);
      try {
        const f = await store.fail(jobId, workerId, { code: String(code).slice(0, 60), message: err && err.message, retryable });
        if (f && f.status === "FAILED") stats.failed += 1;
      } catch (e2) {
        logger.error(`[Worker] could not record failure of ${jobId}: ${e2.code || e2.message}`); // lease expiry will recover it
      }
    } finally {
      clearInterval(hb);
    }
  }

  async function loop(conn) {
    while (running) {
      try {
        const popped = await conn.command("BRPOP", store.queueKey, blockSec);
        if (!popped) continue;
        const p = handle(popped[1]);
        inflight.add(p);
        try {
          await p;
        } finally {
          inflight.delete(p);
        }
      } catch (e) {
        if (!running) return;
        stats.loopErrors += 1;
        stats.lastLoopError = { at: new Date().toISOString(), code: e.code || "ERROR" };
        await sleepMs(1000); // Redis/PostgreSQL hiccup: back off and keep going
      }
    }
  }

  async function maintenance() {
    try {
      await store.reapExpired();
      await store.requeueStale(staleRequeueSec);
    } catch (e) {
      stats.loopErrors += 1;
      stats.lastLoopError = { at: new Date().toISOString(), code: e.code || "ERROR" };
    }
  }

  return {
    workerId,
    start() {
      if (running) return;
      running = true;
      stats.started = new Date().toISOString();
      for (let i = 0; i < concurrency; i++) {
        const conn = redis.duplicate({ commandTimeoutMs: (blockSec + 3) * 1000 });
        conns.push(conn);
        loops.push(loop(conn));
      }
      maintenance();
      maintenanceTimer = setInterval(maintenance, maintenanceSec * 1000);
      if (maintenanceTimer.unref) maintenanceTimer.unref();
    },
    /** Stop taking jobs, let running ones finish (up to graceMs), then close connections. */
    async stop(graceMs = 10000) {
      running = false;
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      const deadline = Date.now() + graceMs;
      while (inflight.size > 0 && Date.now() < deadline) await sleepMs(50);
      for (const c of conns) await c.close();
      await Promise.allSettled(loops);
    },
    stats: () => ({ ...stats, running, concurrency, inflight: inflight.size, host: os.hostname() }),
    // exposed for tests
    _handle: handle,
    _maintenance: maintenance
  };
}

module.exports = { createWorker };
