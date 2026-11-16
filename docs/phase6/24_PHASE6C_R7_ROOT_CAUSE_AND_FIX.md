# Phase 6C r7 - completion-marker consistency: root cause and fix (2026-11-04)

**Status:** r7 built and tested in the cloud only (BUILD ONLY, as instructed). **Nothing was executed, installed or extracted on your laptop; llama-server was not started; no HTTP request, no Railway/production/database access; no commit, push, merge or deploy; no Live approval requested.** The r4, r5 and r6 trees and packages are untouched (rebuilt from source they reproduce their delivered SHA-256 values).

## 1. What your r6 run showed

| Source | Value |
|---|---|
| Audit log | nine `job-rejected` events, the ninth (the replay) at `2026-11-04T15:57:46.0147276Z` |
| `agent-end` audit record | `jobs_rejected: 9`, `jobs_done: 10`, `reason: lease-ended` |
| `agent.lease.json` | `jobs_rejected: 9` |
| `dryrun-complete.json` | `rejected_seen: 8`, `last_utc: 2026-11-04T15:57:42Z` |

## 2. Exact root cause

In r6, `Update-DryRunMarker` had exactly two call sites: after an **accepted** job in `Invoke-InboxCycle` (and after each step in `Invoke-PilotRun`). The rejection branch of `Invoke-InboxCycle` incremented `JobsRejected`, wrote the `job-rejected` audit line and the reject result, printed the line and moved the file - and never touched the marker. Nothing wrote the marker at shutdown either.

The marker therefore held the counters as they stood at the **last accepted job** (15:57:42Z, eight rejections so far). The replay rejection that followed (15:57:46Z), and the end of the run, never reached it. The agent's counters, audit log and lease were correct, as you concluded. Not a clock, rounding, file-writing or JSON problem: the write simply never happened.

