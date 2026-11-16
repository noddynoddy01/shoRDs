# Phase 6C r7 - install and verification guide (Windows PowerShell 5.1)

**Nothing here has been run by me, and I did not execute, install or extract anything on your laptop.** Steps 1-8 are read-only or confined to a temporary folder; none starts the model server, opens a port, sends a request or needs an approval phrase. Use the r7 zip only; r4, r5 and r6 stay untouched and must not be used again. **`-Mode Live` is not authorised by this package and I am not asking for it.**

Expected zip SHA-256: `b986af0094c5445772b5c88c176b71190ef15bb7bc8fabf40259c34353742a9d` (134,048 bytes; 30 files in the archive = 29 manifest entries + the manifest itself).

## PART 1 - verify the package

```powershell
Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r7.zip            # must equal the value above
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r7.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6c-r7
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1        # expect: Kit verified: 29 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1       # expect: All 11 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1   # expect: Checks passed: 592   failed: 0   (r6: 518; +74 marker checks)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 # expect: 52 passed, 0 failed (unchanged script)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-FileOps.ps1      # expect: Checks passed: 46   failed: 0   (r6: 22; +24 marker checks)
```

The two new totals (592 and 46) are **counted from the source, not observed**: 518 + 1 version check + 64 marker steps + 6 problem cases + 3 r6-discrepancy checks = 592; 46 literal `Check` calls in Test-FileOps minus the catch-all `unexpected-exception` = 46. If the real count differs but `failed: 0`, paste the output; a mismatch of the count alone is a documentation error on my side, not a failure. **Any non-zero `failed` or any `FAIL` line: stop and paste the output.** Do not start Part 2 before steps 4-6 are green.

### What changed in the tests you run
* **Test-AgentLogic.ps1** additionally replays all 12 sequences in `vectors\marker-vectors.json` through `Get-NextMarker` (each produced marker is written to JSON and read back before the next step, like the real file) and the 6 `Get-MarkerProblem` cases, then checks your exact r6 audit sequence: marker 8 / `15:57:42Z` after the last accepted job, 9 / `15:57:46Z` after the replay rejection, and a final `ended` / `lease-ended` / 9 / 10 / 8 types.
* **Test-FileOps.ps1** (same safety as r6: one new folder under `%TEMP%`, removed at the end, nothing on `D:\llm`, no process, no port, no request) now also exercises the real functions through: run id format; start marker; eight then nine rejected files (`rejected_seen` 8, then 9 with the replay, `event_seq` +1, `last_utc` not earlier); `Complete-AgentSession 'lease-ended'` (end marker, lease and audit agree); a second run that starts clean but keeps `types_ok` / `first_utc` and is told apart from the first by `run_id`; the Ctrl+C routine (`aborted`); a marker file **locked** with a deliberate exclusive open so the write fails: `MarkerErrors` must rise, a `marker-error` audit line must exist and the lease must show `marker_errors`. These checks are new and **unexecuted**; a bug in a test is also a finding.

## PART 2 - supervised dry run (separate approval, phrase unchanged: `APPROVE E-DRYRUN`; I am not requesting it here)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096     # Dry Run A
powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 1                         # Dry Run B + battery
```
Exit codes of `Invoke-PilotRun.ps1`: 0 ok; 1 failed / run error; 2, 3, 4 refused before start; 5 resource gate; **6 (new) the completion marker could not be written or did not match the run**. `Pilot-Agent.ps1` also exits 6 in that case and prints a WARNING.

### Acceptance for the marker (after the 18-job battery and the natural lease end)
```powershell
$m  = Get-Content D:\llm\jobs\dryrun-complete.json -Raw | ConvertFrom-Json
$ls = Get-Content D:\llm\jobs\agent.lease.json     -Raw | ConvertFrom-Json
$m | Format-List run_id,state,end_reason,run_started_utc,last_utc,ended_utc,event_seq,jobs_done,rejected_seen,types_ok
$ls | Format-List run_id,state,jobs_done,jobs_rejected,marker_errors
(Select-String -Path D:\llm\jobs\audit.jsonl -Pattern '"job-rejected"').Count        # number of rejection events
Select-String -Path D:\llm\jobs\audit.jsonl -Pattern 'marker-error','"emergency"','cycle-error'   # must print nothing
Get-Process llama-server -ErrorAction SilentlyContinue                                  # must print nothing
netstat -ano | findstr ":8080"                                                          # must print nothing
```
Expected for your battery (nine rejections, ten processed jobs, natural lease end): `m.state = ended`, `m.end_reason = lease-ended`, `m.rejected_seen = 9`, `m.jobs_done = 10`, `m.types_ok` lists all eight types, `m.run_id` equals `ls.run_id` and the `run_id` in the `agent-start` / `agent-end` audit lines, the `job-rejected` count is 9 **for this run** (the audit log accumulates over runs: count only the lines after this run's `agent-start`), `m.last_utc` is not earlier than the timestamp of the last `job-rejected` line (to the second) and `m.ended_utc` is the time of `agent-end`, `ls.marker_errors = 0`.

Optional extra checks I would like to see (all safe): run `Pilot-Agent.ps1 -Mode DryRun -Hours 1`, press **Ctrl+C**, then read the marker: expect `state = ended`, `end_reason = aborted`. Start the agent a second time and read the marker immediately: expect a **new** `run_id`, `state = running`, `rejected_seen = 0`, `types_ok` still listing the earlier types. Closing the window (not Ctrl+C) leaves `state = running` - that is by design, it is how an unfinished run is told apart.

## PART 3 - rollback
`.\Rollback-6C.ps1 -Scope All -List` then `.\Rollback-6C.ps1 -Scope All` (typed DELETE). Test-FileOps leaves nothing to roll back. Remove the kit by deleting `D:\llm\shords-pilot6c-r7` yourself.
