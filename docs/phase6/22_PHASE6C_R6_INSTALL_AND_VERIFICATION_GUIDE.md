# Phase 6C r6 - install and verification guide (Windows PowerShell 5.1)

**Nothing here has been run by me. Steps 1-8 are read-only or confined to a temporary folder; none starts the model server, opens a port, sends a request or needs an approval phrase.** Use the r6 zip only; do not use r4 or r5 again (they stay untouched).

Expected zip SHA-256: `3e37d44219a964feb70110b3652651324ad85c12883139aa25264c157525eaca` (113,943 bytes, 28 files incl. the manifest).

## PART 1 - verify the package

```powershell
Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r6.zip            # must equal the value above
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r6.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6c-r6
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1        # expect: Kit verified: 27 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1       # expect: All 11 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1   # expect: no failures (the 26 gate tests pass; the count is higher than r5 by the new shape/outcome checks)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 # expect: 52 passed, 0 failed
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1      # NEW. expect: "Checks passed: 22   failed: 0"
```

If any step prints a problem: stop, paste the output, do not continue. **Do not start Part 2 before steps 4 and 5 are green** (in the r5 run the agent test failed and Dry Run A was started anyway; r6 makes that harmless, but the gate is still the rule).

### What the new `Test-FileOps.ps1` does (and does not)
Creates **one** new folder `%TEMP%\shords-6c-selftest-xxxxxxxx`, runs the real r6 functions against it, and removes it at the end (the single recursive delete is guarded: path inside `%TEMP%`, contains the test marker, exists). It checks: file replace create / replace / replace-again (the r5 crash), JSON replace, no leftover `.tmp-*` files, folder creation, lease rewritten 3x, audit lines, dry-run marker rewritten 3x with a `gate-failed` result not counting, and one dry-run inbox pass with signed `server-stop` and `health` jobs (only "planned"), a badly signed job (rejected `hmac`), a replayed job (rejected `replay`), seen-ids, archive/rejected moves. It records `llama-server` processes and listeners on 8080 before and after and requires them unchanged. It never touches `D:\llm`, starts no program, sends no request. It is newly written and itself unexecuted: if *it* misbehaves, report that - it is a test, and a bug in a test is a finding too.

## PART 2 - supervised dry run (separate approval; unchanged phrase)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096
```
Possible results (exit code in parentheses):
* All steps planned/ok -> `RESULT: ok.` (0)
* RAM below the gate (your 5.62 GiB case) -> `RESULT: REFUSED BY A RESOURCE GATE ...` listing `preflight: ram [available=5.62 need>=6.5]` (**5**). The report is written with `outcome: gate-refused`. Free RAM (close browsers etc.) and run again; do not change the gate.
* Anything else -> `RESULT: failed ...` (1), or `RESULT: the run stopped with an error: ...` (1) with the report still attempted.

Acceptance as before: `Get-Process llama-server -ErrorAction SilentlyContinue` prints nothing; `netstat -ano | findstr ":8080"` prints nothing; `jobs\audit.jsonl` has `run-start`/`run-end` and no "emergency" line.

## PART 3 - rollback
`.\Rollback-6C.ps1 -Scope All -List` then `.\Rollback-6C.ps1 -Scope All` (typed DELETE). Test-FileOps leaves nothing to roll back. Remove the kit by deleting `D:\llm\shords-pilot6c-r6` yourself.

`-Mode Live` remains **not authorised** by this package.
