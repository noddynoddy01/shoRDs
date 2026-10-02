"use strict";
/**
 * Persistent analysis jobs: PostgreSQL state + Redis queue + worker, across replicas. Real PostgreSQL, real Redis,
 * real HTTP, several runtimes in one process standing in for several Railway replicas.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY, INFRA } = require("./helpers");
const { createJobStore } = require("../../jobs/jobStore");
const { PgPool } = require("../../data/pgClient");
const { RedisClient } = require("../../data/redisClient");

const skip = infraSkip();
const keys = makeKeyPair("jobs-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHUNKS = (p = "paper-1") => [{ chunkId: "c1", paperId: p, section: "Results", page: 3, text: "Treatment reduced systolic pressure by 8.1 mmHg versus 2.3 mmHg in control (n=120)." }];

/** A model stub whose calls can be held open, so tests can observe PROCESSING and race cancellation. */
function gatedClient() {
  const c = { calls: 0, started: 0, gate: null, release: null, hold: false };
  c.arm = () => { c.hold = true; c.gate = new Promise((r) => { c.release = () => { c.hold = false; r(); }; }); };
  c.callMessages = async (o) => {
    c.calls++; c.started++;
    if (c.hold) await c.gate;
    return { text: `Finding [c1] (call ${c.calls})`, usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 }, stopReason: "end_turn", truncated: false, model: o.model, latencyMs: 2, attempts: 1, requestId: "r", costUsd: 0.0005, costStatus: "ESTIMATED" };
  };
  return c;
}

