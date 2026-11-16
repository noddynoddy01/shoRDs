"use strict";
/**
 * The pilot runner on the REAL pipeline (real Postgres/Redis, fixture paper provider, stub model): files written, spend counted from the
 * measured cost, raw output captured next to the analyses, and the spend ledger agrees with the runner's own total. No network, no real model.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fx = require("./paperFixtures");
const R = require("../../eval/benchmarkRun");
const { modelStub, startReplica, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();

test("benchmark pilot on the real pipeline", { skip }, async (t) => {
  await resetInfra();
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-cap-"));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-out-"));
  const env = { NODE_ENV: "test", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "false", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: capDir };
  const model = modelStub({ costUsd: 0.0123, costStatus: "ESTIMATED" });
  const rep = await startReplica({ env, overrides: { client: model } });
  try {
    await rep.runtime.startBackground();
    const papers = [{ paperId: `doi:${fx.FIXTURE_DOI}`, ref: `doi:${fx.FIXTURE_DOI}`, doi: fx.FIXTURE_DOI }];

    await t.test("environment gate accepts this local test process", () => {
      R.assertLocalEnvironment({ ...env, DATABASE_URL: process.env.TEST_DATABASE_URL, REDIS_URL: process.env.TEST_REDIS_URL });
    });

    await t.test("one paper: analysis, raw capture and spend log agree", async () => {
      const report = await R.runPilot({ pipeline: rep.runtime.pipeline, papers, maxUsd: 3, limit: 1, depth: "STANDARD", worstCaseUsd: 0.86, outDir, captureDir: capDir, log: () => {} });
      assert.equal(report.papersRun, 1);
      assert.equal(report.spentUsd, 0.0123);
      assert.equal(model.calls.length, 1, "exactly one model call");
      const log = fs.readFileSync(report.files.spendLog, "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(log.length, 1);
      assert.equal(log[0].aiCalled, true);
      assert.equal(log[0].costCountedAtWorstCase, false);
      assert.ok(log[0].captureFile, "the capture file for this paper was found");
      const analyses = JSON.parse(fs.readFileSync(report.files.backendAnalyses, "utf8"));
      const a = analyses[`doi:${fx.FIXTURE_DOI}`] || analyses[Object.keys(analyses)[0]];
      assert.ok(a && a.intelligence && a.intelligence.tldr, "validated intelligence recorded");
      assert.ok(a.chunksById && Object.keys(a.chunksById).length > 0, "full chunk texts attached from the capture file");
      // the capture holds the raw model output; the analyses file holds only the validated object
      const cap = JSON.parse(fs.readFileSync(path.join(capDir, log[0].captureFile), "utf8"));
      assert.equal(cap.kind, "BENCHMARK_RAW_MODEL_OUTPUT");
      assert.ok(cap.modelOutput && cap.rawText);
      // the ledger (the spend gate's own record) agrees with the runner's total
      const row = await rep.runtime.pool.query("SELECT count(*)::int AS n, coalesce(sum(cost_usd),0)::float AS usd FROM ai_usage WHERE ai_called");
      assert.equal(row.rows[0].n, 1);
      assert.ok(Math.abs(row.rows[0].usd - 0.0123) < 1e-6, `ledger ${row.rows[0].usd}`);
      // stdout/log lines never contain the key
      assert.equal(JSON.stringify(log).includes(FAKE_ANTHROPIC_KEY), false);
    });

    await t.test("the output feeds the existing rating-plan step (plan accepts backend_analyses.json as written)", () => {
      const B = require("../../eval/summaryBenchmark");
      const analyses = JSON.parse(fs.readFileSync(path.join(outDir, "backend_analyses.json"), "utf8"));
      const k = Object.keys(analyses)[0];
      const r = B.renderIntelligenceText(analyses[k].intelligence, analyses[k].chunksById);
      assert.ok(r.text.length > 20);
      assert.ok(Object.keys(r.passages).length > 0, "passages are available to the raters where the licence allowed keeping text");
    });
  } finally {
    await rep.close();
  }
});
