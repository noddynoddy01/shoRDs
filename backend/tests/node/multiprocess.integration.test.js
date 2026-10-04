"use strict";
/**
 * Separate OS processes standing in for Railway replicas: the production runtime in each, sharing only PostgreSQL and Redis.
 * Includes a hard crash (SIGKILL) of a worker process mid-job.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const net = require("net");
const { makeKeyPair, tokenFor, uniq, call, infraSkip, resetInfra, INFRA, TEST_PROJECT_ID, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("mp-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = require("./paperFixtures");
const PAPER = `doi:${fx.FIXTURE_DOI}`;

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function spawnReplica(id, { worker, delayMs = 0, leaseSec = 30 }) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, "replica_process.js")], {
    env: {
      PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), RAILWAY_REPLICA_ID: id,
      DATABASE_URL: INFRA.databaseUrl, REDIS_URL: INFRA.redisUrl, FIREBASE_PROJECT_ID: TEST_PROJECT_ID, TEST_JWK: JSON.stringify(keys.jwk),
      CORS_ORIGINS: "https://shords.test", TRUST_PROXY: "true", WORKER_ENABLED: worker ? "true" : "false", JOB_BLOCK_SEC: "1", JOB_MAINTENANCE_SEC: "1",
      JOB_HEARTBEAT_SEC: "1", JOB_LEASE_SEC: String(leaseSec), AI_CACHE_ENABLED: "false", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, TEST_MODEL_DELAY_MS: String(delayMs),
      RATE_LIMIT_GLOBAL_IP: "1000000/60", RATE_LIMIT_READ_USER: "1000000/60", RATE_LIMIT_WRITE_USER: "1000000/60", RATE_LIMIT_ANALYSIS_USER: "1000000/60", RATE_LIMIT_ANALYSIS_TENANT: "1000000/60"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`replica ${id} did not start: ${stderr}`)), 8000);
    child.stdout.on("data", (d) => { if (String(d).includes("LISTENING")) { clearTimeout(t); resolve(); } });
    child.on("exit", (c) => reject(new Error(`replica ${id} exited early (${c}): ${stderr}`)));
  });
  return { id, pid: child.pid, base: `http://127.0.0.1:${port}`, child, call: (m, p, o) => call(`http://127.0.0.1:${port}`, m, p, o), kill: (sig = "SIGTERM") => child.kill(sig) };
}

async function until(fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await sleep(100); }
}

test("multi-process replicas sharing PostgreSQL + Redis", { skip }, async (t) => {
  await resetInfra();
  const owner = uniq("owner-");
  const procs = [];
  t.after(() => procs.forEach((p) => { try { p.kill("SIGKILL"); } catch (_) {} }));
  const ipH = () => ({ "x-forwarded-for": `6.6.6.6, 198.51.100.${Math.floor(Math.random() * 250)}.${Date.now() % 100000}` });

  await t.test("a job created by process A is polled through process B and completed by process C's worker", async () => {
    const A = await spawnReplica("proc-A", { worker: false });
    const B = await spawnReplica("proc-B", { worker: false });
    procs.push(A, B);
    assert.notEqual(A.pid, B.pid);
    const project = (await A.call("POST", "/api/v1/projects", { token: tok(owner), body: { name: "MP" }, headers: ipH() })).json;
    const created = await A.call("POST", "/api/v1/analysis", { token: tok(owner), body: { projectId: project.projectId, paperId: PAPER }, headers: ipH() });
    assert.equal(created.status, 202);
    assert.equal(created.headers["x-replica-id"], "proc-A");
    const id = created.json.jobId;
    const viaB = await B.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), headers: ipH() });
    assert.equal(viaB.status, 200, "no 404 just because the job was created in another process");
    assert.equal(viaB.json.servedByReplica, "proc-B");
    assert.equal(viaB.json.createdByReplica, "proc-A");
    assert.equal(viaB.json.status, "QUEUED", "nobody has a worker yet");

    const C = await spawnReplica("proc-C", { worker: true });
    procs.push(C);
    const done = await until(async () => { const r = await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), headers: ipH() }); return r.json.status === "COMPLETED" ? r.json : null; });
    assert.equal(done.createdByReplica, "proc-A");
    assert.equal(done.processedByReplica, "proc-C");
    assert.equal(done.result.modelMode, "EXTERNAL_CLAUDE");
    assert.equal(done.result.verificationStatus, "UNVERIFIED");
    assert.equal(done.result.providerRequestId, `stub-pid-${C.pid}`, "the model call was made by process C, not by A or B");
    assert.equal(done.result.paper.paperId, PAPER);
    assert.equal(done.result.contentCoverage, "FULL_TEXT");
    assert.equal(done.result.queryType, "STRUCTURED_INTELLIGENCE");
    assert.ok(done.result.intelligence.tldr.evidence[0].startsWith(`${PAPER}_chunk_`), "evidence came from the shared paper store");
    // process A (which never ran a worker) can serve the stored paper and the usage ledger written by process C
    const viaA = await A.call("POST", "/api/v1/papers/resolve", { token: tok(owner), body: { paperId: PAPER }, headers: ipH() });
    assert.equal(viaA.json.coverage, "FULL_TEXT");
    assert.equal(viaA.json.servedFrom, "STORE", "a paper retrieved by one process is served from the shared store by another");
    const { PgPool } = require("../../data/pgClient");
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    const ledger = (await pool.query("SELECT replica_id, ai_called, input_tokens, cost_status, paper_id FROM ai_usage WHERE job_id = $1", [id])).rows;
    await pool.end();
    assert.equal(ledger.length, 1, "exactly one usage row for the job");
    assert.deepEqual({ replica: ledger[0].replica_id, ai: ledger[0].ai_called, tokens: ledger[0].input_tokens, paper: ledger[0].paper_id }, { replica: "proc-C", ai: true, tokens: 1200, paper: PAPER });
    A.kill(); B.kill(); C.kill();
  });

  await t.test("SIGKILL of the worker process mid-job: the lease expires and a surviving process finishes the job (attempts=2)", async () => {
    const A = await spawnReplica("crash-A", { worker: false });
    const W1 = await spawnReplica("crash-W1", { worker: true, delayMs: 6000, leaseSec: 2 });
    procs.push(A, W1);
    const project = (await A.call("POST", "/api/v1/projects", { token: tok(owner), body: { name: "Crash" }, headers: ipH() })).json;
    const id = (await A.call("POST", "/api/v1/analysis", { token: tok(owner), body: { projectId: project.projectId, paperId: PAPER }, headers: ipH() })).json.jobId;
    const processing = await until(async () => { const r = await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), headers: ipH() }); return r.json.status === "PROCESSING" ? r.json : null; });
    assert.equal(processing.processedByReplica, "crash-W1");
    W1.kill("SIGKILL"); // hard crash: no graceful shutdown, no failure report
    await sleep(300);
    const stuck = (await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), headers: ipH() })).json;
    assert.equal(stuck.status, "PROCESSING", "right after the crash the row still says PROCESSING (the lease has not expired yet)");
    const W2 = await spawnReplica("crash-W2", { worker: true, delayMs: 0, leaseSec: 30 });
    procs.push(W2);
    const done = await until(async () => { const r = await A.call("GET", `/api/v1/analysis/${id}`, { token: tok(owner), headers: ipH() }); return r.json.status === "COMPLETED" ? r.json : null; }, 20000);
    assert.equal(done.attempts, 2);
    assert.equal(done.processedByReplica, "crash-W2");
    A.kill(); W2.kill();
  });

  await t.test("the real production entrypoint (node backend/start_local_server.js) starts, answers /health, reports honest /ready, rejects unauthenticated calls and exits cleanly on SIGTERM", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [path.resolve(__dirname, "../../start_local_server.js")], {
      env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), HOST: "127.0.0.1", DATABASE_URL: INFRA.databaseUrl, REDIS_URL: INFRA.redisUrl, CORS_ORIGINS: "https://shords.test", RAILWAY_REPLICA_ID: "entrypoint-1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    await until(async () => out.includes("listening"), 8000);
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await call(base, "GET", "/health")).status, 200);
    const ready = await call(base, "GET", "/ready");
    assert.equal(ready.status, 503, "no FIREBASE_PROJECT_ID: not ready");
    assert.equal(ready.json.checks.auth.status, "NOT_CONFIGURED");
    assert.equal(ready.json.checks.database.status, "OK");
    assert.equal(ready.json.checks.redis.status, "OK");
    assert.equal(ready.json.checks.aiProvider.status, "NOT_CONFIGURED");
    assert.equal((await call(base, "POST", "/api/v1/copilot/query", { body: { query: "q", paperId: "p" }, headers: { authorization: "something" } })).status, 401);
    assert.equal((await call(base, "GET", "/", { headers: { origin: "https://evil.example" } })).status, 403);
    const exited = new Promise((resolve) => child.on("exit", (code, sig) => resolve({ code, sig })));
    child.kill("SIGTERM");
    const r = await Promise.race([exited, sleep(8000).then(() => "timeout")]);
    assert.notEqual(r, "timeout", "exits on SIGTERM");
    assert.equal(r.code, 0, "graceful shutdown exit code");
    assert.ok(!out.includes("pgtest-password") && !out.includes(new URL(INFRA.databaseUrl).password), "logs do not contain credentials");
  });
});
