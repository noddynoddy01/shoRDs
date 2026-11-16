# Phase 6C r7 - test report (2026-11-04)

**Read this first.** Windows PowerShell 5.1 is **not available** in my environment (the sandbox declined to run a downloaded PowerShell and I did not work around it). Everything below marked *executed* ran here, on Linux, in Python and Node. **No r7 PowerShell script has been executed by me**, so r7 Windows compatibility is **unverified until you run the commands in the install guide**.

## 1. Package

| Item | Value |
|---|---|
| File | `shords-pilot6c-scripts-r7.zip` |
| Size | 134,048 bytes |
| SHA-256 | `b986af0094c5445772b5c88c176b71190ef15bb7bc8fabf40259c34353742a9d` |
| Contents | 30 archive entries = 29 manifest entries + `MANIFEST.sha256.txt` (r6: 28) |
| New / changed vs r6 | new `vectors/marker-vectors.json`, `CHANGELOG_r7.txt`; changed `Phase6C.Lib.ps1`, `Phase6C.Runtime.ps1`, `Pilot-Agent.ps1`, `Invoke-PilotRun.ps1`, `Test-AgentLogic.ps1`, `Test-FileOps.ps1`, `README_FIRST.txt`, `build_pilot6c.py`, `linux/pilot_core.py`, `linux/gen_vectors.py`, `tests/test_pilot6c.py` |
| Unchanged vs r6 (byte-identical) | `Phase6B.Common.ps1`, `Parse-Check.ps1`, `Verify-Kit.ps1`, `Test-Orchestrator.ps1`, `Rollback-6C.ps1`, `linux/pilot_submit.py`, `tests/ps_static_check.py`, `CHANGELOG_r5/r6.txt`, eight older vector files |

## 2. Executed here

| # | Check | Result |
|---|---|---|
| 1 | Deterministic build: ZIP built twice from the same tree | **identical**: both 134,048 bytes, SHA-256 `b986af0094c5445772b5c88c176b71190ef15bb7bc8fabf40259c34353742a9d` |
| 2 | ZIP reopened (fresh extraction): every manifest entry vs the archived bytes (`sha256sum -c`, CRLF stripped) | **29/29 OK**, 0 mismatches; manifest file set == archive file set (no extra, no missing) |
| 3 | Python reference + mirror + marker tests, run **from the extracted copy** | **97 tests, OK, 0 failures** (r6: 71; +26 new) |
| 4 | Static analyser (`ps_static_check.py`, rules: no `return ,x`, no `$null` into .NET static methods, parameter/script-scope collisions, ASCII, no PS7-only operators) over all r7 scripts | **0 findings** |
| 5 | Cross-language conformance vectors regenerated from the Python oracle and compared (`gen_vectors.py --check`) | **exit 0**: all nine vector files current; the eight pre-existing files regenerate byte-identically; `marker-vectors.json` 54,765 bytes: 12 sequences, 64 steps, 6 problem cases |
| 6 | Node 22.23.4 `npm run test:node` | **638 tests, 637 pass, 0 fail, 0 cancelled, 1 todo** (same as the baseline) |
| 7 | Node 24.22.1 `npm run test:node` | **638 tests, 637 pass, 0 fail, 0 cancelled, 1 todo** |
| 8 | Negative controls (section 4) | **7/7 mutants detected** |
| 9 | r4, r5, r6 untouched: rebuilt from their (unmodified) source trees | reproduce the delivered hashes: r6 `3e37d442...eaca`, r5 `777b7186...6daf`, r4 `3c3e5a7f...b1e` |

### The 26 new Python tests (97 = 71 r6 + 26)
* `R7MarkerBehaviour` (14): runs the **supplied audit sequence** (10 accepted jobs, 9 rejections, the 9th = replay at `15:57:46Z`, lease end, 8 types) through a Python model of the agent with the **r6 policy** (reproduces `rejected_seen 8`, `last_utc 15:57:42Z`, no end marker) and the **r7 policy** (9, `15:57:46Z`, `ended`, `lease-ended`, 10 done); 8 rejections give 8 and 9 give 9; the replay is included; `last_utc` and `event_seq` advance after the final rejection even within the same second; the marker is written on lease expiry, STOP file, cycle-errors and Ctrl+C (`aborted`, not `lease-ended`); a previous run's marker is detected by `run_id` and does not feed its counters into the next run; types and `first_utc` survive across runs of one version but not across versions; all eight types are kept; a failed write is counted and audited, and a read-back mismatch is flagged; vectors match the oracle.
* `R7MarkerSource` (10): the PowerShell source text itself: every call site (start, accepted job, reject, end) exists in the right order; shutdown order is audit -> marker -> read-back -> lease; the writer is `Write-AtomicJson` under the path guard; the update function is silent, atomic-safe and failure-aware; exit code 6 paths; `Pilot-Agent` initial `$exitReason` is `aborted`; existing audit fields unchanged and the new ones additive; `Test-DryRunMarker` (the Live gate) unchanged.
* `R7WindowsTestScript` (2): `Test-FileOps.ps1` still contains all 21 r6 check names plus the new marker checks and the exact numbers 8, 9, locked-file failure; `Test-AgentLogic.ps1` consumes `marker-vectors.json`.
* r6 tests that had to change: three assertions only (version string `r7.0`; the `Write-AtomicJson $p $next` needle after the rewrite of the update function). No r6 security assertion (HMAC, replay, allowlist, strict JSON, parameter validation, resource gates, loopback, API key, brake, lease, kill-on-close, path guard) was weakened.

