#!/usr/bin/env node
"use strict";
/**
 * FIRST REAL CLAUDE REQUEST: one real paper, one STANDARD analysis, through the deployed backend, with every number captured.
 * Run it ONLY after the cloud checks pass and AFTER you have set ANTHROPIC_API_KEY in the Railway dashboard yourself.
 * This script never sees, asks for or prints an Anthropic key, and it never prints your Firebase token or paper text.
 *
 *   SHORDS_API_URL=https://<railway-backend>  SHORDS_ID_TOKEN=<fresh Firebase ID token>  [SHORDS_PROJECT_ID=prj_...]
 *   [SMOKE_PAPER=arxiv:2312.00752] [EXPECT_MODEL=claude-sonnet-5-5] [ALLOW_ABSTRACT_ONLY=1] node scripts/smoke_claude.js
 *
 * What it does (a single paid model call, then one free cache check):
 *   0. /ready: the AI provider must be REACHABLE (otherwise the key is not set / not accepted, and it stops: no spend).
 *   1. POST /api/v1/papers/resolve: paper id, coverage, content hash. Not FULL_TEXT => stops (no spend) unless ALLOW_ABSTRACT_ONLY=1.
 *   2. POST /api/v1/analysis (STANDARD) and poll the job to COMPLETED / FAILED.
 *   3. Checks the result is real Claude (not the labelled local fallback), UNVERIFIED (never VERIFIED), carries server-owned
 *      evidence from this paper, and that tokens / cost / latency are measured. Unmeasured values are printed as null.
 *   4. Repeats the identical analysis: it must be a cache HIT that spends nothing.
 * Exit 0 only if every check PASSes; 1 on any FAIL; 2 if a prerequisite stopped the run before any model call.
 */

// Verified against https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-04. The server only reports a cost when
// it holds a verified price; this is the independent expectation the reported number is compared with. Re-check before relying on it.
const PRICE_PER_MTOK = { input: 2, output: 10 };

