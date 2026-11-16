"use strict";
/**
 * Local pilot runner for the 50-paper summary benchmark (see docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md and docs/ops/BENCHMARK_PREPARATION).
 *
 * It runs the NORMAL analysis pipeline (paper retrieval, coverage gate, evidence selection, spend gate, validation) in-process, one paper at a
 * time, and writes: backend_analyses.json (input of `summary_benchmark.js plan`), spend_log.jsonl (one line per paper) and, through the
 * raw-capture hook, one local file per paper with the unvalidated model output (input of `f1_review.js make`).
 *
 * It is the ONLY code that spends money for the benchmark, so every gate is here and every gate is tested (backend/tests/node/benchmarkRun.test.js):
 *   - refuses to start unless it is clearly a local process: not NODE_ENV=production, no Railway/Vercel/Kubernetes variables, database and Redis on
 *     this machine, cache OFF (a cached answer would hide the real cost), raw capture ON into an absolute directory;
 *   - refuses to call a model without an explicit --confirm-spend and a --max-usd of at most HARD_CEILING_USD;
 *   - runs only papers whose licence a PERSON has confirmed in selection_record.csv (licence_confirmed_by_person and confirmed_on filled in);
 *   - before every paper checks that (measured spend so far + the worst case of one more call) still fits under the ceiling; if not, it stops;
 *   - a call whose cost was not measured is counted at its WORST CASE, never at zero;
 *   - stops after two failures in a row, and after --limit papers (default 3: the pilot).
 * It never prints or stores the API key and never talks to production.
 */
const fs = require("node:fs");
const path = require("node:path");
const B = require("./summaryBenchmark");

const HARD_CEILING_USD = 25; // the owner-approved ceiling for this benchmark; raising it needs a new approval and a code change
const MAX_PAPERS = 50;
const DEPTHS = ["QUICK", "STANDARD", "DEEP"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEPLOY_VARS = (env) => Object.keys(env).filter((k) => /^RAILWAY_/.test(k) || k === "VERCEL" || k === "KUBERNETES_SERVICE_HOST");

class BenchmarkRunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BenchmarkRunError";
    this.code = code;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

/** Throws BenchmarkRunError unless this is a local, capture-on, cache-off process. Returns nothing; never echoes a secret. */
function assertLocalEnvironment(env, { needKey = true } = {}) {
  const fail = (code, msg) => {
    throw new BenchmarkRunError(code, msg);
  };
  if (String(env.NODE_ENV || "").toLowerCase() === "production") fail("NOT_LOCAL", "refused: NODE_ENV=production. The benchmark runs only in a local environment.");
  const deployed = DEPLOY_VARS(env);
  if (deployed.length) fail("NOT_LOCAL", `refused: this looks like a deployed environment (${deployed.slice(0, 3).join(", ")} is set).`);
  for (const [name, val] of [["DATABASE_URL", env.DATABASE_URL], ["REDIS_URL", env.REDIS_URL]]) {
    if (!val) fail("NOT_LOCAL", `refused: ${name} is not set. Use a throwaway local database and Redis.`);
    const h = hostOf(val);
    if (!h || !LOCAL_HOSTS.has(h)) fail("NOT_LOCAL", `refused: ${name} does not point at this machine (localhost / 127.0.0.1 / ::1).`);
  }
  if (String(env.AI_CACHE_ENABLED || "").toLowerCase() !== "false") fail("CACHE_ON", "refused: set AI_CACHE_ENABLED=false so every paper is a real, measured call.");
  if (String(env.BENCHMARK_RAW_CAPTURE || "") !== "1") fail("CAPTURE_OFF", "refused: set BENCHMARK_RAW_CAPTURE=1 (and BENCHMARK_RAW_CAPTURE_DIR) so the raw model output is kept for the F1 review.");
  if (!env.BENCHMARK_RAW_CAPTURE_DIR || !path.isAbsolute(env.BENCHMARK_RAW_CAPTURE_DIR)) fail("CAPTURE_DIR", "refused: BENCHMARK_RAW_CAPTURE_DIR must be an absolute path.");
  if (needKey && !env.ANTHROPIC_API_KEY) fail("NO_KEY", "refused: ANTHROPIC_API_KEY is not set in this process's environment (it is read from the environment only).");
}

/** Validate the numeric options. */
function checkOptions({ maxUsd, limit, depth, confirmSpend }) {
  if (confirmSpend !== true) throw new BenchmarkRunError("NO_CONFIRM", "refused: pass --confirm-spend to allow paid model calls.");
  if (!(Number.isFinite(maxUsd) && maxUsd > 0)) throw new BenchmarkRunError("BAD_MAX", "refused: --max-usd must be a positive number.");
  if (maxUsd > HARD_CEILING_USD) throw new BenchmarkRunError("OVER_CEILING", `refused: --max-usd ${maxUsd} is above the approved ceiling of ${HARD_CEILING_USD} USD.`);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAPERS)) throw new BenchmarkRunError("BAD_LIMIT", `refused: --limit must be a whole number from 1 to ${MAX_PAPERS}.`);
  if (!DEPTHS.includes(depth)) throw new BenchmarkRunError("BAD_DEPTH", `refused: --depth must be one of ${DEPTHS.join(", ")}.`);
}

