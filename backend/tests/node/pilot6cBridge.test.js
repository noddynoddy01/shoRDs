"use strict";
/**
 * Phase 6C r8: file-mailbox automation bridge (docs/phase6/pilot6c_r8; the r4 tree docs/phase6/pilot6c is kept frozen as an archive and is not tested). No PowerShell exists in CI, so this runs the Python suite that
 * (1) checks the reference implementation against 243 conformance cases, (2) mirrors the PowerShell constants/orders against the oracle,
 * (3) asserts security properties on the PowerShell source text, (4) runs the static analyser, and (5) drives the submitter against a fake agent.
 * Only Test-AgentLogic.ps1 / the supervised dry-run on Windows PowerShell 5.1 proves the PowerShell behaviour itself.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DIR = path.join(__dirname, "..", "..", "..", "docs", "phase6", "pilot6c_r8");
const py = spawnSync("python3", ["--version"], { encoding: "utf8" });
const hasPython = !py.error && py.status === 0;

test("python suite for the Phase 6C bridge passes", { skip: !hasPython && "python3 not installed", timeout: 240000 }, () => {
  const r = spawnSync("python3", ["-I", path.join(DIR, "tests", "test_pilot6c.py")], { encoding: "utf8", timeout: 220000 });
  assert.equal(r.status, 0, (r.stderr || "") + (r.stdout || ""));
  assert.match(r.stderr + r.stdout, /OK/);
});

test("Phase 6C scripts are ASCII and contain no PowerShell-7-only operators", () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".ps1"))) {
    const text = fs.readFileSync(path.join(DIR, f), "utf8");
    assert.ok(/^[\x00-\x7f]*$/.test(text), `${f} must be ASCII`);
    const code = text.replace(/@'[\s\S]*?\n'@/g, "").replace(/<#[\s\S]*?#>/g, "").replace(/'[^'\n]*'/g, "").replace(/"[^"\n]*"/g, "").replace(/#.*$/gm, "");
    assert.ok(!/\?\.|\?\?|&&|\|\|/.test(code), `${f} must not use PowerShell 7-only operators`);
  }
});

test("nothing in the bridge can reach the network beyond loopback, install software or change persistence", () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".ps1"))) {
    // Phase6B.Common.ps1 is an unchanged r3 copy; it only *looks up* curl.exe (Get-Command) for Step C, which the bridge never runs.
    const code = fs.readFileSync(path.join(DIR, f), "utf8").replace(/<#[\s\S]*?#>/g, "").replace(/#.*$/gm, "").replace(f === "Phase6B.Common.ps1" ? /Get-Command 'curl\.exe'/g : /$^/, "");
    for (const bad of [/Invoke-WebRequest|Invoke-RestMethod|\bcurl\b|\bwget\b|Start-BitsTransfer|DownloadFile/i, /New-ScheduledTask|Register-ScheduledTask|schtasks/i,
      /Set-ItemProperty|New-ItemProperty|\breg(\.exe)?\s+add/i, /New-NetFirewallRule|netsh|Set-NetFirewall/i, /Set-ExecutionPolicy|Add-MpPreference|Set-MpPreference/i, /Install-Module|Install-Package|winget|choco\b/i]) {
      assert.ok(!bad.test(code), `${f} must not contain ${bad}`);
    }
  }
});