function normalizeBase(u) {
  const url = new URL(u);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("SHORDS_API_URL must be https (http only for localhost)");
  return url.origin;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isInt = (n) => Number.isInteger(n) && n >= 0;

async function run(o) {
  const base = normalizeBase(o.baseUrl);
  const report = o.report || ((l) => console.log(JSON.stringify(l)));
  const paperRef = o.paper || "arxiv:2312.00752";
  const expectModel = o.expectModel || "claude-sonnet-5-5";
  const pollMs = o.pollMs || 2000;
  const deadline = Date.now() + (o.maxWaitMs || 8 * 60 * 1000);
  const checks = [];
  const rec = (check, ok, detail = {}) => {
    const line = { check, ...detail, status: ok === null ? "NOT_VERIFIED" : ok ? "PASS" : "FAIL" };
    checks.push(line);
    report(line);
    return ok;
  };
  const call = async (method, path, body, headers = {}) => {
    const h = { accept: "application/json", ...headers };
    if (o.token) h.authorization = `Bearer ${o.token}`;
    if (body !== undefined) h["content-type"] = "application/json";
    try {
      const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* ignore */ }
      return { status: r.status, json };
    } catch (e) {
      return { status: 0, error: String((e && e.cause && e.cause.code) || (e && e.name) || e).slice(0, 60) };
    }
  };
  const stop = (why, detail = {}) => { report({ stopped: why, ...detail }); return { checks, exitCode: 2, captured: null }; };

  if (!o.token) return stop("SHORDS_ID_TOKEN is not set");

  // 0. the provider must be reachable before anything is spent
  const ready = await call("GET", "/ready");
  const ai = ready.json && ready.json.checks && ready.json.checks.aiProvider;
  if (!ai || ai.status !== "REACHABLE") return stop("the AI provider is not REACHABLE, so no request was made (set ANTHROPIC_API_KEY in Railway and redeploy)", { reported: ai && ai.status, detail: ai && ai.detail });
  rec("provider reachable", true, { model: ai.model });
  rec("configured model is the expected one", ai.model === expectModel, { configured: ai.model, expected: expectModel });

  // 1. paper
  const paper = await call("POST", "/api/v1/papers/resolve", { paperId: paperRef });
  if (paper.status !== 200 || !paper.json) return stop("paper could not be resolved", { httpStatus: paper.status, error: (paper.json && paper.json.error) || paper.error });
  const P = paper.json;
  report({ paper: { paperId: P.paperId, title: P.title && P.title.slice(0, 90), coverage: P.coverage, source: P.source, chunkCount: P.chunkCount, contentHash: P.contentHash, truncated: P.truncated } });
  const coverageOk = P.coverage === "FULL_TEXT" || (o.allowAbstractOnly && P.coverage === "ABSTRACT_ONLY");
  if (!coverageOk) return stop(`coverage is ${P.coverage}; choose a paper with open-access full text (or set ALLOW_ABSTRACT_ONLY=1). No model call was made.`);

  // project
  let projectId = o.projectId;
  if (!projectId) {
    const pl = await call("GET", "/api/v1/projects");
    const list = pl.json && Array.isArray(pl.json.projects) ? pl.json.projects : [];
    if (list.length !== 1) return stop(list.length === 0 ? "no project: create one in the app first" : "several projects: set SHORDS_PROJECT_ID", { projects: list.length });
    projectId = list[0].projectId;
  }

  // 2. one STANDARD analysis
  const analyse = async (suffix) => {
    const t0 = Date.now();
    const created = await call("POST", "/api/v1/analysis", { projectId, paperId: P.paperId, analysisDepth: "STANDARD" }, { "idempotency-key": `smoke-${Date.now()}-${suffix}` });
    if (![200, 202].includes(created.status) || !created.json || !created.json.jobId) return { error: { httpStatus: created.status, code: created.json && created.json.error } };
    for (;;) {
      const j = await call("GET", `/api/v1/analysis/${created.json.jobId}`);
      if (j.status === 200 && j.json && (j.json.status === "COMPLETED" || j.json.status === "FAILED" || j.json.status === "CANCELLED")) return { job: j.json, wallMs: Date.now() - t0 };
      if (Date.now() > deadline) return { error: { code: "TIMEOUT_WAITING_FOR_JOB", jobId: created.json.jobId } };
      await sleep(pollMs);
    }
  };
  const first = await analyse("a");
  if (first.error) { rec("analysis job completed", false, first.error); return { checks, exitCode: 1, captured: null }; }
  if (first.job.status !== "COMPLETED") { rec("analysis job completed", false, { jobStatus: first.job.status, error: first.job.error }); return { checks, exitCode: 1, captured: null }; }
  const B = first.job.result || {};
  const T = B.tokens || {};

  // 3. what came back
  const expectCost = isInt(T.inputTokens) && isInt(T.outputTokens) ? (T.inputTokens / 1e6) * PRICE_PER_MTOK.input + (T.outputTokens / 1e6) * PRICE_PER_MTOK.output : null;
  const captured = {
    requestId: B.requestId || null, providerRequestId: B.providerRequestId || null, jobId: first.job.jobId,
    paperId: B.paper && B.paper.paperId, contentHash: B.contentHash || null,
    provider: B.provider || null, model: B.model || null, modelMode: B.modelMode || null, effort: B.effort || null, stopReason: B.stopReason || null,
    inputTokens: isInt(T.inputTokens) ? T.inputTokens : null, outputTokens: isInt(T.outputTokens) ? T.outputTokens : null, totalTokens: isInt(T.totalTokens) ? T.totalTokens : null,
    tokenSource: T.source || null, costUsd: typeof T.estimatedCostUsd === "number" ? T.estimatedCostUsd : null, costStatus: T.costStatus || null,
    latencyMs: typeof B.latencyMs === "number" ? B.latencyMs : null, wallClockMs: first.wallMs,
    cacheStatus: (B.cache && B.cache.status) || null, fallbackUsed: B.fallbackUsed === undefined ? null : B.fallbackUsed, fallbackReason: B.fallbackReason || null,
    verificationStatus: B.verificationStatus || null, contentCoverage: B.contentCoverage || null, aiCalled: B.aiCalled === undefined ? null : B.aiCalled,
    evidenceItems: Array.isArray(B.evidence) ? B.evidence.length : null, confidence: B.confidence ? B.confidence.level : null
  };
  report({ captured });

  rec("real Claude answered (not the labelled fallback)", B.aiCalled === true && B.fallbackUsed === false && B.provider === "anthropic" && B.modelMode === "EXTERNAL_CLAUDE", { aiCalled: B.aiCalled, fallbackUsed: B.fallbackUsed, fallbackReason: B.fallbackReason, provider: B.provider });
  rec("the model that ran is the expected one", B.model === expectModel, { ran: B.model, expected: expectModel });
  rec("verification status is honest (UNVERIFIED, never VERIFIED)", B.verificationStatus === "UNVERIFIED", { verificationStatus: B.verificationStatus });
  rec("usage was measured by the provider", T.source === "REAL_PROVIDER" && isInt(T.inputTokens) && isInt(T.outputTokens) && T.inputTokens > 0 && T.outputTokens > 0 && T.totalTokens >= T.inputTokens + T.outputTokens - 0, { tokens: { in: T.inputTokens, out: T.outputTokens, total: T.totalTokens }, source: T.source });
  if (T.estimatedCostUsd === null || T.estimatedCostUsd === undefined) rec("cost is reported only when measured", T.costStatus === "NOT_AVAILABLE" || T.costStatus === "NOT_MEASURED", { costStatus: T.costStatus, note: "no verified price is configured on the server: cost is null by design" });
  else rec("reported cost matches the verified price x measured tokens", expectCost !== null && Math.abs(T.estimatedCostUsd - expectCost) < 1e-6, { reported: T.estimatedCostUsd, expectedFromTokens: expectCost, costStatus: T.costStatus, note: "an estimate; the Anthropic Console invoice is the source of truth" });
  rec("content hash matches the paper that was resolved", Boolean(B.contentHash) && B.contentHash === P.contentHash, { analysis: B.contentHash && B.contentHash.slice(0, 12), resolved: P.contentHash && P.contentHash.slice(0, 12) });
  const ev = Array.isArray(B.evidence) ? B.evidence : [];
  rec("evidence is server-owned: every id belongs to this paper", ev.length > 0 && ev.every((e) => typeof e.chunkId === "string" && e.chunkId.startsWith(`${P.paperId}_chunk_`)), { items: ev.length });
  rec("structured intelligence is present", Boolean(B.intelligence && typeof B.intelligence === "object"), { fields: B.intelligence ? Object.keys(B.intelligence) : null });
  rec("latency was measured", typeof B.latencyMs === "number" && B.latencyMs > 0, { latencyMs: B.latencyMs, wallClockMs: first.wallMs });

  // 4. cache: the same request again must cost nothing
  const second = await analyse("b");
  if (second.error || second.job.status !== "COMPLETED") rec("repeat request completed", false, second.error || { jobStatus: second.job.status });
  else {
    const C = second.job.result || {};
    const CT = C.tokens || {};
    report({ cacheRepeat: { requestId: C.requestId, cacheStatus: C.cache && C.cache.status, originalRequestId: C.cache && C.cache.originalRequestId, tokenSource: CT.source, costStatus: CT.costStatus, latencyMs: C.latencyMs } });
    rec("identical repeat is a cache HIT that spends nothing", Boolean(C.cache) && C.cache.status === "HIT" && CT.source === "CACHE" && CT.inputTokens === null && CT.estimatedCostUsd === 0, { cacheStatus: C.cache && C.cache.status, tokenSource: CT.source });
  }

  const fails = checks.filter((c) => c.status === "FAIL").length;
  report({ summary: { pass: checks.filter((c) => c.status === "PASS").length, fail: fails, notVerified: checks.filter((c) => c.status === "NOT_VERIFIED").length } });
  return { checks, exitCode: fails ? 1 : 0, captured };
}

module.exports = { run, PRICE_PER_MTOK };

if (require.main === module) {
  if (!process.env.SHORDS_API_URL) {
    console.error("SHORDS_API_URL is required");
    process.exit(2);
  }
  run({
    baseUrl: process.env.SHORDS_API_URL, token: process.env.SHORDS_ID_TOKEN, projectId: process.env.SHORDS_PROJECT_ID,
    paper: process.env.SMOKE_PAPER, expectModel: process.env.EXPECT_MODEL, allowAbstractOnly: process.env.ALLOW_ABSTRACT_ONLY === "1"
  }).then((r) => process.exit(r.exitCode)).catch((e) => { console.error("smoke_claude failed:", String(e && e.message).slice(0, 200)); process.exit(1); });
}
