# Phase 6C r8 - test report (2026-11-04)

**Read this first.** Windows PowerShell 5.1 is **not available** to me. Everything marked *executed* ran on Linux (Python, Node). **No r8 PowerShell script has been executed by me**; r8 Windows compatibility is **unverified until you run the commands in the install guide**. For reference, the r7 results you reported were: Verify-Kit 29/29, Parse-Check 11/11, Test-AgentLogic 592/0, Test-Orchestrator 52/0, Test-FileOps 44/2.

## 1. Package
| Item | Value |
|---|---|
| File | `shords-pilot6c-scripts-r8.zip` |
| Size | 139,652 bytes |
| SHA-256 | `a2ef4c93fe32bae92aafd8491348fe7eaf30d02885a91fabaf92a41b10172bfa` |
| Contents | 31 archive entries = 30 manifest entries + `MANIFEST.sha256.txt` (r7: 30 entries / 29) |
| Changed vs r7 | `Phase6C.Runtime.ps1` (Add-Audit guard; two marker-error call sites), `Phase6C.Lib.ps1` (version), `Test-FileOps.ps1`, `linux/pilot_core.py`, `tests/ps_static_check.py`, `tests/test_pilot6c.py`, `README_FIRST.txt`, `build_pilot6c.py`, `vectors/marker-vectors.json` (version string only); new `CHANGELOG_r8.txt` |
| Byte-identical to r7 | `Phase6B.Common.ps1`, `Pilot-Agent.ps1`, `Invoke-PilotRun.ps1`, `Test-AgentLogic.ps1`, `Test-Orchestrator.ps1`, `Parse-Check.ps1`, `Verify-Kit.ps1`, `Rollback-6C.ps1`, `linux/pilot_submit.py`, `linux/gen_vectors.py`, `CHANGELOG_r5/r6/r7.txt`, eight older vector files |
| Manifest | `MANIFEST.sha256.txt` inside the zip (30 lines, SHA-256 + path) |

## 2. Executed here
| # | Check | Result |
|---|---|---|
| 1 | Deterministic build: zip built twice | **identical**: both 139,652 bytes, SHA-256 `a2ef4c93fe32bae92aafd8491348fe7eaf30d02885a91fabaf92a41b10172bfa` |
| 2 | Zip reopened (fresh extraction), every manifest entry vs archived bytes | **30/30 OK**, 0 mismatches; manifest file set == archive file set |
| 3 | Python suite from the extracted copy | **105 tests, OK, 0 failures** (r7: 97; +8 in `R8AuditRecord`) |
| 4 | Static analyser incl. the new Add-Audit rule, all r8 scripts | **0 findings** |
| 5 | Same analyser on the **r7** tree (negative control for the rule) | **2 findings**: Phase6C.Runtime.ps1:876 and :892 (the two r7 `event =` calls) |
| 6 | Conformance vectors (`gen_vectors.py --check`) | exit 0; only `marker-vectors.json` differs from r7 (agent_version string) |
| 7 | Node 22.23.4 `npm run test:node` | **638 tests, 637 pass, 0 fail, 0 cancelled, 1 todo** |
| 8 | Node 24.22.1 `npm run test:node` | **638 tests, 637 pass, 0 fail, 0 cancelled, 1 todo** |
| 9 | r7, r6, r5, r4 untouched: rebuilt from their unmodified trees | r7 `b986af00...2a9d`, r6 `3e37d442...eaca`, r5 `777b7186...6daf`, r4 `3c3e5a7f...b1e`: **all reproduce** |
| 10 | Negative controls (section 4) | **8/8 detected** (one needed a stronger test first) |

