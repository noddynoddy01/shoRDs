"use strict";
/**
 * The real-model pilot driver (scripts/native_pilot.js) run end to end against a LOCAL HTTP SERVER THAT IS NOT A LANGUAGE MODEL:
 * it speaks the same protocol as llama.cpp's server (/v1/chat/completions with usage, timings and hidden reasoning) but answers with the
 * deterministic extractive stub. What this proves: the CLI, the HTTP adapter path, the licence gate on papers, the refusal of non-local
 * servers, the measurement records and the rating sheets. It proves NOTHING about any model's quality, speed or cost, and the fictional
 * paper used here is not evidence of anything.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const F = require("./paperFixtures");
const { createStubAdapter } = require("../../native/modelAdapter");
const { numberCoverage, summarisePipeline, summariseDirect } = require("../../eval/pilotMetrics");
const { runNativePipeline } = require("../../native/pipeline");
const { fromStructured } = require("../../native/documentIntelligence");
const { extractJats } = require("../../papers/extract");
const { sectionsFromValidated } = require("../../eval/nativeCompare");

const SCRIPT = path.join(__dirname, "..", "..", "..", "scripts", "native_pilot.js");
const run = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { timeout: 120000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

function startFakeLlamaServer() {
  const stub = createStubAdapter();
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", async () => {
      if (req.method === "GET") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(req.url.includes("props") ? { default_generation_settings: { n_ctx: 8192 } } : { data: [{ id: "fake-model" }] })); }
      const j = JSON.parse(body);
      seen.push({ max_tokens: j.max_tokens, kwargs: j.chat_template_kwargs });
      const r = await stub.callMessages({ system: j.messages[0].content, user: j.messages[1].content, maxTokens: j.max_tokens });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: r.text, reasoning_content: "HIDDEN REASONING MUST NOT SURFACE" }, finish_reason: "stop" }], usage: { prompt_tokens: r.usage.inputTokens, completion_tokens: r.usage.outputTokens }, timings: { prompt_n: r.usage.inputTokens, prompt_ms: 100, prompt_per_second: 150, predicted_n: r.usage.outputTokens, predicted_ms: 100, predicted_per_second: 12.5 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}/v1` })));
}

const goodLicence = { spdx: "CC-BY-4.0", confirmedBy: "test-person", confirmedOn: "2026-11-05", sourceUrl: "https://example.org/paper", fullTextAllowed: true };

test("pilot driver: full run over HTTP records measurements, hides reasoning, and writes blinded B-vs-C sheets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-"));
  fs.writeFileSync(path.join(dir, "p1.xml"), F.jats());
  fs.writeFileSync(path.join(dir, "papers.json"), JSON.stringify({ papers: [
    { paperId: "test_protocol_paper_1", title: "Protocol test paper", file: "p1.xml", format: "jats", category: "protocol-test", licence: goodLicence },
    { paperId: "pap_fixture_x", title: "refused", file: "p1.xml", format: "jats", licence: goodLicence },
    { paperId: "test_nolicence", title: "x", file: "p1.xml", format: "jats", licence: { spdx: "CC-BY-4.0" } },
    { paperId: "test_nc", title: "x", file: "p1.xml", format: "jats", licence: { ...goodLicence, spdx: "CC-BY-NC-ND-4.0" } },
    { paperId: "test_notconfirmedfulltext", title: "x", file: "p1.xml", format: "jats", licence: { ...goodLicence, fullTextAllowed: false } },
    { paperId: "test_missingfile", title: "x", file: "nope.xml", format: "jats", licence: goodLicence }
  ] }));
  const { server, seen, base } = await startFakeLlamaServer();
  try {
    const out = path.join(dir, "out");
    const r = await run(["run", "--papers", path.join(dir, "papers.json"), "--base", base, "--model", "fake-model", "--out", out, "--limit", "3", "--headroom", "1500", "--reasoning-effort", "low", "--revision", "TESTREV", "--quant", "NONE", "--runtime", "fake-llama-server"]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const runJson = JSON.parse(fs.readFileSync(path.join(out, "run.json"), "utf8"));
    assert.deepEqual(runJson.skipped.map((s) => s.reason).map((x) => x.split("(")[0]), ["FICTIONAL_PAPER_NOT_ACCEPTED_AS_EVIDENCE", "LICENCE_NOT_CONFIRMED_BY_A_PERSON", "LICENCE_DOES_NOT_CLEARLY_ALLOW_EVALUATION_USE", "FULL_TEXT_NOT_CONFIRMED", "FILE_NOT_FOUND"]);
    assert.equal(runJson.meta.revision, "TESTREV");
    const recs = JSON.parse(fs.readFileSync(path.join(out, "records.json"), "utf8"));
    assert.equal(recs.length, 1);
    const [rec] = recs;
    assert.equal(rec.B.ok, true);
    assert.equal(rec.C.calls.failed, 0);
    assert.equal(rec.C.tokens.measured, true);
    assert.equal(rec.C.throughput.generatedTokensPerSecondMean, 12.5);
    assert.ok(rec.C.calls.total >= 20, `calls ${rec.C.calls.total}`);
    assert.equal(rec.C.numbers.ungroundedNumbers.length, 0);
    // headroom and reasoning effort reached the server
    assert.ok(seen.every((s) => s.max_tokens > 1500), JSON.stringify(seen.slice(0, 2)));
    assert.deepEqual(seen[0].kwargs, { reasoning_effort: "low" });
    // hidden reasoning never reaches any output file except nothing at all
    for (const f of ["records.json", "items.json", "REPORT.md", path.join("papers", "test_protocol_paper_1.json")]) assert.ok(!fs.readFileSync(path.join(out, f), "utf8").includes("HIDDEN REASONING"), f);
    const report = fs.readFileSync(path.join(out, "REPORT.md"), "utf8");
    assert.match(report, /Automatic measurements only/);
    assert.match(report, /Skipped papers/);
    // blinded sheets: both systems present, no system names
    const sheet = fs.readFileSync(path.join(out, "rating", "sheet_rater_a.csv"), "utf8");
    assert.ok(!/native_pipeline|open_weight|B_open|C_native|fake-model|claude/i.test(sheet));
    assert.ok(fs.existsSync(path.join(out, "rating", "key.json")));
    assert.ok(fs.existsSync(path.join(out, "raw", "test_protocol_paper_1.raw.json")));
  } finally { server.close(); }
});

test("pilot driver refuses a non-local model server, before contacting it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-"));
  fs.writeFileSync(path.join(dir, "papers.json"), JSON.stringify({ papers: [] }));
  for (const base of ["https://api.example.com/v1", "http://192.168.1.20:8080/v1", "http://127.0.0.1.evil.example/v1"]) {
    const r = await run(["run", "--papers", path.join(dir, "papers.json"), "--base", base, "--model", "m", "--out", path.join(dir, "o")]);
    assert.equal(r.code, 2, base);
    assert.match(r.stderr, /refused/);
  }
  const s = await run(["server", "--base", "https://api.example.com/v1", "--model", "m"]);
  assert.equal(s.code, 2);
});

test("pilot driver: server check reads what the local server reports and one measured generation", async () => {
  const { server, base } = await startFakeLlamaServer();
  try {
    const r = await run(["server", "--base", base, "--model", "fake-model"]);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.smoke.ok, true);
    assert.equal(j.props.default_generation_settings.n_ctx, 8192);
    assert.equal(j.smoke.serverTimings.generatedPerSecond, 12.5);
  } finally { server.close(); }
});

test("pilot driver: hardware probe reports this machine without needing a GPU or the network", async () => {
  const r = await run(["probe"]);
  assert.equal(r.code, 0, r.stderr);
  const hw = JSON.parse(r.stdout);
  assert.ok(hw.memory.totalGB > 0 && hw.cpu.logicalCores > 0);
  assert.ok(typeof hw.summary === "string" && hw.fit["gpt-oss-20b (MXFP4, ~12 GB weights)"]);
});

test("pilot metrics: number coverage separates numbers present in the brief from numbers that appear nowhere in the paper", () => {
  const chunks = [{ chunkId: "c1", section: "RESULTS", text: "Accuracy was 87.4 percent against 79.1 percent." }, { chunkId: "c2", section: "METHODOLOGY", text: "We used 12 layers." }];
  const sections = { inBrief: [{ text: "Accuracy was 87.4 percent and 55.5 percent.", evidence: ["c1"] }] };
  const n = numberCoverage(sections, chunks);
  assert.equal(n.sourceNumbers, 2);
  assert.equal(n.preservedInBrief, 1);
  assert.equal(n.coverage, 0.5);
  assert.deepEqual(n.ungroundedNumbers, ["55.5"]);
  assert.deepEqual(n.missingFromBrief, ["79.1"]);
});

test("pilot metrics: pipeline summary reads counts straight from the run (stub run, plumbing only)", async () => {
  const input = { paperId: "test_metrics", ...extractJats(F.jats()) };
  const r = await runNativePipeline({ model: createStubAdapter(), input, fullTextAllowed: true });
  const doc = fromStructured(input, { abstractOnly: false });
  const secs = sectionsFromValidated(Object.fromEntries(r.brief.map((s) => [s.key, s.statements])));
  const s = summarisePipeline(r, doc.chunks, secs);
  assert.equal(s.brief.statementsShown, r.validation.supported);
  assert.equal(s.calls.total, r.diagnostics.modelCalls);
  assert.equal(s.extraction.claimsKept, r.diagnostics.perCall.filter((c) => c.stage === "B").reduce((n, c) => n + (c.kept || 0), 0));
  assert.equal(s.costStatus, "MEASURED_OR_FREE_LOCAL");
  const d = summariseDirect({ ok: false, category: "UNPARSEABLE", call: {} }, doc.chunks, null, 5);
  assert.equal(d.ok, false);
  assert.equal(d.failure, "UNPARSEABLE");
});

test("pilot driver: --no-thinking asks the chat template for non-thinking mode (Qwen3-style models) and nothing else changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-nt-"));
  fs.writeFileSync(path.join(dir, "p1.xml"), F.jats());
  fs.writeFileSync(path.join(dir, "papers.json"), JSON.stringify({ papers: [{ paperId: "test_protocol_paper_nt", title: "Protocol test paper", file: "p1.xml", format: "jats", category: "protocol-test", licence: goodLicence }] }));
  const { server, seen, base } = await startFakeLlamaServer();
  try {
    const r = await run(["run", "--papers", path.join(dir, "papers.json"), "--base", base, "--model", "fake-model", "--out", path.join(dir, "out"), "--limit", "1", "--no-thinking"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(seen.length > 0);
    for (const s of seen) assert.deepEqual(s.kwargs, { enable_thinking: false });
  } finally { server.close(); }
});

test("pilot driver: `server` and `probe` create the output folder they are asked to write into", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-mk-"));
  const { server, base } = await startFakeLlamaServer();
  try {
    const out = path.join(dir, "not", "yet", "there", "server.json");
    const r = await run(["server", "--base", base, "--model", "fake-model", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(JSON.parse(fs.readFileSync(out, "utf8")).smoke.ok);
    const hw = path.join(dir, "also", "new", "hardware.json");
    const p = await run(["probe", "--out", hw]);
    assert.equal(p.code, 0, p.stderr);
    assert.ok(JSON.parse(fs.readFileSync(hw, "utf8")).summary);
  } finally { server.close(); }
});
