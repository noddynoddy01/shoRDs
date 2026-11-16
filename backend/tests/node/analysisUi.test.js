"use strict";
/**
 * The "Run AI analysis" path of the app (services/analysisClient.ts, the Idempotency-Key option of services/auth/apiClient.ts,
 * components/research/AnalysisPanel.tsx and its place in the paper screen). Pure logic runs with fakes; the React files are checked as
 * source because no renderer runs here (the rendered states are shown in docs/ops/evidence as screenshots made from the real component).
 * Nothing here calls a network or a model.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const C = require(path.join(root, "services/analysisClient.ts"));
const A = require(path.join(root, "services/auth/apiClient.ts"));
const M = require(path.join(root, "services/evidenceModel.ts"));

const PRJ = "prj_0123456789abcdef01";
const JOB = "job_0123456789abcdef01234567";
const describe = (e) => (e && e.message) || "error";
const apiErr = (kind, message, extra) => new A.ApiError(kind, message, extra);
const noSleep = async () => {};

function fakeApi(handlers) {
  const calls = [];
  return {
    calls,
    post: async (p, body, opts) => { calls.push({ m: "POST", p, body, opts }); return handlers.post(p, body, opts, calls); },
    get: async (p, opts) => { calls.push({ m: "GET", p, opts }); return handlers.get(p, opts, calls); }
  };
}
const DONE_BODY = { paper: { paperId: "doi:10.9999/x" }, intelligence: { findings: { text: "A finding.", evidence: ["c1"] } }, confidence: { level: "HIGH", score: 0.93 } };

test("backendPaperRef: a DOI (any common spelling) or an existing doi:/pmid:/arxiv: id; nothing else", () => {
  assert.equal(C.backendPaperRef({ doi: "10.1000/ABC.1" }), "doi:10.1000/abc.1");
  assert.equal(C.backendPaperRef({ doi: "https://doi.org/10.1000/abc.1" }), "doi:10.1000/abc.1");
  assert.equal(C.backendPaperRef({ doi: "doi: 10.1000/abc.1" }), "doi:10.1000/abc.1");
  assert.equal(C.backendPaperRef({ id: "pmid:12345" }), "pmid:12345");
  assert.equal(C.backendPaperRef({ id: "arxiv:2101.00001" }), "arxiv:2101.00001");
  for (const bad of [null, undefined, {}, { doi: "" }, { doi: "not a doi" }, { id: "paper-123" }, { doi: 5 }, { id: "doi:" }]) assert.equal(C.backendPaperRef(bad), null, JSON.stringify(bad));
});

test("runAnalysis: creates the personal project once, sends ONE Idempotency-Key, polls, and returns the result", async () => {
  C.forgetPersonalProject();
  let polls = 0;
  const api = fakeApi({
    post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: JOB, status: "QUEUED", pollUrl: `/api/v1/analysis/${JOB}` }),
    get: async () => (++polls < 3 ? { status: "PROCESSING" } : { status: "COMPLETED", result: DONE_BODY })
  });
  const seen = [];
  const out = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api, describeError: describe, sleep: noSleep, newKey: () => "key-A", onProgress: (p) => seen.push(p) });
  assert.equal(out.kind, "DONE");
  assert.equal(out.jobId, JOB);
  const start = api.calls.find((c) => c.p === "/api/v1/analysis");
  assert.deepEqual(start.body, { projectId: PRJ, paperId: "doi:10.9999/x", analysisDepth: "STANDARD" });
  assert.equal(start.opts.headers["Idempotency-Key"], "key-A");
  assert.deepEqual(seen.slice(0, 2), ["PREPARING", "QUEUED"]);
  assert.ok(seen.includes("RUNNING"));
  // second tap: project is remembered (no second create) and the key is NEW
  const out2 = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api, describeError: describe, sleep: noSleep, newKey: () => "key-B" });
  assert.equal(out2.kind, "DONE");
  assert.equal(api.calls.filter((c) => c.p === "/api/v1/projects/personal").length, 1);
  assert.deepEqual(api.calls.filter((c) => c.p === "/api/v1/analysis").map((c) => c.opts.headers["Idempotency-Key"]), ["key-A", "key-B"]);
});

test("runAnalysis: a network failure on the start request is repeated ONCE with the SAME key (so the server cannot create or charge twice)", async () => {
  C.forgetPersonalProject();
  let tries = 0;
  const api = fakeApi({
    post: async (p) => {
      if (p === "/api/v1/projects/personal") return { projectId: PRJ };
      if (++tries === 1) throw apiErr("NETWORK", "offline");
      return { jobId: JOB, status: "COMPLETED", result: DONE_BODY };
    },
    get: async () => ({})
  });
  const out = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api, describeError: describe, sleep: noSleep, newKey: () => "same-key" });
  assert.equal(out.kind, "DONE");
  const starts = api.calls.filter((c) => c.p === "/api/v1/analysis");
  assert.equal(starts.length, 2);
  assert.equal(starts[0].opts.headers["Idempotency-Key"], starts[1].opts.headers["Idempotency-Key"]);
  // a non-network error is NOT repeated
  C.forgetPersonalProject();
  const api2 = fakeApi({ post: async (p) => { if (p === "/api/v1/projects/personal") return { projectId: PRJ }; throw apiErr("RATE_LIMITED", "daily limit", { status: 429 }); }, get: async () => ({}) });
  const out2 = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: api2, describeError: describe, sleep: noSleep });
  assert.equal(out2.kind, "FAILED");
  assert.equal(api2.calls.filter((c) => c.p === "/api/v1/analysis").length, 1);
});

test("runAnalysis: nothing to analyse (422) is reported as UNAVAILABLE, not as a failure to retry", async () => {
  C.forgetPersonalProject();
  const api = fakeApi({ post: async (p) => { if (p === "/api/v1/projects/personal") return { projectId: PRJ }; throw apiErr("INVALID_REQUEST", "Only the title is available.", { status: 422, code: "METADATA_ONLY" }); }, get: async () => ({}) });
  const out = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api, describeError: describe, sleep: noSleep });
  assert.equal(out.kind, "UNAVAILABLE");
  assert.equal(out.reason, "METADATA_ONLY");
  // and the same when the job fails with that code
  C.forgetPersonalProject();
  const api2 = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: JOB, status: "FAILED", error: { code: "CONTENT_UNAVAILABLE", message: "No text." } }), get: async () => ({}) });
  const out2 = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: api2, describeError: describe, sleep: noSleep });
  assert.equal(out2.kind, "UNAVAILABLE");
});

test("runAnalysis: a failed job, a bad project id, a bad job id and a timeout all end in a plain outcome; a timeout never cancels the job", async () => {
  C.forgetPersonalProject();
  const failed = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: JOB, status: "QUEUED" }), get: async () => ({ status: "FAILED", error: { code: "BUDGET", message: "Daily AI allowance used." } }) });
  const f = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: failed, describeError: describe, sleep: noSleep });
  assert.deepEqual([f.kind, f.message], ["FAILED", "Daily AI allowance used."]);

  C.forgetPersonalProject();
  const badProject = fakeApi({ post: async () => ({ projectId: "../../etc" }), get: async () => ({}) });
  assert.equal((await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: badProject, describeError: describe, sleep: noSleep })).kind, "FAILED");
  assert.equal(badProject.calls.some((c) => c.p === "/api/v1/analysis"), false, "no analysis is started under an unexpected project");

  C.forgetPersonalProject();
  const badJob = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: "../x", status: "QUEUED" }), get: async () => ({}) });
  assert.equal((await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: badJob, describeError: describe, sleep: noSleep })).kind, "FAILED");

  C.forgetPersonalProject();
  let t = 0;
  const slow = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: JOB, status: "QUEUED" }), get: async () => ({ status: "PROCESSING" }) });
  const out = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: slow, describeError: describe, sleep: async () => { t += 60000; }, now: () => t, maxWaitMs: 120000 });
  assert.equal(out.kind, "TIMED_OUT");
  assert.ok(!slow.calls.some((c) => /cancel/i.test(c.p)), "waiting less never cancels the server-side job");
  assert.match(out.message, /may still finish/i);
});

test("runAnalysis: stopping the wait returns STOPPED, and one user's project id is never reused for another user", async () => {
  C.forgetPersonalProject();
  const ctl = new AbortController();
  const api = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: PRJ } : { jobId: JOB, status: "QUEUED" }), get: async () => ({ status: "PROCESSING" }) });
  const out = await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api, describeError: describe, sleep: async () => ctl.abort(), signal: ctl.signal });
  assert.equal(out.kind, "STOPPED");
  assert.ok(!api.calls.some((c) => /cancel/i.test(c.p)));

  C.forgetPersonalProject();
  const ids = { "uid-1": "prj_aaaaaaaaaaaaaaaaaa", "uid-2": "prj_bbbbbbbbbbbbbbbbbb" };
  let who = "uid-1";
  const api2 = fakeApi({ post: async (p) => (p === "/api/v1/projects/personal" ? { projectId: ids[who] } : { jobId: JOB, status: "COMPLETED", result: DONE_BODY }), get: async () => ({}) });
  await C.runAnalysis("uid-1", "doi:10.9999/x", "STANDARD", { api: api2, describeError: describe, sleep: noSleep });
  who = "uid-2";
  await C.runAnalysis("uid-2", "doi:10.9999/x", "STANDARD", { api: api2, describeError: describe, sleep: noSleep });
  const used = api2.calls.filter((c) => c.p === "/api/v1/analysis").map((c) => c.body.projectId);
  assert.deepEqual(used, [ids["uid-1"], ids["uid-2"]]);
});

// ------------------------------------------------------------------------------------------------ apiClient: Idempotency-Key
function client(fetchImpl) {
  return A.createApiClient({ baseUrl: "https://api.shords.test", waitForAuthReady: async () => "SIGNED_IN", getIdToken: async () => "TOKEN.a.b", fetchImpl });
}
const okRes = (b) => ({ status: 202, headers: { get: () => null }, text: async () => JSON.stringify(b) });

test("apiClient: an Idempotency-Key is sent as that header; the token stays the only Authorization; other headers are never accepted", async () => {
  const calls = [];
  const c = client(async (u, i) => { calls.push({ u, i }); return okRes({ ok: true }); });
  await c.post("/api/v1/analysis", { a: 1 }, { headers: { "Idempotency-Key": "key-1.A_b:2" } });
  assert.equal(calls[0].i.headers["Idempotency-Key"], "key-1.A_b:2");
  assert.equal(calls[0].i.headers.Authorization, "Bearer TOKEN.a.b");
  assert.equal(JSON.stringify(calls[0]).includes("key-1.A_b:2"), true);
  assert.equal(calls[0].u.includes("key-1"), false, "never in the URL");
  await c.post("/api/v1/analysis", { a: 1 }, { headers: { Authorization: "Bearer evil", "X-Other": "1", "Idempotency-Key": "k2" } });
  assert.equal(calls[1].i.headers.Authorization, "Bearer TOKEN.a.b");
  assert.equal(calls[1].i.headers["X-Other"], undefined);
});

test("apiClient: an invalid Idempotency-Key is refused before anything is sent", async () => {
  let sent = 0;
  const c = client(async () => { sent++; return okRes({}); });
  for (const bad of ["", "has space", "a".repeat(129), "semi;colon", "new\nline", 5]) {
    await assert.rejects(c.post("/api/v1/analysis", {}, { headers: { "Idempotency-Key": bad } }), (e) => e instanceof A.ApiError && e.kind === "INVALID_REQUEST");
  }
  assert.equal(sent, 0);
});

// ------------------------------------------------------------------------------------------------ display of the result
test("display: the server's confidence number never reaches the view; AI/no-AI and licence-withheld are carried through", () => {
  const body = { ...DONE_BODY, aiCalled: true, confidence: { level: "HIGH", score: 0.93, basis: "SERVER_COMPUTED_HEURISTIC" }, textPolicy: { evidenceText: "WITHHELD_BY_LICENSE", license: "cc-by-nc" }, paper: { paperId: "doi:10.9999/x", license: "cc-by-nc" } };
  const v = M.parseAnalysisForDisplay(body);
  assert.equal(v.aiUsed, true);
  assert.equal(v.textWithheld, true);
  const json = JSON.stringify(v);
  assert.equal(/0\.93|confidence|score|HEURISTIC/i.test(json), false, "no confidence anywhere in the view model");
  const local = M.parseAnalysisForDisplay({ ...DONE_BODY, aiCalled: false });
  assert.equal(local.aiUsed, false);
  assert.equal(local.textWithheld, false);
});

// ------------------------------------------------------------------------------------------------ source checks of the React files
const panel = read("components/research/AnalysisPanel.tsx");
const screen = read("app/paper/[id].tsx");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("paper screen: AnalysisPanel is on the paper screen; runAnalysis is called from exactly one place, and never from an effect or on mount", () => {
  assert.match(screen, /<AnalysisPanel paper=\{paper\} \/>/);
  const code = strip(panel);
  assert.equal((code.match(/runAnalysis\(/g) || []).length, 1, "one call site");
  // the call sits inside the `run` callback ...
  const runBlock = code.slice(code.indexOf("const run = useCallback"), code.indexOf("const stop = useCallback"));
  assert.match(runBlock, /await runAnalysis\(/);
  // ... which is only reachable through the buttons' onPress (onRun), never invoked directly, never from an effect
  assert.equal((code.match(/\brun\(\s*\)/g) || []).length, 0, "run() is never called directly");
  const effects = [...code.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g)].map((m) => m[0]).join("\n");
  assert.ok(effects.length > 0);
  assert.equal(/\brun\b|runAnalysis/.test(effects), false, "no effect starts an analysis");
  assert.match(code, /onPress=\{onRun\}/);
  assert.match(code, /onRun=\{run\}/);
  // the screen itself neither imports the client nor calls the API
  assert.equal(/analysisClient|runAnalysis/.test(strip(screen)), false);
});

test("AnalysisPanel: all words shown to the user avoid 'verified/accurate/guaranteed'-style claims and never mention confidence", () => {
  const FORBIDDEN = /\b(verified|verify|accurate|accuracy|guarantee[ds]?|proven|proof|certified|validated|trustworthy|reliable|correct|confidence)\b/i;
  for (const [k, v] of Object.entries(require(path.join(root, "services/evidenceModel.ts")).EVIDENCE_COPY)) {
    if (typeof v === "string") assert.equal(FORBIDDEN.test(v), false, `EVIDENCE_COPY.${k}`);
  }
  // ANALYSIS_COPY lives in the component file; read its strings from source
  const block = panel.slice(panel.indexOf("export const ANALYSIS_COPY"), panel.indexOf("} as const;", panel.indexOf("export const ANALYSIS_COPY")));
  const strings = [...block.matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.ok(strings.length >= 12);
  for (const s of strings) assert.equal(FORBIDDEN.test(s), false, s);
  assert.match(block, /Nothing runs until you press the button/);
  assert.equal(/\.confidence|\bscore\b/i.test(strip(panel)), false, "the panel never reads the confidence object");
});

test("AnalysisPanel: signed-out and no-identifier states offer no run button; the panel forgets results when the paper or user changes", () => {
  const code = strip(panel);
  assert.match(code, /!ref \? \{ kind: "NO_REF" \}/);
  assert.match(code, /status !== "SIGNED_IN" \|\| !uid \? \{ kind: "SIGNED_OUT" \}/);
  assert.match(code, /\[ref, uid\]\);/);
  assert.match(code, /clearEvidenceCache\(\)/);
  assert.match(code, /forgetPersonalProject\(\)/);
  // the button exists only in the IDLE / MESSAGE(retry) / DONE branches, not for SIGNED_OUT or NO_REF
  const signedOutBranch = code.slice(code.indexOf('state.kind === "SIGNED_OUT"'), code.indexOf('state.kind === "IDLE"'));
  assert.equal(/Pressable/.test(signedOutBranch), false);
});

test("copilot: when the server withheld excerpt text for licence reasons the answer says so and shows no excerpt text", () => {
  const MC = require(path.join(root, "services/copilotMapping.ts"));
  const body = { requestId: "req_1", verificationStatus: "UNVERIFIED", contentCoverage: "FULL_TEXT", answer: "An answer [c1].", paper: { paperId: "doi:10.1/x", title: "T", authors: [], year: 2020 }, evidence: [{ chunkId: "c1", paperId: "doi:10.1/x", section: "RESULTS", textAvailable: false, textWithheldReason: "LICENSE_DOES_NOT_ALLOW_SERVING_TEXT" }], textPolicy: { evidenceText: "WITHHELD_BY_LICENSE", license: "cc-by-nc" } };
  const r = MC.mapCopilotResponse(body, () => 0);
  assert.equal(r.evidence[0].text, "");
  assert.ok(r.limitations.some((l) => /licence does not clearly allow/.test(l)), JSON.stringify(r.limitations));
  const open = MC.mapCopilotResponse({ ...body, textPolicy: { evidenceText: "INCLUDED" } }, () => 0);
  assert.equal(open.limitations.some((l) => /licence does not clearly allow/.test(l)), false);
});