## 3. Not executed (unverified until you run it on Windows PowerShell 5.1)

| Item | Why unverified | How you verify |
|---|---|---|
| All 11 r7 scripts parse | no PowerShell here | `Parse-Check.ps1` (expect 11/11) |
| `Test-AgentLogic.ps1` (expect 592 / 0) | not run; it calls the new PowerShell `Get-NextMarker` / `Get-MarkerProblem` | run it; compare with the vectors |
| `Test-FileOps.ps1` (expect 46 / 0) | not run; the 24 new checks are exactly the part that touches real files, a locked file, JSON round trips and real time stamps | run it |
| `Test-Orchestrator.ps1` (expect 52 / 0) | not run (script and its target parameter blocks are unchanged except for the version/marker code beyond the `param` blocks) | run it |
| `finally` + Ctrl+C behaviour, closed window = `running` | PowerShell runtime behaviour | optional Ctrl+C check in the install guide |
| Whole Dry Run A / B, battery | needs Windows | owner supervised run, after your approval |
| Real file-lock error text and `Write-AtomicJson` fallback on a locked file | .NET on Windows | Test-FileOps (locked-file case) |
| Expected check totals 592 and 46 | derived by counting | Test-* output |

Risk areas I know remain open for first execution: (a) PowerShell 5.1 details in the new code (case-insensitive variable names - I avoided `$endReason`/`$EndReason` clashes - `ConvertFrom-Json` possibly turning ISO strings into dates, which `Format-MarkerTime` handles; the static analyser and mirrors cover the known r4/r5/r6 pitfall classes but cannot prove a runtime); (b) the new Test-FileOps locked-file test relies on `[System.IO.File]::Open(..., FileShare.None)` making `Write-AtomicJson` fail; if the fallback copy succeeds anyway on your machine, that single check would fail - which would be a test finding, not a product defect.

## 4. Negative controls (do the new checks catch the r6 behaviour?)

Each mutant is a copy of the r7 tree with one targeted change; the full Python suite, `gen_vectors.py --check` and the static analyser were run on it. A mutant is "detected" when at least one check fails.

| Mutant | What it reintroduces | Detected by |
|---|---|---|
| m1 no-marker-on-reject | **the r6 defect itself**: no marker write in the reject branch | `test_accepted_and_rejected_jobs_both_update_the_marker` |
| m2 no-end-marker | no final marker at shutdown | `test_agent_ends_the_marker_on_every_exit_path` |
| m3 silent-marker-failure | marker error neither counted nor audited | `test_update_function_is_atomic_safe_silent_and_failure_aware`, `test_existing_audit_event_fields_are_unchanged_and_new_ones_additive` |
| m4 ctrl-c-as-lease-ended | r6 exit-reason bug (initial `lease-ended`) | `test_agent_ends_the_marker_on_every_exit_path` |
| m5 stale-run-counts-as-same-run | an old run's marker continues the new run | `test_lib_twin_mirrors_the_python_oracle` |
| m6 python-seq-never-advances | `event_seq` stuck (no proof the marker moved) | `test_marker_timestamp_and_sequence_advance_after_the_final_rejection`, `test_vectors_are_current` |
| m7 readback-removed | no verification after the final write | `test_shutdown_routine_order` |

Result: **7/7 detected**, each with 1-2 failing tests; the static analyser reported 0 findings on all mutants (expected: they are logic mutants, not style errors). The Python agent model with the r6 policy additionally reproduces the exact r6 numbers, so the r6 behaviour is reproduced, not just asserted.

## 5. Security analysis (static, cloud-side)

* No new job type, parameter, permission, network call, process start, registry/firewall/Defender/scheduled-task action, or credential handling. The marker file contains only counters, UTC times, job-type names, schema/version and the run id (no key, no job content, no path, no measurement).
* The marker is written only by `Update-DryRunMarker` with `Write-AtomicJson` (temp file + replace + fallback), inside the path guard, to `jobs\dryrun-complete.json`; the guard's rules were not changed.
* Failure mode is fail-loud: a failed write or a read-back mismatch is audited (`marker-error`), shown in the lease, printed, and gives exit code 6. A job's accepted/rejected outcome, HMAC, replay check and archive move are unaffected by a marker error (the update function never throws into the cycle; r6's behaviour of a marker error aborting the cycle with the file stuck in `work\` is gone).
* Live gate: `Test-DryRunMarker` is unchanged and still requires an `agent_version`-bound marker with the required types and age under 7 days. It does **not** require `state = ended`; I kept it as is on purpose (no change of gate semantics in a reporting fix). The new fields give you the means to require it later if you want.
* A run killed without `finally` (window closed, process killed, power loss) leaves `state = running`. That is intentional and visible.
* Static analyser: 0 findings. No finding was suppressed.

## 6. Documentation nits (not safety-relevant)
* `README_FIRST.txt` still says "243 cross-language conformance cases" in its status paragraph; r7 adds 70 marker cases (64 steps + 6 problem cases). Text only. I left it rather than change the hashed package after the final build; I can correct it in a later revision if you want one.
