"use strict";
/**
 * Phase 6B regression: the Windows path guard in docs/phase6/pilot6b/Phase6B.Common.ps1.
 * Reported failure: Step C refused the root folder D:\llm as "outside D:\llm" (the old check demanded the prefix "D:\llm\").
 * The PowerShell cannot run here (no PowerShell in CI). This test (1) runs the Python mirror of the guard against the same case table that
 * Test-PathGuard.ps1 contains (skipped when python3 is not installed) and (2) checks the PowerShell source statically.
 * Only Test-PathGuard.ps1 on Windows PowerShell 5.1 proves the PowerShell behaviour itself.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DIR = path.join(__dirname, "..", "..", "..", "docs", "phase6", "pilot6b");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const py = spawnSync("python3", ["--version"], { encoding: "utf8" });
const hasPython = !py.error && py.status === 0;

test("python mirror of the path guard passes the full case table (root, child, sibling prefix, traversal, case, links, UNC/device/ADS)", { skip: !hasPython && "python3 not installed" }, () => {
  const r = spawnSync("python3", ["-I", path.join(DIR, "tests", "test_pathguard_mirror.py")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stderr + r.stdout, /OK/);
});

test("PowerShell source: old prefix-only check is gone; segment-boundary compare, ordinal ignore-case and reparse check are present", () => {
  const c = read("Phase6B.Common.ps1");
  assert.ok(!/GetFullPath/.test(c.replace(/#.*$/gm, "")), "guard must not rely on GetFullPath");
  assert.ok(!/TrimEnd\('\\'\) \+ '\\'/.test(c), "old root+backslash prefix construction must not return");
  for (const t of ["function ConvertTo-CanonPath", "function Test-PathWithinRoot", "function Resolve-UnderRoot", "function Assert-UnderRoot", "OrdinalIgnoreCase", "ReparsePoint", "must not be a whole drive"]) {
    assert.ok(c.includes(t), t);
  }
});

test("every script that touches D:\\llm still calls the guard, and Step C preflight exercises it before any approval", () => {
  assert.ok((read("Step-C-Acquire.ps1").match(/Assert-UnderRoot/g) || []).length >= 3);
  assert.ok((read("Step-D-Run.ps1").match(/Assert-UnderRoot/g) || []).length >= 3);
  assert.ok((read("Rollback.ps1").match(/Assert-UnderRoot/g) || []).length >= 1);
  const c = read("Step-C-Acquire.ps1");
  const pre = c.slice(c.indexOf("if ($Action -eq 'Preflight')"), c.indexOf("if ($Action -eq 'Verify')"));
  assert.ok(pre.includes("Assert-UnderRoot"));
});

test("scripts stay ASCII with no PowerShell-7-only operators; the self-test ships in the zip builder", () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".ps1"))) {
    const text = read(f);
    assert.ok(/^[\x00-\x7f]*$/.test(text), `${f} must be ASCII`);
    const code = text.replace(/<#[\s\S]*?#>/g, "").replace(/'[^'\n]*'/g, "").replace(/"[^"\n]*"/g, "").replace(/#.*$/gm, "");
    assert.ok(!/\?\.|\?\?|&&|\|\|/.test(code), `${f} must not use PowerShell 7-only operators`);
  }
  assert.ok(read("build_pilot6b.py").includes("Test-PathGuard.ps1"));
});
