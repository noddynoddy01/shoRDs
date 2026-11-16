# Phase 6C r8 - install and verification guide (Windows PowerShell 5.1)

**Nothing here has been run by me, and I did not execute, install or extract anything on your laptop.** All steps below are read-only or confined to a temporary folder; none starts the model server, opens a port, sends a request or needs an approval phrase. **I am not asking you to run Dry Run A, Dry Run B or Live**, and r8 does not authorise them. Use the r8 zip only; r7, r6, r5 and r4 stay untouched and must not be used again.

Expected zip SHA-256: `a2ef4c93fe32bae92aafd8491348fe7eaf30d02885a91fabaf92a41b10172bfa` (139,652 bytes; 31 archive entries = 30 manifest entries + the manifest itself).

## Verify the package

```powershell
Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r8.zip            # must equal the value above
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r8.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6c-r8
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1        # expect: Kit verified: 30 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1       # expect: All 11 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1   # expect: Checks passed: 592   failed: 0   (same as r7)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 # expect: 52 passed, 0 failed (script unchanged)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1      # expect: Checks passed: 47   failed: 0   (r7: 46 checks, 44 passed)
```
The 47 is **counted from the source** (r7's 46 + the new `audit:reserved-data-keys-do-not-rename-the-event`), not observed. Any non-zero `failed` or any `FAIL` line: stop and paste the output. For the audit checks the `FAIL` line now includes the audit tail (the last lines of the temporary audit file) as evidence.

### What to look at if Test-FileOps still reports a problem
* `marker:failed-write-is-audited` prints `marker-error lines N; tail: ...`: N must be 1 and the tail must show `"event":"marker-error"` with `"marker_event":"start"`.
* `marker:read-back-flags-the-stale-marker` prints `marker errors 2; verify lines 1`: the verify line must show `"event":"marker-error","marker_event":"verify","error":"run-id"`.
* `audit:reserved-data-keys-do-not-rename-the-event` prints the audit line it produced.

### What is the same / different from r7
Same: everything outside `Add-Audit` and the two `marker-error` calls; Test-AgentLogic (592) and Test-Orchestrator (52) are byte-identical scripts; the marker, lease and all other audit events are unchanged. Different: the audit event `marker-error` now carries `marker_event` (r7 documented `event`, which collided with the record's own field); `Add-Audit` renames data keys `ts`/`event`/`mode` to `data_*`; version `r8.0`.

## Rollback
`.\Rollback-6C.ps1 -Scope All -List` then `.\Rollback-6C.ps1 -Scope All` (typed DELETE) removes only pilot state under D:\llm; Test-FileOps leaves nothing behind (its temporary folder is removed). Remove the kit by deleting `D:\llm\shords-pilot6c-r8` yourself.

`-Mode Live` is **not authorised** by this package and I am not requesting it. The dry runs remain a separate decision for you after you have reviewed the Test-FileOps result.
