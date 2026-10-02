"use strict";
/**
 * Persistent analysis jobs: PostgreSQL is the source of truth, Redis is the wake-up queue.
 *
 *   API (any replica) --INSERT QUEUED--> PostgreSQL --LPUSH job id--> Redis list
 *   worker (any replica) --BRPOP--> atomic claim (UPDATE .. WHERE status='QUEUED') --> PROCESSING --> COMPLETED | FAILED
 *
 * Because state lives in PostgreSQL, a job created on replica A can be polled on replica B. If Redis loses the queue entry
 * (or was down at enqueue time) the job is still QUEUED in PostgreSQL and `requeueStale` pushes it again; a duplicate queue
 * entry is harmless because the claim is atomic. A worker that dies mid-job leaves an expired lease, which `reapExpired`
 * turns back into QUEUED (or FAILED after max_attempts).
 *
 * States: QUEUED -> PROCESSING -> COMPLETED | FAILED, QUEUED|PROCESSING -> CANCELLED. Terminal states never change.
 */

const crypto = require("crypto");

const QUEUE_KEY = "shords:queue:analysis";
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function newJobId() {
  return `job_${crypto.randomBytes(12).toString("hex")}`;
}

function toView(row, { includeResult = true } = {}) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    paperId: row.paper_id,
    status: row.status,
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    cancelRequested: row.cancel_requested,
    createdByReplica: row.created_by_replica,
    processedByReplica: row.processed_by_replica,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    result: includeResult ? row.result : undefined
  };
}

