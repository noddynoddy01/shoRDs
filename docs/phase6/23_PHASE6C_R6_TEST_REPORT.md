# Phase 6C r6 - test report (cloud environment only)

**Environment:** Linux 6.18.44 (cloud container), Python 3.13, Node v22.23.4 and v24.22.1. **No Windows, no PowerShell of any version** (the sandbox refused to execute a downloaded PowerShell earlier; I did not work around that).

## A. Windows PowerShell 5.1 status

| Check | Status |
|---|---|
| Verify-Kit / Parse-Check / Test-Orchestrator on 5.1 x64 for **r5** | run by you: 25/25, 10/10, 52/0 |
| Test-AgentLogic for r5 | run by you: 481 passed / **26 failed** (fixed in r6) |
| Dry Run A for r5 | run by you: RAM gate refused correctly; then exception (fixed in r6) |
| **Any r6 script on Windows PowerShell 5.1** | **NOT RUN - unavailable to me.** First execution is yours (guide 22). |

Everything below is Python mirrors, source-text assertions, static analysis and conformance vectors. It is not equivalent to executing the PowerShell.

## B. Commands and results

```
# 1 build twice (determinism); the builder re-opens the zip, re-hashes every member against the manifest, checks the file set,
#   and runs the static analyser on the exact CRLF bytes that ship
$ python3 -I docs/phase6/pilot6c_r6/build_pilot6c.py shords-pilot6c-scripts-r6.zip
files: 28   zip bytes: 113943   zip sha256: 3e37d44219a964feb70110b3652651324ad85c12883139aa25264c157525eaca
(second build: identical SHA-256)

# 2 clean extraction of the final zip, manifest checked with an independent tool
$ python3 -c "zipfile.ZipFile(...).extractall('.')" ; tr -d '\r' < MANIFEST.sha256.txt > m.txt ; sha256sum -c m.txt     -> 27 OK, 0 failed
$ all .ps1/.txt/.py are ASCII; .ps1/.txt have CRLF line ends

# 3 Python suite from the EXTRACTED copy (CRLF bytes)
$ python3 -I tests/test_pilot6c.py                          -> Ran 71 tests (was 47; 24 new) - OK
# 4 vectors:    gen_vectors.py --check                      -> OK (243 cases, byte-identical)
# 5 static:     ps_static_check.py .                        -> findings: 0
# 6 Node:       npm run test:node  (Node v22.23.4)          -> 638 tests, 637 pass, 0 fail, 1 todo
#               npm run test:node  (Node v24.22.1)          -> 638 tests, 637 pass, 0 fail, 1 todo   (the one todo is the long-standing aiGatewayBoundary audit finding, unrelated)
# 7 r4 and r5 untouched: rebuilding their zips from their frozen trees reproduces
#               r5 777b7186da9267c144076e0bb3e766f6f3a74299bcf64cd394923fb3f8a56daf   r4 3c3e5a7fba3d199e727e6486901de34563b89baa5bfe88d18cfe1bb871b19b1e
```

## C. Regression tests for the exact failures

| Failure | Where it is covered | Platform |
|---|---|---|
| 26 gate tests return ArrayList | **unchanged** `gate:*` loop in `Test-AgentLogic.ps1` (26 vectors, `@(Get-FailedCheckNames $checks) -join ','`) + new `shape:*` checks: 9 items are hashtables, empty failure list is empty, one failure is the string `ram`, join is not `System.Collections.ArrayList`, detail text `available=5.62 need>=6.5`, three failures in order `ram,vram,disk` | Windows PowerShell 5.1 (yours to run) |
| same, in Python | model of the output-pipeline rule reproduces the r5 string and the r6 result; the 26 vectors checked against the oracle; every caller of the two functions must be `@(...)`; no `.Count` on an unwrapped function result; no `return ,x` anywhere | cloud (ran) |
| `File.Replace(..., $null)` | `Test-FileOps.ps1` writes the same file three times, plus JSON replace, lease x3, marker x3 | Windows PowerShell 5.1 (yours) |
| same, in Python | source must contain `[NullString]::Value`, Move for new files, Copy fallback; model of `$null -> ''` -> "path is not of a legal form"; no other .NET call passes `$null` | cloud (ran) |
| exception instead of clean refusal | `outcome:*` checks in `Test-AgentLogic.ps1` (exact owner scenario -> `gate-refused` with `preflight: ram [available=5.62 need>=6.5]`; ok; failed; failure wins; empty); Python twin `run_outcome`; orchestrator text: try/catch/finally, report in its own try/catch, `exit 5` once, RESULT line | both |
| agent loop | cycle try/catch, `cycle-error` audit, 5-strike clean exit | cloud text check; Test-FileOps runs the real `Invoke-InboxCycle` |

## D. Negative controls (the tests really fail on the old behaviour)

| Mutation | Result |
|---|---|
| analyser run on the **r5 tree** | 3 findings: `return ,$f` x2 in `Phase6C.Lib.ps1`, `$null` passed to `File.Replace` in `Phase6C.Runtime.ps1:57` |
| r6 with `return ,$f` restored | 2 failures (`test_no_function_returns_its_list_wrapped`, static analysis) |
| r6 with `Replace(..., $null)` restored | 3 failures (`test_replace_gets_a_real_dotnet_null`, `test_no_other_dotnet_call_in_the_package_passes_null`, static analysis) |
| r6 with refusal beating failure in `Get-RunOutcome` | 1 failure (`test_powershell_twin_and_its_test_agree_with_the_oracle`) |

## E. Residual risks

1. The PowerShell is unexecuted by me; r6 may carry a third runtime-only defect. That is why steps 1-8 precede any dry run and why `Test-FileOps.ps1` exists.
2. `Test-FileOps.ps1` is itself new and unexecuted. If your `%TEMP%` path contains a non-ASCII character it exits with code 2 and creates nothing.
3. Dry Run A will refuse again on RAM (5.62 < 6.5 GiB) until you free memory - that is the intended behaviour.