Two related weaknesses fell out of the same analysis:
* **No identity.** The marker had no run id or state, so a marker from an earlier run was indistinguishable from the latest one (and a run killed mid-way looked the same as a finished one).
* **Silent failure.** A marker write error inside the cycle bubbled up as a generic `cycle-error`, left the job file in `work\` unarchived, and was never reported against the marker.

Also found: the agent reported **Ctrl+C as `reason: lease-ended`** (`$exitReason` was initialised to `'lease-ended'`). The marker must not repeat that, so the exit reason now starts as `aborted`.

## 3. The fix (smallest safe correction)

1. **Pure logic, testable on both platforms.** `Get-NextMarker` (Phase6C.Lib.ps1) computes the next marker from the previous marker and one event: `start | job | reject | end`. `Get-MarkerProblem` compares a marker with the run's own counters. Python twins `next_marker` / `marker_problem` plus 12 sequences and 6 problem cases in `vectors\marker-vectors.json` (generated from the Python oracle, checked on Windows by `Test-AgentLogic.ps1`).
2. **Every event writes the marker** (Phase6C.Runtime.ps1): start (agent/run begins), every accepted job (as before), **every rejection** (new: right after the counter, the audit line and the reject result, before the file is moved), and the end.
3. **One shutdown routine** `Complete-AgentSession`: `agent-end` audit line -> final marker (`state: ended`, `end_reason`) -> read-back check -> lease `ended`. `Pilot-Agent.ps1` calls it from the `finally` block, in a nested try/finally so it still runs if stopping the server throws. That covers lease expiry, the STOP file, five consecutive cycle errors, and Ctrl+C (`finally` runs on Ctrl+C in PowerShell).
4. **Existing safe writer.** The marker is written with `Write-AtomicJson` (temporary file, replace, fallback copy), under the path guard, exactly like every other state file.
5. **Failures are surfaced.** `Update-DryRunMarker` catches a write failure, counts it (`St.MarkerErrors`), logs an audit event `marker-error`, shows it in the lease (`marker_errors`), prints a WARNING at the end, and `Pilot-Agent.ps1` / `Invoke-PilotRun.ps1` exit with **code 6**. `Confirm-DryRunMarker` reads the file back after the final write and flags any disagreement with the run's counters (this check would have flagged the r6 discrepancy: 8 vs 9) - so a marker that does not say what the run did cannot pass as a successful completion.
6. **Freshness.** Each run gets a run id `sess-YYYYMMDD-HHMMSS-xxxxxx` at start. The marker is rewritten with the new id, `state: running` and zeroed counters at the first moment of the run, so the previous run's marker is replaced immediately and can be told apart by `run_id`. A run that is killed (window closed) leaves `state: running` with no `end_reason`: unfinished runs look unfinished.
7. `Invoke-PilotRun.ps1` gets the same start/end events; a failure while stopping the server is recorded as the run's error instead of aborting the `finally` block (so the report and final marker are still written).

## 4. Marker layout and definitions (compatible: additions only)

| Field | r6 | r7 | Meaning |
|---|---|---|---|
| `schema` | yes | same `shords-pilot-dryrun/1` | unchanged |
| `agent_version`, `first_utc`, `types_ok` | yes | same | accumulate over all runs of the **same agent version**; an r4/r5/r6 marker never counts. All eight job types are preserved. |
| `rejected_seen` | yes | same name | the **run's** `jobs_rejected` count, now always current (= lease = `agent-end` = number of `job-rejected` audit lines) |
| `last_utc` | yes | same name | UTC time (1 s resolution) of the **most recent marker write**: the last accepted job, the last rejection, or the end of the run, whichever came last |
| `marker_rev` | - | 2 | layout revision |
| `run_id`, `run_started_utc` | - | new | identity of the run the counters and state belong to |
| `state` | - | `running` / `ended` | `ended` only after the end routine ran |
| `end_reason`, `ended_utc` | - | new (null while running) | `lease-ended`, `stop-file`, `cycle-errors`, `aborted` (Ctrl+C or unexpected error); orchestrator: `run-complete`, `run-error` |
| `event_seq` | - | new | writes in this run (1 at start); advances on every event even inside the same second, so "the marker moved" is provable |
| `jobs_done` | - | new | the run's `jobs_done` |

Schema/compatibility: no existing key was renamed, removed or re-defined; a reader of the r6 layout still finds all six of its keys. The only consumer in the kit, `Test-DryRunMarker` (the Live gate), reads `agent_version`, `types_ok`, `last_utc` and is **unchanged**: still version-bound, still needs the required job types, still expires after 7 days. (It does not require `state: ended`; see limitations.)

## 5. Audit log and lease (compatible; `jobs_done` / `jobs_rejected` mean what they meant)

* `agent-start`: + `run_id`. `agent-end`: keeps `reason`, `jobs_done`, `jobs_rejected`, + `run_id`; `reason` can now be `aborted` (before, Ctrl+C was mislabelled `lease-ended`). `run-start` / `run-end`: + `run_id`. New event `marker-error {event, error}`. Lease: + `run_id`, `marker_errors`.
* Why these additions are strictly necessary: the run id has to appear in the audit log and lease to tie the marker to the run it describes; `marker-error` is the audit record the requirement asks for; the `aborted` reason is needed so the marker's `end_reason` and the audit's `reason` cannot disagree.

## 6. Safety boundaries

HMAC-SHA256, replay protection, allowlist, strict JSON, parameter validation, resource gates (numbers unchanged), loopback-only binding, API-key handling, emergency shutdown, lease expiry, kill-on-close, audit logging and the path guard are untouched (no line of those functions changed; the static analyser and the mirror tests still pass). No job type or permission was added. The marker file holds only counters, times, job-type names and the run id: no key, job content, path or measurement.

## 7. Behaviour before and after (your exact sequence)

| Moment | r6 marker | r7 marker |
|---|---|---|
| after last accepted job, 15:57:42Z | `rejected_seen 8`, `last_utc ...:42Z` | `rejected_seen 8`, `last_utc ...:42Z`, `state running` |
| after replay rejection, 15:57:46Z | unchanged (stale) | `rejected_seen 9`, `last_utc ...:46Z`, `event_seq` +1 |
| lease ends | unchanged | `state ended`, `end_reason lease-ended`, `rejected_seen 9`, `jobs_done 10`, 8 types |
| next run starts | still the old run's numbers | new `run_id`, `state running`, counters 0, types kept |
