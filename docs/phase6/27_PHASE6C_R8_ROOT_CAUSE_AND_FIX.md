# Phase 6C r8 - root cause of the two r7 Test-FileOps failures, and the fix (2026-11-04)

**BUILD ONLY.** Nothing was executed on your laptop, no Dry Run A/B or Live was started or requested, no production/Railway/DB access, no commit, push, merge or deploy. **r7 is unchanged** (its tree is untouched and still rebuilds to `b986af00...2a9d`); r8 is a separate tree, a separate zip and a separate folder name.

## 1. What I was given
Your Windows PowerShell 5.1 results for r7: package hash ok, Verify-Kit 29/29, Parse-Check 11/11, Test-AgentLogic 592/0, Test-Orchestrator 52/0, **Test-FileOps 44 passed, 2 failed**: `marker:failed-write-is-audited` and `marker:read-back-flags-the-stale-marker` (detail printed: `marker errors 2`). You mentioned the full output is available; it was not in the message, so **I worked from the summary above and the r7 source, not from the raw output**. The new r8 checks print the audit tail on failure, so any surprise beyond the cause below would show up in the next paste.

## 2. What the evidence already tells us
* 44 other checks passed. Among them, `marker:failed-write-is-counted` (MarkerErrors = 1 after the locked-file write), `marker:failed-write-leaves-the-old-marker-and-no-temp-file`, and `lease:shows-the-marker-errors` (`marker_errors` = 2 in the lease). **So the Windows behaviour behind the marker logic is as designed**: a file opened with `FileShare.None` makes `Write-AtomicJson` fail; the catch block counts it; the read-back counts the stale marker; the lease reports both.
* The failing detail `marker errors 2` shows the **first half** of the second check (`MarkerErrors -eq 2`) was true. Only the **audit-line half** failed - in both checks.
* Other audit checks that match the same way (`*"event":"agent-end"*`, `*"event":"job-rejected"*`) passed, so the text matching and the compact JSON layout (`"event":"..."` without spaces) are fine on 5.1.

## 3. Root cause (exact)
`Add-Audit` (Phase6C.Runtime.ps1) builds the record as `ts`, `event`, `mode` and then copies **every key of the data hashtable** into it with `$o[[string]$k] = $Data[$k]`. PowerShell hashtable and `[ordered]` keys are case-insensitive, and assigning an existing key replaces its value.

r7 wrote both `marker-error` audit calls with a **data key named `event`**:
```powershell
Add-Audit 'marker-error' @{ event = $Event; error = $_.Exception.Message }     # Update-DryRunMarker catch block: $Event = start/job/reject/end
Add-Audit 'marker-error' @{ event = 'verify'; error = $problem }               # Confirm-DryRunMarker
```
The copy replaced the record's own `event` value (`marker-error`) with the marker event. On Windows the lines were therefore written as `{"ts":...,"event":"start","mode":"DryRun","error":"..."}` and `{"ts":...,"event":"verify",...,"error":"run-id"}`. **Both lines were written; they were just named wrongly**, so searching `audit.jsonl` for `marker-error` found 0 lines instead of 1 in each check.

## 4. Is the second failure a consequence of the first?
**No. It is an independent defect with the same cause.** Two different code paths (`Update-DryRunMarker`'s catch block for failure 1; `Confirm-DryRunMarker` for failure 2) each contain the same mistake. Each check counts audit lines named `marker-error`, and each found none, for its own line. Fixing only one call site would leave the other check failing; failure 1 does not feed failure 2 (the only link, MarkerErrors rising from 1 to 2, worked correctly - that is the half of check 2 that passed).

## 5. Real impact (not just a test problem)
A failed marker write was still **counted, shown in the lease (`marker_errors`), printed as a WARNING, and turned into exit code 6**, so a bad marker could not pass as success. What was lost was the audit trail: `audit.jsonl` would not contain an event called `marker-error`, which was one of your r7 requirements ("recorded as audit errors"). r7's own doc 24 described the event as `marker-error {event, error}`; that schema could not work and is corrected below.

## 6. Why my r7 checks missed it
The Python model of the agent and the source-text tests copied the same call (`event = ...`) and asserted its text; nothing modelled **how `Add-Audit` builds a record**. The mutation controls I ran against r7 changed marker behaviour, not audit-record shape. That was a gap in the tests, not in your run.

## 7. The fix (smallest, plus one guard)
1. **Call sites:** the data key is now `marker_event` in both `Add-Audit 'marker-error'` calls. The audit line is `{"ts":...,"event":"marker-error","mode":"DryRun","marker_event":"start","error":"..."}` (or `"marker_event":"verify","error":"run-id"`).
2. **Guard in `Add-Audit`:** a data key named `ts`, `event` or `mode` (any case) is stored as `data_ts` / `data_event` / `data_mode` and can never replace the record's own field. No existing call site used such a key, so no other audit line changes. (This is defence in depth; the call-site rename alone fixes the failures.)
3. **Version:** `r8.0` (a marker written by r7 or earlier never unlocks r8 Live, as before).

## 8. Tests added so this class of defect is caught
* **Windows (`Test-FileOps.ps1`, 47 checks expected, r7: 46):** the two failing checks keep their names but now **parse** every audit line with `ConvertFrom-Json`, require `event = marker-error` **and** `marker_event = start` / `verify` **and** the error text, and print the audit tail on failure. New check `audit:reserved-data-keys-do-not-rename-the-event` calls `Add-Audit 'selftest-reserved' @{ event='x'; TS='y'; mode='z'; a=3 }` and verifies the record kept its event name and stored the three keys as `data_*`.
* **Python (105 tests, r7: 97):** class `R8AuditRecord` - a Python twin of the record builder (`audit_record`, guard on/off) reproduces the Windows result for the r7 calls (event `start` / `verify`), proves the guard, models the failed-write and stale read-back flows through the agent simulation, checks the `Add-Audit` source, and checks that the Windows script parses audit lines.
* **Static analyser:** new rule - no literal `Add-Audit` data key named `ts`, `event` or `mode` in any production script. **Run against the r7 tree it reports exactly the two r7 lines (876 and 892)**; run against r8: 0 findings.

## 9. Compatibility
Marker file, lease, and every other audit event are exactly as in r7. Only the `marker-error` event's data field changed (`event` -> `marker_event`). `jobs_done` / `jobs_rejected` unchanged. No safety boundary was touched (HMAC, replay, allowlist, strict JSON, parameter validation, resource gates, loopback, API key handling, emergency shutdown, lease expiry, kill-on-close, path guard, the Live gate `Test-DryRunMarker`). No new job types or permissions.
