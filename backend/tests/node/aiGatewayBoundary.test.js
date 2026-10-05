"use strict";
/**
 * Architecture rule (docs/architecture/AI_GATEWAY_DESIGN.md, ADR-005): application code must never depend on Anthropic-specific
 * names or response structures outside the provider adapter. This test makes the rule executable.
 *
 * Today the rule is violated (audit finding C1), so the enforcement test is a `todo` that lists every violation; the control test
 * proves the scanner is not vacuous. When the gateway refactor lands the todo is removed and the rule becomes a hard CI check.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const ADAPTER_FILES = new Set(["llm/anthropicClient.js"]); // the only place Anthropic specifics may live
const SCAN_DIRS = ["llm", "jobs", "papers", "security", "data"];
const SCAN_FILES = ["app.js", "runtime.js", "readiness.js", "start_local_server.js"];
const PATTERNS = [
  [/\bEXTERNAL_CLAUDE\b/, "provider-specific mode literal"],
  [/\bANTHROPIC_[A-Z_]+/, "Anthropic environment variable"],
  [/["']anthropic["']/, "provider name literal"],
  [/\bstop_reason\b|\bcache_read_input_tokens\b|\bcache_creation_input_tokens\b/, "Anthropic response field"],
  [/require\(["'](?:\.\/(?:llm\/)?|\.\.\/(?:llm\/)?)anthropicClient["']\)/, "import of the adapter module by application code"]
];

function files() {
  const out = [...SCAN_FILES];
  for (const d of SCAN_DIRS) for (const f of fs.readdirSync(path.join(ROOT, d))) if (f.endsWith(".js")) out.push(`${d}/${f}`);
  return out.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function scan() {
  const hits = [];
  for (const f of files()) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments are not dependencies
      for (const [re, why] of PATTERNS) if (re.test(line)) hits.push({ file: f, line: i + 1, why, adapter: ADAPTER_FILES.has(f) });
    });
  }
  return hits;
}

test("control: the scanner sees the adapter's own Anthropic specifics (so an empty result elsewhere means something)", () => {
  const hits = scan().filter((h) => h.adapter);
  assert.ok(hits.length > 3, `only ${hits.length} hits inside the adapter: the scanner is not working`);
});

test("boundary: no Anthropic-specific name or response structure outside the provider adapter",
  { todo: "audit finding C1: several modules depend on Anthropic specifics today; fixed by the gateway refactor (ADR-005), which needs owner approval" },
  () => {
    const violations = scan().filter((h) => !h.adapter);
    const byFile = {};
    for (const v of violations) (byFile[v.file] = byFile[v.file] || []).push(`${v.line}:${v.why}`);
    assert.deepEqual(byFile, {}, `Anthropic-specific code outside the adapter:\n${Object.entries(byFile).map(([f, l]) => `  ${f}  ${l.slice(0, 4).join(", ")}${l.length > 4 ? ", ..." : ""}`).join("\n")}`);
  });