async function until(fn, { timeoutMs = 8000, everyMs = 40, what = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

const workerEnv = { JOB_MAINTENANCE_SEC: "1", JOB_HEARTBEAT_SEC: "1", JOB_LEASE_SEC: "30", WORKER_CONCURRENCY: "2", AI_CACHE_ENABLED: "false" };

test("analysis jobs (PostgreSQL + Redis + worker, multiple replicas)", { skip }, async (t) => {
  await resetInfra();
  const owner = uniq("owner-");
  const ip = () => ({ headers: ipHeader() });

  async function setup(R) {
    const p = (await R.call("POST", "/api/v1/projects", { token: tok(owner), body: { name: "J" }, ...ip() })).json;
    return p.projectId;
  }
  const create = (R, projectId, extra = {}, headers = {}) =>
    R.call("POST", "/api/v1/analysis", { token: tok(owner), body: { projectId, paperId: "paper-1", evidenceChunks: CHUNKS(), ...extra }, headers: { ...ipHeader(), ...headers } });
  const poll = (R, id) => R.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), ...ip() });

  await t.test("lifecycle across replicas: created on A, polled on B and C, processed by B's worker, completed result seen on A", async () => {
    const model = gatedClient();
    const A = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { client: model }, worker: false });
    const B = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { client: model }, worker: true });
    const C = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { client: model }, worker: false });
    const projectId = await setup(A);

    model.arm();
    const created = await create(A, projectId);
    assert.equal(created.status, 202);
    assert.equal(created.json.status, "QUEUED");
    assert.equal(created.json.createdByReplica, A.replicaId);
    assert.equal(created.json.queue.enqueued, true);
    const id = created.json.jobId;

    // visible on every other replica immediately: no 404 just because it was created elsewhere
    for (const R of [B, C]) {
      const r = await poll(R, id);
      assert.equal(r.status, 200, `poll on ${R.replicaId}`);
      assert.equal(r.json.jobId, id);
      assert.equal(r.json.servedByReplica, R.replicaId);
      assert.ok(["QUEUED", "PROCESSING"].includes(r.json.status));
    }

    B.start(); // migrations already applied; starts B's worker
    await until(async () => (await poll(C, id)).json.status === "PROCESSING", { what: "PROCESSING" });
    const processing = (await poll(A, id)).json;
    assert.equal(processing.status, "PROCESSING");
    assert.equal(processing.processedByReplica, B.replicaId);
    assert.equal(processing.attempts, 1);
    assert.ok(processing.startedAt);
    assert.equal(processing.result, null);

    model.release();
    const done = (await until(async () => { const r = await poll(A, id); return r.json.status === "COMPLETED" ? r : null; }, { what: "COMPLETED" })).json;
    assert.equal(done.createdByReplica, A.replicaId);
    assert.equal(done.processedByReplica, B.replicaId);
    assert.equal(done.servedByReplica, A.replicaId);
    assert.equal(done.progress, 100);
    assert.equal(done.error, null);
    assert.ok(new Date(done.createdAt) <= new Date(done.startedAt) && new Date(done.startedAt) <= new Date(done.finishedAt), "timestamps are ordered");
    assert.equal(done.result.modelMode, "EXTERNAL_CLAUDE");
    assert.equal(done.result.verificationStatus, "UNVERIFIED", "model output is not claimed verified");
    assert.ok(!JSON.stringify(done).includes('"VERIFIED"'), "no fake VERIFIED anywhere in the job");
    assert.equal(model.calls, 1);
    await Promise.all([A.close(), B.close(), C.close()]);
  });

  await t.test("no API key: the job still completes, honestly labelled FALLBACK (local, extractive, not verified)", async () => {
    const A = await startReplica({ keys, env: { ...workerEnv }, worker: true });
    A.start();
    const projectId = await setup(A);
    const id = (await create(A, projectId)).json.jobId;
    const done = (await until(async () => { const r = await poll(A, id); return r.json.status === "COMPLETED" ? r : null; })).json;
    assert.equal(done.result.verificationStatus, "FALLBACK");
    assert.equal(done.result.provider, "local_deterministic");
    assert.equal(done.result.fallbackReason, "ANTHROPIC_API_KEY_NOT_CONFIGURED");
    assert.equal(done.result.tokens.totalTokens, null, "no tokens are invented");
    await A.close();
  });

  await t.test("a deterministic failure becomes FAILED with a categorised error and is not retried", async () => {
    const A = await startReplica({ keys, env: { ...workerEnv }, worker: true });
    const projectId = await setup(A);
    // a corrupt job row: its stored request has no evidence
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    const jobId = `job_${"a".repeat(24)}`;
    await pool.query("INSERT INTO analysis_jobs (job_id, project_id, tenant_id, user_id, paper_id, request, status, created_by_replica) SELECT $1, project_id, tenant_id, $2, 'paper-x', $3::jsonb, 'QUEUED', 'test' FROM projects WHERE project_id = $4", [jobId, owner, { query: "q", paperId: "paper-x", chunks: [] }, projectId]);
    await A.runtime.jobStore.enqueue(jobId);
    A.start();
    const failed = (await until(async () => { const r = await poll(A, jobId); return r.json.status === "FAILED" ? r : null; })).json;
    assert.equal(failed.error.code, "NO_PAPER_CONTENT");
    assert.equal(failed.attempts, 1, "non-retryable: exactly one attempt");
    assert.equal(failed.result, null);
    assert.ok(failed.finishedAt);
    await pool.end(); await A.close();
  });

  await t.test("a transient failure is retried up to max_attempts, then FAILED (never stuck, never silently dropped)", async () => {
    const A = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "true" }, overrides: { client: gatedClient() }, worker: true });
    const projectId = await setup(A);
    let tries = 0;
    A.runtime.cache.getOrCompute = async () => { tries++; throw new Error("transient infrastructure error"); };
    A.start();
    const id = (await create(A, projectId)).json.jobId;
    const failed = (await until(async () => { const r = await poll(A, id); return r.json.status === "FAILED" ? r : null; }, { timeoutMs: 12000 })).json;
    assert.equal(failed.attempts, 3);
    assert.equal(tries, 3);
    assert.equal(failed.error.code, "PROCESSING_ERROR");
    await A.close();
  });

  await t.test("cancel while QUEUED: CANCELLED immediately and never processed", async () => {
    const model = gatedClient();
    const A = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { client: model }, worker: true });
    const projectId = await setup(A);
    const id = (await create(A, projectId)).json.jobId; // worker not started yet
    const cancelled = await A.call("POST", `/api/v1/analysis/${id}/cancel`, { token: tok(owner), ...ip() });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.outcome, "CANCELLED");
    assert.equal(cancelled.json.status, "CANCELLED");
    A.start();
    await sleep(1500);
    const after = (await poll(A, id)).json;
    assert.equal(after.status, "CANCELLED");
    assert.equal(model.calls, 0, "a cancelled job never reaches the model");
    assert.equal((await A.call("POST", `/api/v1/analysis/${id}/cancel`, { token: tok(owner), ...ip() })).json.outcome, "ALREADY_TERMINAL");
    await A.close();
  });

  await t.test("cancel while PROCESSING: acknowledged, and the result is discarded when the worker finishes", async () => {
    const model = gatedClient();
    const A = await startReplica({ keys, env: { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, overrides: { client: model }, worker: true });
    const projectId = await setup(A);
    A.start();
    model.arm();
    const id = (await create(A, projectId)).json.jobId;
    await until(async () => (await poll(A, id)).json.status === "PROCESSING");
    const c = await A.call("POST", `/api/v1/analysis/${id}/cancel`, { token: tok(owner), ...ip() });
    assert.equal(c.json.outcome, "CANCEL_REQUESTED");
    model.release();
    const final = (await until(async () => { const r = await poll(A, id); return r.json.status === "CANCELLED" ? r : null; })).json;
    assert.equal(final.result, null, "a cancelled job stores no result");
    await A.close();
  });

  await t.test("idempotency: the same Idempotency-Key returns the original job; keys are per user", async () => {
    const A = await startReplica({ keys });
    const projectId = await setup(A);
    const k = uniq("idem-");
    const first = await create(A, projectId, {}, { "idempotency-key": k });
    const again = await create(A, projectId, {}, { "idempotency-key": k });
    assert.equal(first.status, 202);
    assert.equal(again.status, 200);
    assert.equal(again.headers["idempotent-replay"], "true");
    assert.equal(again.json.jobId, first.json.jobId);
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM analysis_jobs WHERE idempotency_key = $1", [k])).rows[0].n, 1);
    // another user with the same key gets their own job (needs their own project)
    const other = uniq("other-");
    const op = (await A.call("POST", "/api/v1/projects", { token: tok(other), body: { name: "O" }, ...ip() })).json;
    const theirs = await A.call("POST", "/api/v1/analysis", { token: tok(other), body: { projectId: op.projectId, paperId: "paper-1", evidenceChunks: CHUNKS() }, headers: { ...ipHeader(), "idempotency-key": k } });
    assert.equal(theirs.status, 202);
    assert.notEqual(theirs.json.jobId, first.json.jobId);
    await pool.end(); await A.close();
  });

  await t.test("claiming is atomic: 30 workers racing for one job, exactly one wins", async () => {
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 8 });
    const redis = new RedisClient({ url: INFRA.redisUrl });
    const store = createJobStore({ pool, redis, logger: { warn() {}, error() {}, log() {} } });
    const A = await startReplica({ keys });
    const projectId = await setup(A);
    const m = (await pool.query("SELECT tenant_id FROM projects WHERE project_id=$1", [projectId])).rows[0];
    const { job } = await store.createJob({ projectId, tenantId: m.tenant_id, userId: owner, paperId: "p", request: { query: "q", paperId: "p", chunks: CHUNKS("p") }, replicaId: "race" });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => store.claim(job.jobId, `w${i}`, "race", 30)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await store.getJob(job.jobId)).attempts, 1);
    await pool.end(); await redis.close(); await A.close();
  });

  await t.test("a worker that dies mid-job: the lease expires, the job returns to QUEUED and another worker completes it (attempts=2)", async () => {
    const A = await startReplica({ keys, env: { ...workerEnv }, worker: true });
    const projectId = await setup(A);
    const id = (await create(A, projectId)).json.jobId; // queued, worker not started
    // a "crashed" worker claims it with a 1 s lease and never reports back
    const claimed = await A.runtime.jobStore.claim(id, "crashed-worker", "ghost-replica", 1);
    assert.equal(claimed.status, "PROCESSING");
    assert.equal((await poll(A, id)).json.status, "PROCESSING");
    await sleep(1300);
    A.start(); // its maintenance loop reaps expired leases; its workers then process the re-queued job
    const done = (await until(async () => { const r = await poll(A, id); return r.json.status === "COMPLETED" ? r : null; }, { timeoutMs: 10000 })).json;
    assert.equal(done.attempts, 2);
    assert.equal(done.processedByReplica, A.replicaId, "the surviving replica took over, not the dead one");
    await A.close();
  });

  await t.test("a worker that dies on its LAST attempt leaves the job FAILED (WORKER_LEASE_EXPIRED), not PROCESSING forever", async () => {
    const A = await startReplica({ keys });
    const projectId = await setup(A);
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    const id = (await create(A, projectId)).json.jobId;
    await pool.query("UPDATE analysis_jobs SET max_attempts = 1 WHERE job_id = $1", [id]);
    await A.runtime.jobStore.claim(id, "crashed", "ghost", 0.2);
    await sleep(500);
    const r = await A.runtime.jobStore.reapExpired();
    assert.equal(r.reaped, 1);
    const view = (await poll(A, id)).json;
    assert.equal(view.status, "FAILED");
    assert.equal(view.error.code, "WORKER_LEASE_EXPIRED");
    await pool.end(); await A.close();
  });

  await t.test("queue loss is recoverable: the job is durable in PostgreSQL even if Redis dropped (or never got) the queue entry", async () => {
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 2 });
    const live = new RedisClient({ url: INFRA.redisUrl });
    const dead = new RedisClient({ url: "redis://127.0.0.1:1" });
    const quiet = { warn() {}, error() {}, log() {} };
    const A = await startReplica({ keys, env: { ...workerEnv }, worker: false });
    const projectId = await setup(A);
    const tenant = (await pool.query("SELECT tenant_id FROM projects WHERE project_id=$1", [projectId])).rows[0].tenant_id;
    const deadStore = createJobStore({ pool, redis: dead, logger: quiet });
    const { job, enqueued } = await deadStore.createJob({ projectId, tenantId: tenant, userId: owner, paperId: "paper-1", request: { query: "q", paperId: "paper-1", chunks: CHUNKS() }, replicaId: "x" });
    assert.equal(enqueued, false, "Redis was down at enqueue time");
    assert.equal(job.status, "QUEUED", "...but the job exists and is durable");
    await live.command("DEL", A.runtime.jobStore.queueKey);
    await pool.query("UPDATE analysis_jobs SET updated_at = now() - interval '5 minutes' WHERE job_id = $1", [job.jobId]);
    const W = await startReplica({ keys, env: { ...workerEnv }, worker: true });
    W.start(); // maintenance re-queues stale QUEUED jobs; the worker then completes it
    const done = (await until(async () => { const r = await W.call("GET", `/api/v1/analysis/${job.jobId}`, { token: tok(owner), ...ip() }); return r.json.status === "COMPLETED" ? r : null; }, { timeoutMs: 10000 })).json;
    assert.equal(done.attempts, 1);
    await pool.end(); await live.close(); await dead.close(); await A.close(); await W.close();
  });

  await t.test("survives a full restart: jobs created before it are polled and processed after it", async () => {
    const A1 = await startReplica({ keys, env: { ...workerEnv }, worker: false });
    const projectId = await setup(A1);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await create(A1, projectId)).json.jobId);
    await A1.close(); // the whole "service" goes away
    const A2 = await startReplica({ keys, env: { ...workerEnv }, worker: true });
    for (const id of ids) assert.equal((await poll(A2, id)).status, 200, "still there after restart");
    A2.start();
    for (const id of ids) await until(async () => (await poll(A2, id)).json.status === "COMPLETED", { timeoutMs: 10000 });
    await A2.close();
  });

  await t.test("two workers on two replicas drain 12 jobs: each job is processed exactly once", async () => {
    const model = gatedClient();
    const env = { ...workerEnv, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY };
    const A = await startReplica({ keys, env, overrides: { client: model }, worker: true });
    const B = await startReplica({ keys, env, overrides: { client: model }, worker: true });
    const projectId = await setup(A);
    const N = 12;
    const ids = [];
    for (let i = 0; i < N; i++) ids.push((await create(i % 2 ? A : B, projectId, { paperId: `paper-${i}`, evidenceChunks: CHUNKS(`paper-${i}`) })).json.jobId);
    A.start(); B.start();
    let flip = 0;
    for (const id of ids) await until(async () => (await poll(flip++ % 2 ? A : B, id)).json.status === "COMPLETED", { timeoutMs: 15000 }); // alternate the polled replica
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    const rows = (await pool.query("SELECT attempts, processed_by_replica FROM analysis_jobs WHERE project_id = $1", [projectId])).rows;
    assert.equal(rows.length, N);
    assert.ok(rows.every((r) => r.attempts === 1), "no job ran twice");
    assert.equal(model.calls, N, "exactly one model call per job");
    assert.ok(rows.every((r) => [A.replicaId, B.replicaId].includes(r.processed_by_replica)));
    await pool.end(); await A.close(); await B.close();
  });

  await t.test("the in-memory job store is gone from the production path", () => {
    const root = path.resolve(__dirname, "../..");
    for (const f of ["start_local_server.js", "app.js", "runtime.js"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      assert.ok(!/jobStore\s*=\s*new Map/.test(src), `${f}: no Map-backed job store`);
      assert.ok(!/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*status\s*=\s*"(PROCESSING|COMPLETED)"/.test(src), `${f}: no timer-simulated job progress`);
      assert.ok(!/status:\s*"VERIFIED"/.test(src), `${f}: no templated VERIFIED result`);
    }
  });
});