### New tests (97 -> 105)
`R8AuditRecord` (8): the unguarded Python model reproduces the Windows result for both r7 calls (event `start` / `verify`); the r8 record keeps `marker-error` plus `marker_event`; the guard stores `event`/`TS`/`mode` (any case) as `data_*`; the agent model's failed-write and stale read-back audits are named `marker-error`; no production `Add-Audit` uses a reserved key; the analyser rule fires on the r7 lines and on `Mode`/`TS` and not on `marker_event`/`data_event`/`events`; the `Add-Audit` source has the guard and an unchanged field order and error handling; the Windows script parses audit lines, contains the exact reserved-key call and its expected `data_*` results, and no longer text-matches the two failing checks. Three existing assertions changed (version `r8.0` x2; marker-error call text) - no security assertion was weakened.

## 3. Not executed (unverified until you run it on Windows PowerShell 5.1)
| Item | Expectation | Note |
|---|---|---|
| Verify-Kit | `Kit verified: 30 files match the manifest.` | hash check; I verified the same manifest with sha256sum |
| Parse-Check | 11/11 | no PowerShell here; only my static analyser |
| Test-AgentLogic | 592 / 0 | script unchanged; vectors differ only by the version string |
| Test-Orchestrator | 52 / 0 | script unchanged |
| Test-FileOps | **47 / 0** | counted: 48 `Check` literals minus `unexpected-exception`. **The 47 and the three changed/new audit checks are untested on PowerShell.** |

Residual PowerShell-5.1 risks in the new code, stated plainly: (a) the guard relies on `-ieq`, `[ordered]` key assignment and string concatenation - all long-standing 5.1 features, but unexecuted; (b) the parsing helper `Get-AuditObjects` relies on `$line | ConvertFrom-Json` emitting one object per audit line and on `ConvertFrom-Json` handling the escapes 5.1's `ConvertTo-Json` produces (`\u0027` for an apostrophe in the Windows error text); the passing r7 checks already read audit lines with ConvertFrom-Json (`audit:two-json-lines`), so I expect this to hold; (c) **I derived the root cause from your summary and the source, not from the raw output.** The cause is the only one in the code that explains both failures and every passing check, but if the next run shows a different audit tail, that is new information.

## 4. Negative controls (does the suite catch the r7 behaviour?)
| Mutant of r8 | Reintroduces | Detected by |
|---|---|---|
| n1 | r7 call in Update-DryRunMarker (`event =`) | 4 Python tests + analyser (1 finding, line 884) |
| n2 | r7 call in Confirm-DryRunMarker | 4 Python tests + analyser (1 finding) |
| n3 | **exact r7**: both calls, no guard | 6 Python tests + analyser (2 findings) |
| n4 | guard ignores `mode` | `test_add_audit_source_has_the_guard...` |
| n5 | guard case-sensitive | same test |
| n6 | Test-FileOps back to text matching | `test_file_ops_checks_parse_the_audit_lines` |
| n7 | Test-FileOps without the reserved-key call | **first run: NOT detected** (my test only checked the check name). Test strengthened (exact call and data_* expectations); re-run: detected |
| n8 | Python twin unguarded | `test_guard_renames_reserved_data_keys_in_any_case` |

## 5. Security analysis (static)
* No new job type, parameter, permission, process start, network call, or credential handling. HMAC, replay, allowlist, strict JSON, parameter validation, resource gates, loopback, API-key handling, emergency shutdown, lease expiry, kill-on-close, path guard and the Live gate are unchanged (the only runtime source changes are in `Add-Audit` and two `Add-Audit` argument names). `test_api_key_never_logged` still passes.
* `Add-Audit` change: only keys named `ts`/`event`/`mode` are renamed; every other key is copied as before; its failure handling is unchanged (an audit failure never throws into the job loop). No existing call used such a key apart from the two fixed ones.
* Analyser: 0 findings, none suppressed.

## 6. Remaining limitations
* Everything in section 3 is unverified on Windows.
* The Live gate does not require `state: ended` (unchanged by design). Closing the window leaves `state: running` (by design).
* Existing audit files written by r7 runs (if any) may contain `marker-error` lines named `start` / `verify`; r8 does not rewrite history.
