"use strict";
/** Benchmark raw-output capture: off by default, refuses deployed environments, keeps no user data, keeps text only for evaluation-cleared licences. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadRawCaptureConfig, createRawCapture, RawCaptureConfigError } = require("../../eval/rawCapture");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rawcap-"));

test("disabled by default: no variable, no capture; nothing is created", () => {
  assert.equal(loadRawCaptureConfig({}), null);
  assert.equal(loadRawCaptureConfig({ NODE_ENV: "production", DATABASE_URL: "x" }), null);
});

test("enabling needs the flag to be exactly 1 AND an absolute directory", () => {
  const dir = path.join(tmp(), "cap");
  assert.deepEqual(loadRawCaptureConfig({ BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: dir }), { dir });
  for (const bad of [{ BENCHMARK_RAW_CAPTURE: "true", BENCHMARK_RAW_CAPTURE_DIR: dir }, { BENCHMARK_RAW_CAPTURE: "0", BENCHMARK_RAW_CAPTURE_DIR: dir }, { BENCHMARK_RAW_CAPTURE_DIR: dir }, { BENCHMARK_RAW_CAPTURE: "1" }, { BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: "relative/dir" }, { BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: "bad\u0000dir" }]) {
    assert.throws(() => loadRawCaptureConfig(bad), RawCaptureConfigError, JSON.stringify(bad));
  }
});

test("refused in anything that looks like a deployment, even when everything else is right", () => {
  const ok = { BENCHMARK_RAW_CAPTURE: "1", BENCHMARK_RAW_CAPTURE_DIR: path.join(tmp(), "cap") };
  for (const extra of [{ NODE_ENV: "production" }, { NODE_ENV: "Production" }, { RAILWAY_ENVIRONMENT: "production" }, { RAILWAY_PROJECT_ID: "x" }, { VERCEL: "1" }, { KUBERNETES_SERVICE_HOST: "10.0.0.1" }]) {
    assert.throws(() => loadRawCaptureConfig({ ...ok, ...extra }), /refused/, JSON.stringify(extra));
  }
  assert.ok(loadRawCaptureConfig({ ...ok, NODE_ENV: "development" }));
  assert.ok(loadRawCaptureConfig({ ...ok, NODE_ENV: "test" }));
});

const entry = (license) => ({
  paper: { paperId: "doi:10.9999/fixture", title: "A fictional paper", license, doi: "10.9999/fixture", sourceUrl: "https://example.test/p" },
  chunks: [{ chunkId: "doi:10.9999/fixture_chunk_1", section: "RESULTS", text: "Accuracy was 87.4 percent." }],
  requestId: "req_int_1_abc", promptVersion: "2026.3-intel", schemaVersion: 2, model: "claude-sonnet-5-5", depth: "STANDARD", stopReason: "end_turn", truncated: false,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, costUsd: 0.001, costStatus: "ESTIMATED",
  rawText: '{"findings":{"text":"CANARY raw text","evidence":["doi:10.9999/fixture_chunk_1"]}}', modelOutput: { findings: { text: "CANARY raw text", evidence: ["doi:10.9999/fixture_chunk_1"] } },
  // fields that must never reach disk even if a caller passed them by mistake
  uid: "user-123", tenantId: "tenant_x", projectId: "prj_x", jobId: "job_x", ip: "1.2.3.4"
});

test("a cleared licence: text and raw output are kept in a private file with no user data", () => {
  const dir = path.join(tmp(), "cap");
  const cap = createRawCapture({ dir });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const r = cap.record(entry("cc-by"));
  assert.equal(r.written, true);
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
  const j = JSON.parse(fs.readFileSync(r.file, "utf8"));
  assert.equal(j.textKept, true);
  assert.equal(j.rawText.includes("CANARY"), true);
  assert.equal(j.chunks[0].text, "Accuracy was 87.4 percent.");
  assert.equal(j.paper.license, "cc-by");
  const all = fs.readFileSync(r.file, "utf8");
  for (const forbidden of ["user-123", "tenant_x", "prj_x", "job_x", "1.2.3.4", "uid", "tenantId", "projectId"]) assert.equal(all.includes(forbidden), false, forbidden);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "no half-written file is left behind");
});

test("a licence that does not clearly allow an evaluation set: metadata only, no paper text, no raw output", () => {
  for (const lic of ["cc-by-nc", "cc-by-nd", "publisher-specific-oa", null, "all-rights-reserved"]) {
    const cap = createRawCapture({ dir: path.join(tmp(), "cap") });
    const r = cap.record(entry(lic));
    const text = fs.readFileSync(r.file, "utf8");
    const j = JSON.parse(text);
    assert.equal(j.textKept, false, String(lic));
    assert.ok(j.reason);
    assert.equal(text.includes("87.4"), false);
    assert.equal(text.includes("CANARY"), false);
    assert.equal(j.chunks, undefined);
    assert.equal(j.rawText, undefined);
  }
});
