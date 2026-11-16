"use strict";
/**
 * The local benchmark runner's gates (backend/eval/benchmarkRun.js, scripts/benchmark_run_local.js). No network, no model, no database: the pipeline
 * is a fake. What matters here is every way the runner REFUSES to spend, and that it stops itself.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const R = require("../../eval/benchmarkRun");

const GOOD_ENV = { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x_test", REDIS_URL: "redis://localhost:6379", AI_CACHE_ENABLED: "false", BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: path.resolve(os.tmpdir(), "cap"), ANTHROPIC_API_KEY: "sk-ant-test-not-real" };
const refuses = (env, code, opts) => assert.throws(() => R.assertLocalEnvironment(env, opts), (e) => e instanceof R.BenchmarkRunError && e.code === code, `${code}: ${JSON.stringify(Object.keys(env))}`);

test("environment: only a local, cache-off, capture-on process with a key is accepted", () => {
  R.assertLocalEnvironment(GOOD_ENV);
  refuses({ ...GOOD_ENV, NODE_ENV: "production" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, RAILWAY_ENVIRONMENT: "production" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, VERCEL: "1" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, KUBERNETES_SERVICE_HOST: "10.0.0.1" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, DATABASE_URL: "postgres://u:p@db.example.com:5432/x" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, DATABASE_URL: "postgres://u:p@localhost.evil.example:5432/x" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, REDIS_URL: "redis://10.1.2.3:6379" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, DATABASE_URL: undefined }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, DATABASE_URL: "not a url" }, "NOT_LOCAL");
  refuses({ ...GOOD_ENV, AI_CACHE_ENABLED: undefined }, "CACHE_ON");
  refuses({ ...GOOD_ENV, AI_CACHE_ENABLED: "true" }, "CACHE_ON");
  refuses({ ...GOOD_ENV, BENCHMARK_RAW_CAPTURE: undefined }, "CAPTURE_OFF");
  refuses({ ...GOOD_ENV, BENCHMARK_RAW_CAPTURE_DIR: "relative/dir" }, "CAPTURE_DIR");
  refuses({ ...GOOD_ENV, ANTHROPIC_API_KEY: undefined }, "NO_KEY");
  R.assertLocalEnvironment({ ...GOOD_ENV, ANTHROPIC_API_KEY: undefined }, { needKey: false });
});

test("options: no spend without --confirm-spend; the ceiling cannot exceed 25 USD; limit and depth are bounded", () => {
  const ok = { maxUsd: 3, limit: 3, depth: "STANDARD", confirmSpend: true };
  R.checkOptions(ok);
  for (const [bad, code] of [[{ confirmSpend: false }, "NO_CONFIRM"], [{ confirmSpend: undefined }, "NO_CONFIRM"], [{ maxUsd: 25.01 }, "OVER_CEILING"], [{ maxUsd: 1000 }, "OVER_CEILING"], [{ maxUsd: 0 }, "BAD_MAX"], [{ maxUsd: NaN }, "BAD_MAX"], [{ maxUsd: -1 }, "BAD_MAX"], [{ limit: 0 }, "BAD_LIMIT"], [{ limit: 51 }, "BAD_LIMIT"], [{ limit: 2.5 }, "BAD_LIMIT"], [{ depth: "ULTRA" }, "BAD_DEPTH"]]) {
    assert.throws(() => R.checkOptions({ ...ok, ...bad }), (e) => e.code === code, code);
  }
  R.checkOptions({ ...ok, maxUsd: 25, limit: 50 });
  assert.equal(R.HARD_CEILING_USD, 25);
});

test("eligibility: only papers a PERSON confirmed (licence and date) in the selection record are run", () => {
  const cands = { selected: [{ paperId: "doi:10.1/a", doi: "10.1/a" }, { paperId: "doi:10.1/b", doi: "10.1/b" }, { paperId: "doi:10.1/c", doi: "10.1/c" }, { paperId: "doi:10.1/d", doi: "10.1/d" }] };
  const csv = [
    "paperId,doi,title,decision,licence_confirmed_by_person,confirmed_on",
    "doi:10.1/a,10.1/a,A,SELECTED,CC BY 4.0 on publisher page,2026-11-05",
    "doi:10.1/b,10.1/b,B,SELECTED,,",
    "doi:10.1/c,10.1/c,C,SELECTED,yes,",
    "doi:10.1/x,10.1/x,X,SELECTED,yes,2026-11-05"
  ].join("\n");
  const { eligible, skipped } = R.eligiblePapers(cands, csv);
  assert.deepEqual(eligible.map((p) => p.ref), ["doi:10.1/a"]);
  assert.deepEqual(Object.fromEntries(skipped.map((s) => [s.paperId, s.reason])), { "doi:10.1/b": "LICENCE_NOT_CONFIRMED_BY_A_PERSON", "doi:10.1/c": "LICENCE_NOT_CONFIRMED_BY_A_PERSON", "doi:10.1/d": "NOT_IN_SELECTION_RECORD" });
});

function fakePipeline(costs) {
  const calls = [];
  return {
    calls,
    async analyzePaper(req) {
      const i = calls.length;
      calls.push(req);
      const c = costs[Math.min(i, costs.length - 1)];
      if (c instanceof Error) throw c;
      if (c === "NOAI") return { httpStatus: 200, body: { aiCalled: false, verificationStatus: "FALLBACK", fallbackUsed: true, paper: { paperId: req.paperId }, tokens: { costStatus: "NOT_AVAILABLE" } } };
      return { httpStatus: 200, body: { aiCalled: true, verificationStatus: "UNVERIFIED", model: "m", paper: { paperId: req.paperId }, intelligence: { tldr: { text: "t", evidence: ["c1"] } }, tokens: c === "UNMEASURED" ? { costStatus: "NOT_MEASURED" } : { inputTokens: 10, outputTokens: 5, estimatedCostUsd: c, costStatus: "ESTIMATED" } } };
    }
  };
}
const papers = (n) => Array.from({ length: n }, (_, i) => ({ paperId: `doi:10.1/p${i}`, ref: `doi:10.1/p${i}` }));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bm-run-"));
const base = (o) => ({ depth: "STANDARD", worstCaseUsd: 0.86, captureDir: tmp(), log: () => {}, ...o });

test("pilot: runs at most --limit papers, sums measured cost, writes a spend log line per paper, and says it stopped", async () => {
  const pipe = fakePipeline([0.1, 0.2, 0.3, 0.4]);
  const out = tmp();
  const rep = await R.runPilot(base({ pipeline: pipe, papers: papers(5), maxUsd: 10, limit: 3, outDir: out }));
  assert.equal(pipe.calls.length, 3);
  assert.equal(rep.papersRun, 3);
  assert.equal(rep.spentUsd, 0.6);
  assert.equal(rep.stoppedBecause, "LIMIT_REACHED");
  assert.equal(rep.meanMeasuredCostPerPaperUsd, 0.2);
  assert.equal(rep.projection50PapersUsd, 10);
  const lines = fs.readFileSync(path.join(out, "spend_log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((l) => l.cumulativeUsd), [0.1, 0.3, 0.6]);
  assert.equal(pipe.calls[0].analysisDepth, "STANDARD");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(out, "backend_analyses.json"), "utf8"))), ["doi:10.1/p0", "doi:10.1/p1", "doi:10.1/p2"]);
});

test("pilot: stops BEFORE a call whose worst case could pass the ceiling", async () => {
  const pipe = fakePipeline([0.5]);
  const rep = await R.runPilot(base({ pipeline: pipe, papers: papers(10), maxUsd: 2, limit: 10, outDir: tmp(), worstCaseUsd: 0.86 }));
  // after 2 calls spent = 1.0; 1.0 + 0.86 = 1.86 <= 2 so a third runs (spent 1.5); 1.5 + 0.86 > 2 so it stops
  assert.equal(pipe.calls.length, 3);
  assert.equal(rep.spentUsd, 1.5);
  assert.equal(rep.stoppedBecause, "CEILING_WOULD_BE_EXCEEDED");
  const tiny = await R.runPilot(base({ pipeline: fakePipeline([0.1]), papers: papers(3), maxUsd: 0.5, limit: 3, outDir: tmp(), worstCaseUsd: 0.86 }));
  assert.equal(tiny.papersRun, 0, "a ceiling below one worst-case call runs nothing");
});

test("pilot: a call without a measured cost is counted at its worst case, never at zero; a fallback (no AI) costs nothing", async () => {
  const rep = await R.runPilot(base({ pipeline: fakePipeline(["UNMEASURED", "NOAI"]), papers: papers(2), maxUsd: 10, limit: 2, outDir: tmp(), worstCaseUsd: 0.86 }));
  assert.equal(rep.spentUsd, 0.86);
  const lines = fs.readFileSync(rep.files.spendLog, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines[0].costCountedAtWorstCase, true);
  assert.equal(lines[1].costUsd, 0);
  assert.equal(rep.meanMeasuredCostPerPaperUsd, null, "no measured call, so no projection");
});

test("pilot: two failures in a row stop the run; an exception is logged and marks the total as a lower bound", async () => {
  const pipe = fakePipeline([new Error("provider exploded"), new Error("again"), 0.1]);
  const rep = await R.runPilot(base({ pipeline: pipe, papers: papers(6), maxUsd: 10, limit: 6, outDir: tmp() }));
  assert.equal(pipe.calls.length, 2);
  assert.equal(rep.stoppedBecause, "TWO_FAILURES_IN_A_ROW");
  assert.equal(rep.spentIsLowerBound, true);
  const first = JSON.parse(fs.readFileSync(rep.files.spendLog, "utf8").split("\n")[0]);
  assert.match(first.error, /provider exploded/);
  assert.equal(JSON.stringify(first).includes("sk-ant"), false);
});

test("pilot: fewer eligible papers than --limit says so", async () => {
  const rep = await R.runPilot(base({ pipeline: fakePipeline([0.1]), papers: papers(2), maxUsd: 10, limit: 5, outDir: tmp() }));
  assert.equal(rep.stoppedBecause, "NO_MORE_ELIGIBLE_PAPERS");
});

test("CLI: refuses without the gates, before any database or model is touched (exit code 2, a plain message)", () => {
  const cli = path.resolve(__dirname, "../../../scripts/benchmark_run_local.js");
  const run = (args, env) => spawnSync(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 20000 });
  const a = run(["--selected", "x.json", "--record", "r.csv", "--out", "o", "--max-usd", "3"], {});
  assert.equal(a.status, 2);
  assert.match(a.stderr, /--confirm-spend/);
  const b = run(["--selected", "x.json", "--record", "r.csv", "--out", "o", "--max-usd", "26", "--confirm-spend"], GOOD_ENV);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /ceiling of 25/);
  const c = run(["--selected", "x.json", "--record", "r.csv", "--out", "o", "--max-usd", "3", "--confirm-spend"], { ...GOOD_ENV, NODE_ENV: "production" });
  assert.equal(c.status, 2);
  assert.match(c.stderr, /NODE_ENV=production/);
  assert.equal((a.stderr + b.stderr + c.stderr).includes("sk-ant-test-not-real"), false, "the key is never printed");
  // an empty selection record: nothing runs, nothing spent
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify({ selected: [{ paperId: "doi:10.1/a", doi: "10.1/a" }] }));
  fs.writeFileSync(path.join(dir, "r.csv"), "paperId,decision,licence_confirmed_by_person,confirmed_on\ndoi:10.1/a,SELECTED,,\n");
  const d = run(["--selected", path.join(dir, "c.json"), "--record", path.join(dir, "r.csv"), "--out", path.join(dir, "o"), "--max-usd", "3", "--confirm-spend"], GOOD_ENV);
  assert.equal(d.status, 2);
  assert.match(d.stderr, /Nothing was run and nothing was spent/);
  assert.equal(fs.existsSync(path.join(dir, "o")), false);
});