function createJobStore({ pool, redis, queueKey = QUEUE_KEY, logger = console }) {
  async function enqueue(jobId) {
    try {
      await redis.command("LPUSH", queueKey, jobId);
      return true;
    } catch (e) {
      logger.warn(`[Jobs] could not enqueue ${jobId} in Redis (${e.code || e.message}); it stays QUEUED in PostgreSQL and will be re-queued`);
      return false;
    }
  }

  /**
   * @returns {Promise<{job, created:boolean, enqueued:boolean|null}>}
   * With an idempotency key, a repeat request by the same user returns the original job (created:false).
   */
  async function createJob({ projectId, tenantId, userId, paperId, request, idempotencyKey = null, replicaId, maxAttempts = 3 }) {
    const jobId = newJobId();
    const ins = await pool.query(
      `INSERT INTO analysis_jobs (job_id, project_id, tenant_id, user_id, paper_id, idempotency_key, request, status, max_attempts, created_by_replica)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'QUEUED',$8,$9)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [jobId, projectId, tenantId, userId, paperId, idempotencyKey, JSON.stringify(request), maxAttempts, replicaId]
    );
    if (ins.rowCount === 0) {
      const existing = await pool.query("SELECT * FROM analysis_jobs WHERE user_id = $1 AND idempotency_key = $2", [userId, idempotencyKey]);
      return { job: toView(existing.rows[0]), created: false, enqueued: null };
    }
    const enqueued = await enqueue(jobId);
    return { job: toView(ins.rows[0]), created: true, enqueued };
  }

  async function getJob(jobId) {
    const r = await pool.query("SELECT * FROM analysis_jobs WHERE job_id = $1", [jobId]);
    return r.rows[0] || null; // raw row: callers authorize on project_id before returning toView()
  }

  /** QUEUED -> CANCELLED immediately. PROCESSING -> cancel_requested (the worker discards its result). Terminal: unchanged. */
  async function cancelJob(jobId) {
    const q = await pool.query(
      `UPDATE analysis_jobs SET status='CANCELLED', cancel_requested=TRUE, finished_at=now(), updated_at=now()
       WHERE job_id=$1 AND status='QUEUED' RETURNING *`,
      [jobId]
    );
    if (q.rowCount === 1) return { row: q.rows[0], outcome: "CANCELLED" };
    const p = await pool.query(
      `UPDATE analysis_jobs SET cancel_requested=TRUE, updated_at=now() WHERE job_id=$1 AND status='PROCESSING' RETURNING *`,
      [jobId]
    );
    if (p.rowCount === 1) return { row: p.rows[0], outcome: "CANCEL_REQUESTED" };
    const cur = await getJob(jobId);
    return { row: cur, outcome: cur ? "ALREADY_TERMINAL" : "NOT_FOUND" };
  }

  /** Atomic claim. Returns the job row (with `request`) for exactly one caller, or null. */
  async function claim(jobId, workerId, replicaId, leaseSec) {
    const r = await pool.query(
      `UPDATE analysis_jobs
          SET status='PROCESSING', attempts=attempts+1, worker_id=$2, processed_by_replica=$3, progress=10,
              lease_expires_at = now() + make_interval(secs => $4::float8),
              started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE job_id=$1 AND status='QUEUED' AND cancel_requested = FALSE
        RETURNING *`,
      [jobId, workerId, replicaId, leaseSec]
    );
    return r.rows[0] || null;
  }

  async function heartbeat(jobId, workerId, leaseSec, progress = null) {
    const r = await pool.query(
      `UPDATE analysis_jobs SET lease_expires_at = now() + make_interval(secs => $3::float8), updated_at = now(),
              progress = COALESCE($4::int, progress)
        WHERE job_id=$1 AND worker_id=$2 AND status='PROCESSING' RETURNING cancel_requested`,
      [jobId, workerId, leaseSec, progress]
    );
    return r.rowCount === 1 ? { held: true, cancelRequested: r.rows[0].cancel_requested } : { held: false, cancelRequested: false };
  }

  /** COMPLETED, unless cancellation was requested meanwhile (then CANCELLED and the result is dropped). */
  async function complete(jobId, workerId, result) {
    const r = await pool.query(
      `UPDATE analysis_jobs
          SET status = CASE WHEN cancel_requested THEN 'CANCELLED' ELSE 'COMPLETED' END,
              result = CASE WHEN cancel_requested THEN NULL ELSE $3::jsonb END,
              progress = CASE WHEN cancel_requested THEN progress ELSE 100 END,
              lease_expires_at = NULL, finished_at = now(), updated_at = now()
        WHERE job_id=$1 AND worker_id=$2 AND status='PROCESSING' RETURNING *`,
      [jobId, workerId, JSON.stringify(result)]
    );
    return r.rows[0] || null;
  }

  /** Retryable failures go back to QUEUED until max_attempts; everything else is FAILED with a categorised error. */
  async function fail(jobId, workerId, { code, message, retryable = false }) {
    const safeMessage = String(message || "").slice(0, 300);
    const r = await pool.query(
      `UPDATE analysis_jobs
          SET status = CASE WHEN $4::boolean AND attempts < max_attempts AND NOT cancel_requested THEN 'QUEUED'
                            WHEN cancel_requested THEN 'CANCELLED' ELSE 'FAILED' END,
              error_code = $3, error_message = $5, worker_id = NULL, lease_expires_at = NULL,
              finished_at = CASE WHEN $4::boolean AND attempts < max_attempts AND NOT cancel_requested THEN NULL ELSE now() END,
              updated_at = now()
        WHERE job_id=$1 AND worker_id=$2 AND status='PROCESSING' RETURNING *`,
      [jobId, workerId, code, retryable, safeMessage]
    );
    const row = r.rows[0] || null;
    if (row && row.status === "QUEUED") await enqueue(jobId);
    return row;
  }

  /** PROCESSING jobs whose worker stopped heart-beating: back to QUEUED, or FAILED once attempts are used up. */
  async function reapExpired() {
    const r = await pool.query(
      `UPDATE analysis_jobs
          SET status = CASE WHEN cancel_requested THEN 'CANCELLED' WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'QUEUED' END,
              error_code = CASE WHEN cancel_requested THEN error_code ELSE 'WORKER_LEASE_EXPIRED' END,
              error_message = CASE WHEN cancel_requested THEN error_message ELSE 'worker stopped responding while processing' END,
              worker_id = NULL, lease_expires_at = NULL,
              finished_at = CASE WHEN cancel_requested OR attempts >= max_attempts THEN now() ELSE NULL END,
              updated_at = now()
        WHERE status='PROCESSING' AND lease_expires_at < now() RETURNING job_id, status`
    );
    let requeued = 0;
    for (const row of r.rows) {
      if (row.status === "QUEUED") {
        await enqueue(row.job_id);
        requeued++;
      }
    }
    return { reaped: r.rowCount, requeued };
  }

  /** QUEUED jobs that nobody picked up (Redis was down, queue flushed): push them again. */
  async function requeueStale(olderThanSec = 30, limit = 100) {
    const r = await pool.query(
      `SELECT job_id FROM analysis_jobs WHERE status='QUEUED' AND updated_at < now() - make_interval(secs => $1::float8)
        ORDER BY created_at LIMIT $2::int`,
      [olderThanSec, limit]
    );
    let pushed = 0;
    for (const row of r.rows) {
      if (await enqueue(row.job_id)) {
        pushed++;
        await pool.query("UPDATE analysis_jobs SET updated_at = now() WHERE job_id=$1 AND status='QUEUED'", [row.job_id]);
      }
    }
    return { stale: r.rowCount, pushed };
  }

  async function counts() {
    const r = await pool.query("SELECT status, count(*)::int AS n FROM analysis_jobs GROUP BY status");
    const out = { QUEUED: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
    for (const row of r.rows) out[row.status] = row.n;
    return out;
  }

  return { createJob, getJob, cancelJob, claim, heartbeat, complete, fail, reapExpired, requeueStale, counts, enqueue, queueKey };
}

module.exports = { createJobStore, toView, QUEUE_KEY, TERMINAL, newJobId };
