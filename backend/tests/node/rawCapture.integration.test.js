"use strict";
/**
 * Raw-output capture on the real HTTP + worker path. The model's raw text carries a unique canary. With capture OFF the canary appears nowhere
 * the owner or a user could look (responses, job results, usage rows, logs, disk). With capture ON (local test process only) it appears in the
 * capture file and still nowhere else. In a deployed-looking environment the service refuses to start.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("capture-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAPER = `doi:${fx.FIXTURE_DOI}`;
const CANARY = "CANARY_7f3a91c2_RAW_MODEL_TEXT";
const base = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "false", JOB_MAINTENANCE_SEC: "1", JOB_HEARTBEAT_SEC: "1", JOB_LEASE_SEC: "30", WORKER_CONCURRENCY: "2" };

function canaryModel() {
  // the unvalidated model output contains the canary in a field the guard would throw away, and in an extra field
  return modelStub({ costUsd: 0.002, costStatus: "ESTIMATED", mutate: (kind, payload) => (kind === "intelligence" ? { ...payload, notes: CANARY, limitations: [{ text: `${CANARY} claim with a number 99.99 not in the paper`, evidence: [payload.tldr.evidence[0]], basis: "STATED" }] } : payload) });
}

async function runAnalysis(R, uid, extraBody = {}, extraHeaders = {}) {
  const pr = (await R.call("POST", "/api/v1/projects/personal", { token: tok(uid), body: {}, headers: ipHeader() })).json;
  const c = await R.call("POST", "/api/v1/analysis", { token: tok(uid), body: { projectId: pr.projectId, paperId: PAPER, ...extraBody }, headers: { ...ipHeader(), "idempotency-key": uniq("k-"), ...extraHeaders } });
  assert.equal(c.status, 202);
  for (let i = 0; i < 150; i++) {
    const p = await R.call("GET", `/api/v1/analysis/${c.json.jobId}`, { token: tok(uid), headers: ipHeader() });
    if (p.json.status === "COMPLETED") return { created: c, done: p };
    if (p.json.status === "FAILED") assert.fail(`job failed: ${JSON.stringify(p.json).slice(0, 300)}`);
    await sleep(100);
  }
  assert.fail("job did not complete");
}

const everywhere = async (R, logs, ...responses) => {
  const rows = await R.runtime.pool.query("SELECT (SELECT coalesce(json_agg(t), '[]'::json) FROM ai_usage t)::text AS u, (SELECT coalesce(json_agg(j), '[]'::json) FROM analysis_jobs j)::text AS j");
  return JSON.stringify(responses) + rows.rows[0].u + rows.rows[0].j + logs.join("\n");
};

test("raw model output capture (real HTTP + worker)", { skip }, async (t) => {
  await resetInfra();

  await t.test("OFF by default, and no request can turn it on: the canary is nowhere, no file is written", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-off-"));
    const logs = [];
    const cap = (...a) => logs.push(a.map(String).join(" "));
    const R = await startReplica({ keys, env: { ...base, NODE_ENV: "test" }, overrides: { client: canaryModel(), logger: { log: cap, info: cap, warn: cap, error: cap, debug: cap } }, worker: true });
    R.start();
    try {
      const uid = uniq("off-");
      const { created, done } = await runAnalysis(R, uid, { captureRaw: true, rawCapture: true, benchmark: true, debug: true }, { "x-capture-raw": "1", "x-benchmark-capture": "1", "x-debug": "1" });
      assert.ok(!(await everywhere(R, logs, created.json, done.json)).includes(CANARY));
      assert.deepEqual(fs.readdirSync(dir), []);
      assert.equal(fs.existsSync(path.join(os.tmpdir(), "BENCHMARK")), false);
    } finally { await R.close(); }
  });

  await t.test("ON in a local test process: the file has the raw text; responses, job rows, usage rows and logs do not", async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cap-on-")), "capture");
    const logs = [];
    const cap = (...a) => logs.push(a.map(String).join(" "));
    const R = await startReplica({ keys, env: { ...base, NODE_ENV: "test", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: dir }, overrides: { client: canaryModel(), logger: { log: cap, info: cap, warn: cap, error: cap, debug: cap } }, worker: true });
    R.start();
    try {
      const uid = uniq("on-");
      const { created, done } = await runAnalysis(R, uid);
      const files = fs.readdirSync(dir);
      assert.equal(files.length, 1);
      const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
      assert.equal(rec.textKept, true);
      assert.ok(rec.rawText.includes(CANARY), "the raw output is in the capture file");
      assert.ok(rec.modelOutput.limitations[0].text.includes("99.99"), "including the statement the guard removed");
      assert.equal(rec.chunks.length > 0, true);
      assert.equal(rec.promptVersion.endsWith("-intel"), true);
      assert.ok(!JSON.stringify(rec).includes(uid), "no user id on disk");
      // the guard still removed the statement for the user: capture does not change what the user receives
      const body = done.json.result;
      assert.ok(body.verification.statementsDropped >= 1);
      assert.ok(!JSON.stringify(body).includes("99.99"));
      const seen = await everywhere(R, logs.filter((l) => !/\[BenchmarkCapture\] ENABLED/.test(l)), created.json, done.json);
      assert.ok(!seen.includes(CANARY), "the canary is in no response, job row, usage row or log line");
      assert.ok(logs.some((l) => /\[BenchmarkCapture\] ENABLED/.test(l)), "starting with capture on is announced once, without content");
    } finally { await R.close(); }
  });

  await t.test("a deployed-looking environment refuses to start with capture requested (production, Railway)", async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cap-prod-")), "capture");
    await assert.rejects(startReplica({ keys, env: { ...base, NODE_ENV: "production", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: dir }, overrides: { client: canaryModel() } }), /refused/);
    await assert.rejects(startReplica({ keys, env: { ...base, NODE_ENV: "test", RAILWAY_ENVIRONMENT: "production", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: dir }, overrides: { client: canaryModel() } }), /refused/);
    assert.equal(fs.existsSync(dir), false, "nothing was created");
  });

  await t.test("a restricted-licence paper under capture: metadata only", async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cap-lic-")), "capture");
    const R = await startReplica({ keys, env: { ...base, NODE_ENV: "test", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: dir }, overrides: { client: canaryModel() }, worker: true });
    R.start();
    try {
      const uid = uniq("lic-");
      await R.call("POST", "/api/v1/papers/resolve", { token: tok(uid), body: { paperId: PAPER }, headers: ipHeader() });
      await R.runtime.pool.query("UPDATE papers SET license='cc-by-nc' WHERE paper_id=$1", [PAPER]);
      await runAnalysis(R, uid);
      const files = fs.readdirSync(dir);
      assert.equal(files.length, 1);
      const raw = fs.readFileSync(path.join(dir, files[0]), "utf8");
      assert.equal(JSON.parse(raw).textKept, false);
      assert.ok(!raw.includes(CANARY));
    } finally { await R.close(); }
  });
});
