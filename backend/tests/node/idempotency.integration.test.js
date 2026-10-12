"use strict";
/**
 * P0.5: an Idempotency-Key is bound to the request it was first used for (project, paper, depth).
 *  - the same request repeated: replay of the original job (200, Idempotent-Replay), nothing new created
 *  - the key reused for a different project / paper / depth: 422 IDEMPOTENCY_KEY_REUSED, nothing created or enqueued,
 *    the original job is not described in the error
 *  - parallel requests with one key: exactly one job exists; identical ones all see it, differing ones are refused
 *  - keys are per user: another user may use the same key string for anything
 * Local PostgreSQL + Redis only; the model is never reached (jobs are only queued).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("idem-key");
const tok = (uid) => tokenFor(keys, uid);
const PAPER_A = `doi:${fx.FIXTURE_DOI}`;
const PAPER_B = "doi:10.9999/idempotency.other.2019";

test("idempotency keys are bound to the original request", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, worker: false });
  const alice = uniq("alice-");
  const bob = uniq("bob-");
  const call = (user, method, path, body, headers = {}) => R.call(method, path, { token: tok(user), body, headers: { ...ipHeader(), ...headers } });
  const mk = async (user, name) => (await call(user, "POST", "/api/v1/projects", { name })).json.projectId;
  const p1 = await mk(alice, "P1");
  const p2 = await mk(alice, "P2");
  const jobCount = async (user) => (await R.runtime.pool.query("SELECT count(*)::int AS n FROM analysis_jobs WHERE user_id = $1", [user])).rows[0].n;
  const key = () => uniq("k-");

  await t.test("the same request repeated is a replay of the original job", async () => {
    const k = key();
    const first = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" }, { "idempotency-key": k });
    assert.equal(first.status, 202);
    for (const body of [
      { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" },
      { projectId: p1, paperId: PAPER_A, analysisDepth: "quick" },                     // case is not a different request
      { analysisDepth: "QUICK", paperId: PAPER_A, projectId: p1 },                      // key order is not a different request
      { projectId: p1, paperId: PAPER_A.replace(/^doi:/, ""), analysisDepth: "QUICK" }  // the bare DOI is the same paper as doi:...
    ]) {
      const again = await call(alice, "POST", "/api/v1/analysis", body, { "idempotency-key": k });
      assert.equal(again.status, 200, JSON.stringify(body));
      assert.equal(again.json.jobId, first.json.jobId);
      assert.equal(again.headers["idempotent-replay"], "true");
    }
    assert.equal(await jobCount(alice), 1, "only the first request created a job");
  });

  await t.test("a request with no depth repeated with no depth is a replay; adding a depth is a different request", async () => {
    const k = key();
    const first = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A }, { "idempotency-key": k });
    assert.equal(first.status, 202);
    const same = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A }, { "idempotency-key": k });
    assert.equal([same.status, same.json.jobId].join(), [200, first.json.jobId].join());
    const withDepth = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "DEEP" }, { "idempotency-key": k });
    assert.equal(withDepth.status, 422);
  });

  await t.test("the key reused for a different depth, paper or project is refused (422), creates nothing, discloses nothing", async () => {
    const k = key();
    const first = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" }, { "idempotency-key": k });
    assert.equal(first.status, 202);
    const before = await jobCount(alice);
    const queued = Number(await R.runtime.redis.command("LLEN", "shords:queue:analysis"));
    assert.ok(queued >= 1, "the queue key is the real one (the first job is queued)");
    for (const [what, body] of [
      ["depth", { projectId: p1, paperId: PAPER_A, analysisDepth: "DEEP" }],
      ["paper", { projectId: p1, paperId: PAPER_B, analysisDepth: "QUICK" }],
      ["project", { projectId: p2, paperId: PAPER_A, analysisDepth: "QUICK" }]
    ]) {
      const r = await call(alice, "POST", "/api/v1/analysis", body, { "idempotency-key": k });
      assert.equal(r.status, 422, what);
      assert.equal(r.json.error, "IDEMPOTENCY_KEY_REUSED", what);
      assert.equal(r.headers["idempotent-replay"], undefined, what);
      const text = JSON.stringify(r.json);
      assert.ok(!text.includes(first.json.jobId) && !text.includes(PAPER_A) && !text.includes(p1), `${what}: the original job is not described`);
    }
    assert.equal(await jobCount(alice), before, "no job was created");
    assert.equal(Number(await R.runtime.redis.command("LLEN", "shords:queue:analysis")), queued, "nothing was enqueued");
    const again = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" }, { "idempotency-key": k });
    assert.equal([again.status, again.json.jobId].join(), [200, first.json.jobId].join(), "the original request still replays");
  });

  await t.test("the refusal does not depend on the original job's state (finished jobs bind the key too)", async () => {
    const k = key();
    const first = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "STANDARD" }, { "idempotency-key": k });
    await R.runtime.pool.query("UPDATE analysis_jobs SET status='COMPLETED', finished_at=now() WHERE job_id=$1", [first.json.jobId]);
    assert.equal((await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "DEEP" }, { "idempotency-key": k })).status, 422);
    assert.equal((await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "STANDARD" }, { "idempotency-key": k })).status, 200);
  });

  await t.test("jobs created before this check (no new column: compared against the stored row) are bound too", async () => {
    const k = key();
    const first = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" }, { "idempotency-key": k });
    // simulate an old row: its request JSON has the original shape
    await R.runtime.pool.query("UPDATE analysis_jobs SET request = $2::jsonb WHERE job_id = $1", [first.json.jobId, JSON.stringify({ paperId: PAPER_A, depth: "QUICK" })]);
    assert.equal((await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A, analysisDepth: "DEEP" }, { "idempotency-key": k })).status, 422);
  });

  await t.test("parallel requests with one key: one job; identical ones replay it, a differing one is refused", async () => {
    const k = key();
    const same = { projectId: p1, paperId: PAPER_A, analysisDepth: "QUICK" };
    const diff = { projectId: p1, paperId: PAPER_A, analysisDepth: "DEEP" };
    const before = await jobCount(alice);
    const rs = await Promise.all([same, same, same, diff, diff, same].map((b) => call(alice, "POST", "/api/v1/analysis", b, { "idempotency-key": k })));
    assert.equal(await jobCount(alice), before + 1, "exactly one job exists for the key");
    const created = rs.filter((r) => r.status === 202);
    assert.equal(created.length, 1, rs.map((r) => r.status).join());
    assert.ok(rs.every((r) => [200, 202, 422].includes(r.status)), rs.map((r) => r.status).join());
    // whichever request won, everyone with the winning body got that job and everyone with the other body was refused
    const winnerBody = created[0] === rs[3] || created[0] === rs[4] ? "diff" : "same";
    rs.forEach((r, i) => {
      const body = i === 3 || i === 4 ? "diff" : "same";
      if (body === winnerBody) assert.ok(r.status === 202 || (r.status === 200 && r.json.jobId === created[0].json.jobId), `request ${i}`);
      else assert.equal(r.status, 422, `request ${i}`);
    });
  });

  await t.test("keys are per user: another user may use the same key string for a different request", async () => {
    const k = key();
    const a = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A }, { "idempotency-key": k });
    const bp = await mk(bob, "Bob's");
    const b = await call(bob, "POST", "/api/v1/analysis", { projectId: bp, paperId: PAPER_B, analysisDepth: "DEEP" }, { "idempotency-key": k });
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.notEqual(a.json.jobId, b.json.jobId);
  });

  await t.test("requests without a key are never bound to each other", async () => {
    const x = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_A });
    const y = await call(alice, "POST", "/api/v1/analysis", { projectId: p1, paperId: PAPER_B, analysisDepth: "DEEP" });
    assert.deepEqual([x.status, y.status], [202, 202]);
  });

  await R.close();
});
