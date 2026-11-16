"use strict";
/**
 * Licence gate and confidence removal on the real HTTP paths (Copilot and analysis job), including answers served from the shared cache
 * after the paper's recorded licence changed. Real PostgreSQL + Redis; provider payloads and the model are fictional stubs.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("gate-key");
const tok = (uid) => tokenFor(keys, uid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAPER = `doi:${fx.FIXTURE_DOI}`;
const env = { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "true", JOB_MAINTENANCE_SEC: "1", JOB_HEARTBEAT_SEC: "1", JOB_LEASE_SEC: "30", WORKER_CONCURRENCY: "2" };
const HEADLINE = "87.4 percent";

test("licence gate on analysis and Copilot responses (real HTTP, cache, worker)", { skip }, async (t) => {
  await resetInfra();
  const model = modelStub({ costUsd: 0.002, costStatus: "ESTIMATED" });
  const R = await startReplica({ keys, env, overrides: { client: model }, worker: true });
  R.start(); // starts this replica's analysis worker
  t.after(() => R.close());
  const uid = uniq("gate-");
  const projectId = (await R.call("POST", "/api/v1/projects", { token: tok(uid), body: { name: "Gate" }, headers: ipHeader() })).json.projectId;
  const setLicense = (lic) => R.runtime.pool.query("UPDATE papers SET license=$1 WHERE paper_id=$2", [lic, PAPER]);
  const ask = (query = "What was the headline accuracy?") => R.call("POST", "/api/v1/copilot/query", { token: tok(uid), body: { projectId, query, paperId: PAPER }, headers: ipHeader() });
  const analyse = async (key) => {
    const c = await R.call("POST", "/api/v1/analysis", { token: tok(uid), body: { projectId, paperId: PAPER }, headers: { ...ipHeader(), "idempotency-key": key } });
    assert.equal(c.status, 202); let last = null;
    for (let i = 0; i < 150; i++) {
      const p = await R.call("GET", `/api/v1/analysis/${c.json.jobId}`, { token: tok(uid), headers: ipHeader() }); last = p.json;
      if (p.json.status === "COMPLETED") return p.json;
      if (p.json.status === "FAILED") assert.fail(`job failed: ${JSON.stringify(p.json).slice(0, 300)}`);
      await sleep(100);
    }
    assert.fail("job did not complete: " + JSON.stringify(last).slice(0, 400));
  };
  // make sure the paper is stored and its text contains the headline number
  await R.call("POST", "/api/v1/papers/resolve", { token: tok(uid), body: { paperId: PAPER }, headers: ipHeader() });

  await t.test("cc-by: excerpt text is included, the confidence score is not", async () => {
    await setLicense("cc-by");
    const r = await ask();
    assert.equal(r.status, 200);
    assert.equal(r.json.textPolicy.evidenceText, "INCLUDED");
    assert.ok(r.json.evidence.length > 0 && r.json.evidence.every((e) => typeof e.text === "string" && e.text.length > 0));
    const a = (await analyse("gate-key-1")).result;
    assert.equal(a.textPolicy.evidenceText, "INCLUDED");
    assert.ok(a.evidence.some((e) => typeof e.text === "string"));
    assert.equal("score" in a.confidence, false);
    assert.equal("factors" in a.confidence, false);
    assert.ok(!/"score"/.test(JSON.stringify(a)), "no field named score anywhere in an analysis response");
  });

  await t.test("the licence changes after answers were cached: the cached answers are served WITHOUT paper text, and no new model call is made", async () => {
    const calls = model.calls.length;
    await setLicense("cc-by-nc");
    const r = await ask(); // same request as before: a cache hit
    assert.equal(r.status, 200);
    assert.equal(r.json.cache.status, "HIT", "setup: this really is the cached answer");
    assert.equal(r.json.textPolicy.evidenceText, "WITHHELD_BY_LICENSE");
    assert.ok(r.json.evidence.length > 0, "the citations stay");
    assert.ok(r.json.evidence.every((e) => e.text === undefined && e.textAvailable === false));
    const a = (await analyse("gate-key-2")).result; // same content: served from the cache
    assert.equal(a.cache.status, "HIT");
    assert.equal(a.textPolicy.evidenceText, "WITHHELD_BY_LICENSE");
    assert.ok(a.evidence.length > 0 && a.evidence.every((e) => e.text === undefined));
    assert.equal(model.calls.length, calls, "the gate is applied when serving, so it does not cost a model call");
    // the headline sentence of the paper appears in no evidence entry of either response
    for (const e of [...r.json.evidence, ...a.evidence]) assert.equal(JSON.stringify(e).includes(HEADLINE), false);
  });

  await t.test("an unknown licence (null) is treated as restricted; a fresh, uncached question is gated too", async () => {
    await setLicense(null);
    const r = await ask("A question nobody has asked before about the dataset?");
    assert.equal(r.status, 200);
    assert.equal(r.json.cache.status, "MISS");
    assert.equal(r.json.textPolicy.evidenceText, "WITHHELD_BY_LICENSE");
    assert.ok(r.json.evidence.every((e) => e.text === undefined));
    assert.equal(r.json.textPolicy.license, null);
    await setLicense("cc-by");
    const back = await ask();
    assert.equal(back.json.textPolicy.evidenceText, "INCLUDED", "restoring the licence restores the text: nothing stale was stored");
  });
});
