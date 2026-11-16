"use strict";
/**
 * Static wiring check for the AI spend gate (P0). Reads the real source files; no network, no database.
 *
 * Why: the gate (backend/llm/aiBudget.js) only protects calls that go through `budget.guardClient`. A module that reaches the provider client
 * some other way would spend money with no kill switch, ceiling or reservation. An unused wrapper that did exactly that
 * (backend/llm/runCopilot.js) existed until Phase 3; this test makes sure no such path is reintroduced silently.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "tests" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const src = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const files = walk(ROOT);

test("only the known modules take the provider's callMessages, and only the pipeline calls the two handlers", () => {
  const importsClient = files.filter((f) => /require\(["'][^"']*anthropicClient["']\)/.test(src(f))).map(rel).sort();
  assert.deepEqual(importsClient, ["assistant/service.js", "llm/aiBudget.js", "llm/aiPipeline.js", "llm/copilotService.js", "llm/intelligence.js", "readiness.js"],
    "a new module imports the provider client: it must go through budget.guardClient, then be added here on purpose");
  const callers = (name) => files.filter((f) => new RegExp(`\\b${name}\\(`).test(src(f)) && !new RegExp(`function ${name}\\(`).test(src(f))).map(rel);
  // readiness.js imports only the model *probe* (GET /v1/models/<model>: a metadata lookup that uses no tokens), never callMessages
  const readiness = src(path.join(ROOT, "readiness.js"));
  assert.equal(/\bcallMessages\b/.test(readiness), false, "readiness must not generate text");
  assert.deepEqual(callers("handleCopilotQuery"), ["llm/aiPipeline.js"]);
  assert.deepEqual(callers("handleIntelligence"), ["llm/aiPipeline.js"]);
});

test("no module talks to the provider host directly except the adapter", () => {
  const hosts = files.filter((f) => /api\.anthropic\.com/.test(src(f))).map(rel);
  assert.deepEqual(hosts, ["llm/anthropicClient.js"]);
});

test("the production runtime always hands the spend gate to the pipeline, and every call in the pipeline uses the bound client", () => {
  const runtime = src(path.join(ROOT, "runtime.js"));
  assert.match(runtime, /const budget = overrides\.budget \|\| createAiBudget\(/);
  assert.match(runtime, /createAiPipeline\(\{[^}]*\bbudget\b[^}]*\}\)/);
  const pipeline = src(path.join(ROOT, "llm/aiPipeline.js"));
  assert.match(pipeline, /budget\.guardClient\(/);
  const uses = pipeline.match(/client: clientFor\(ctx\)/g) || [];
  assert.equal(uses.length, 2, "both model calls (question, analysis) must use clientFor(ctx)");
  assert.equal(/\bclient: client\b/.test(pipeline), false, "no call may pass the raw client");
});

test("the shoRDs Assistant reaches the provider only through the spend gate and always records the call", () => {
  const svc = src(path.join(ROOT, "assistant/service.js"));
  assert.match(svc, /budget\.guardClient\(/, "the client is wrapped by the gate");
  assert.equal((svc.match(/\.callMessages\(/g) || []).length, 1, "exactly one provider call site");
  assert.match(svc, /guarded\(uid\)\.callMessages\(/, "and it uses the bound client, never the raw one");
  assert.equal(/\bclient\.callMessages\(/.test(svc.replace(/guarded\(uid\)\.callMessages\(/g, "")), false, "no raw client call");
  assert.match(svc, /ledger\.record\(/, "every call is accounted for in ai_usage");
  const runtime = src(path.join(ROOT, "runtime.js"));
  assert.match(runtime, /createAssistantService\(\{[^}]*\bbudget\b[^}]*\bledger\b[^}]*\}\)/, "the runtime hands the gate and the ledger to the assistant");
});

test("control: the scanner is not vacuous", () => {
  assert.ok(files.length > 20);
  assert.ok(files.map(rel).includes("llm/aiBudget.js"));
});