/** Papers from candidates.json whose licence a person confirmed in selection_record.csv. Others are listed with the reason, never run. */
function eligiblePapers(candidates, recordCsv) {
  const rows = B.parseCsv(recordCsv);
  const byId = new Map(rows.map((r) => [r.paperId, r]));
  const eligible = [];
  const skipped = [];
  for (const p of (candidates && candidates.selected) || []) {
    const r = byId.get(p.paperId);
    if (!r || r.decision !== "SELECTED") skipped.push({ paperId: p.paperId, reason: "NOT_IN_SELECTION_RECORD" });
    else if (!String(r.licence_confirmed_by_person || "").trim() || !String(r.confirmed_on || "").trim()) skipped.push({ paperId: p.paperId, reason: "LICENCE_NOT_CONFIRMED_BY_A_PERSON" });
    else if (!/^doi:|^pmid:|^arxiv:/i.test(p.paperId) && !p.doi) skipped.push({ paperId: p.paperId, reason: "NO_BACKEND_REFERENCE" });
    else eligible.push({ ...p, ref: /^(doi|pmid|arxiv):/i.test(p.paperId) ? p.paperId : `doi:${String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase()}` });
  }
  return { eligible, skipped };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const listDir = (d) => { try { return new Set(fs.readdirSync(d)); } catch (_) { return new Set(); } };

/**
 * @param {object} a
 * @param {object} a.pipeline          the runtime's pipeline (analyzePaper)
 * @param {Array}  a.papers            eligible papers ({paperId, ref, ...})
 * @param {number} a.maxUsd, a.limit, a.depth
 * @param {number} a.worstCaseUsd      worst-case cost of ONE more call at this depth (the caller passes the spend gate's own reservation: two attempts)
 * @param {string} a.outDir            where backend_analyses.json and spend_log.jsonl go
 * @param {string} a.captureDir        the raw-capture directory (to attach the full chunk texts)
 */
async function runPilot({ pipeline, papers, maxUsd, limit, depth, worstCaseUsd, outDir, captureDir, log = console.log }) {
  fs.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(outDir, "spend_log.jsonl");
  const analysesFile = path.join(outDir, "backend_analyses.json");
  const analyses = fs.existsSync(analysesFile) ? JSON.parse(fs.readFileSync(analysesFile, "utf8")) : {};
  let spent = 0;
  let failuresInRow = 0;
  let stoppedBecause = null;
  const lines = [];
  let done = 0;
  for (const p of papers) {
    if (done >= limit) break;
    if (spent + worstCaseUsd > maxUsd + 1e-9) { stoppedBecause = "CEILING_WOULD_BE_EXCEEDED"; break; }
    if (failuresInRow >= 2) { stoppedBecause = "TWO_FAILURES_IN_A_ROW"; break; }
    const before = listDir(captureDir);
    let entry;
    try {
      const out = await pipeline.analyzePaper({ paperId: p.ref, analysisDepth: depth }, { scope: { tenantId: "benchmark-local", projectId: "benchmark-local" }, uid: "benchmark-local", jobId: null });
      const b = out.body || {};
      const t = b.tokens || {};
      const measured = typeof t.estimatedCostUsd === "number" && Number.isFinite(t.estimatedCostUsd);
      const aiCalled = b.aiCalled === true;
      // A call that reached the provider but has no measured cost counts at its worst case, never at zero.
      const cost = !aiCalled ? 0 : measured ? t.estimatedCostUsd : worstCaseUsd;
      spent += cost;
      entry = { paperId: p.paperId, ref: p.ref, httpStatus: out.httpStatus, status: b.verificationStatus || b.status || null, coverage: b.contentCoverage || null, aiCalled, fallbackUsed: Boolean(b.fallbackUsed), model: b.model || null, inputTokens: t.inputTokens ?? null, outputTokens: t.outputTokens ?? null, costUsd: round6(cost), costStatus: t.costStatus || null, costCountedAtWorstCase: aiCalled && !measured, cumulativeUsd: round6(spent) };
      if (out.httpStatus === 200 && aiCalled && b.intelligence) {
        const added = [...listDir(captureDir)].filter((f) => !before.has(f) && f.endsWith(".json"));
        let chunksById = null;
        for (const f of added) {
          try {
            const cap = JSON.parse(fs.readFileSync(path.join(captureDir, f), "utf8"));
            if (cap.paper && cap.paper.paperId === b.paper.paperId && Array.isArray(cap.chunks)) { chunksById = Object.fromEntries(cap.chunks.map((c) => [c.chunkId, c.text])); entry.captureFile = f; }
          } catch (_) { /* unreadable capture file: the analysis is still recorded without passages */ }
        }
        analyses[p.paperId] = { intelligence: b.intelligence, ...(chunksById ? { chunksById } : {}) };
        failuresInRow = 0;
      } else {
        failuresInRow++;
      }
    } catch (e) {
      failuresInRow++;
      entry = { paperId: p.paperId, ref: p.ref, error: `${e && e.name}: ${String((e && e.message) || e).slice(0, 200)}`, aiCalled: null, costUsd: null, cumulativeUsd: round6(spent), costUnknownAfterError: true };
    }
    done++;
    lines.push(entry);
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
    fs.writeFileSync(analysesFile, JSON.stringify(analyses, null, 2));
    log(`${done}/${Math.min(limit, papers.length)} ${p.paperId}: ${entry.error ? "ERROR " + entry.error : `${entry.status} aiCalled=${entry.aiCalled} cost=$${entry.costUsd} (${entry.costStatus || "n/a"}) cumulative=$${entry.cumulativeUsd}`}`);
  }
  if (stoppedBecause === null) stoppedBecause = done >= limit ? "LIMIT_REACHED" : "NO_MORE_ELIGIBLE_PAPERS";
  const measuredCalls = lines.filter((l) => l.aiCalled && !l.costCountedAtWorstCase);
  const mean = measuredCalls.length ? measuredCalls.reduce((s, l) => s + l.costUsd, 0) / measuredCalls.length : null;
  const unknown = lines.some((l) => l.costUnknownAfterError);
  return {
    papersRun: lines.length,
    spentUsd: round6(spent),
    spentIsLowerBound: unknown,
    meanMeasuredCostPerPaperUsd: mean === null ? null : round6(mean),
    projection50PapersUsd: mean === null ? null : round6(mean * 50),
    projectionNote: "projection = mean of measured calls x 50; an assumption until more papers are run",
    stoppedBecause,
    worstCasePerCallUsd: worstCaseUsd,
    files: { spendLog: logFile, backendAnalyses: analysesFile }
  };
}

module.exports = { HARD_CEILING_USD, MAX_PAPERS, BenchmarkRunError, assertLocalEnvironment, checkOptions, eligiblePapers, runPilot };
