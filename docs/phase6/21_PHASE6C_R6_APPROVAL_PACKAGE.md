# Phase 6C r6 - approval package / delivery for review (supersedes r5, 2026-11-04)

**Status:** built and tested in the cloud only. **Nothing was executed, installed, extracted, started or changed on your laptop; no HTTP request, no production/Railway/database access; no commit, push, merge or deployment; no Live approval requested.** Returned for your review first, as instructed. The r4 and r5 packages and trees were not modified.

## Deliverables
| Item | Value |
|---|---|
| Package | `shords-pilot6c-scripts-r6.zip`, 113,943 bytes, 28 files (27 + manifest) |
| **SHA-256** | `3e37d44219a964feb70110b3652651324ad85c12883139aa25264c157525eaca` (two independent builds identical) |
| Manifest | `MANIFEST.sha256.txt` inside the zip (SHA-256 of all 27 other files) |
| Root-cause analysis | `20_PHASE6C_R6_ROOT_CAUSE_ANALYSIS.md` |
| Source diff r5 -> r6 | `DIFF_r5_to_r6.patch` (858 lines; 12 files) |
| Install / verification guide | `22_PHASE6C_R6_INSTALL_AND_VERIFICATION_GUIDE.md` |
| Test report + negative controls | `23_PHASE6C_R6_TEST_REPORT.md` |
| Source listing | `SOURCE_LISTING_r6.txt`; changelog `CHANGELOG_r6.txt` |

## Minimal fixes (summary; details in doc 20 and the patch)
1. `Get-FailedCheckNames` / `Get-StartGateChecks`: `return ,$x` -> `return $x`; every caller wraps `@()` (runtime x5 incl. the sweep plan, tests). The 26 failing tests are untouched.
2. `Write-AtomicText`: `Replace($tmp,$Path,[NullString]::Value)` with a Copy fallback.
3. `Invoke-PilotRun.ps1`: try/catch/finally; new `Get-RunOutcome`; gate refusal -> clean RESULT text and **exit 5**; report carries `outcome`, `refused`, `error`.
4. `Pilot-Agent.ps1`: per-cycle try/catch with `cycle-error` audit and a 5-strike clean exit.
5. Version `r6.0` (older dry-run markers cannot unlock r6 Live). No gate number, allowlist, approval phrase, brake rule or Live guard was touched.

## Regression tests
* `Test-AgentLogic.ps1`: the 26 gate tests unchanged + `shape:*` (6) + `outcome:*` (5) checks. `Test-FileOps.ps1` (new, 22 checks, confined to one temp folder): file replace x3, lease/audit/marker rewrites, dry-run inbox pass with signed, badly signed and replayed jobs.
* Python: 47 -> 71 tests; analyser gained two rules that fire on the r5 tree; negative controls in doc 23 section D show each guard fails when the old code is restored.

## Evidence (cloud)
Clean extraction: manifest 27/27 OK; 71 Python tests OK; static analyser 0 findings; vectors regenerate byte-identically (243 cases); Node 22 and 24: 638 tests / 637 pass / 0 fail / 1 todo (unchanged baseline).

## Honest limit
**I cannot run Windows PowerShell 5.1.** The Windows results are yours: run the 5 verification steps in doc 22 (Verify-Kit, Parse-Check, Test-AgentLogic, Test-Orchestrator, Test-FileOps) and send me the output. Expect Dry Run A to give a clean exit-5 refusal until available RAM is at least 6.5 GiB.

## Requested decision
Review the package and diff. If you approve running the **read-only verification steps** (guide 22, Part 1) on your laptop, you can do so yourself; nothing in this package needs Live approval, and none has been requested.
