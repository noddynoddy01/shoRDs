# Phase 6C r6 - root-cause analysis of the two r5 failures on Windows PowerShell 5.1 (2026-11-04)

**Status:** r6 built and tested in the cloud only. **Nothing was executed, installed, extracted, started or changed on your laptop.** No commit, push, merge, deploy, Windows-setting change, network request, or Live approval request. The r4 and r5 trees and zips are untouched (rebuilt from source, they reproduce their delivered SHA-256 values exactly).

What you reported (r5, Windows PowerShell 5.1.26100.9818): checksum, extraction, Verify-Kit 25/25, Parse-Check 10/10 and Test-Orchestrator 52/52 passed. Test-AgentLogic: 481 passed, **26 failed** (all gate tests, actual value `[System.Collections.ArrayList]`). Dry Run A: RAM gate correctly refused (`available=5.62 need>=6.5`), port free, report written to `D:\llm\runs\run-20261104-185511\report.json`, then **`Exception calling "Replace" with "3" argument(s): "The path is not of a legal form."`**.

## Issue 1 - gate tests return `[System.Collections.ArrayList]`

**Root cause (certain).** `Get-FailedCheckNames` (and `Get-StartGateChecks`) ended with `return ,$list`. In PowerShell the comma operator builds a one-element array around the list; a function then emits that array's single element, so the **whole ArrayList travels as one object**. Everything that wraps or joins the result - `@(Get-FailedCheckNames $checks) -join ','` - then sees *one item that is a list*, and `-join` prints that item's `.ToString()`, i.e. its type name `System.Collections.ArrayList`. The Python oracle returns a plain list, so the Python mirror, the text assertions and the static analyser could not show it: it is a behaviour of PowerShell's output pipeline.

| Language rule | r5 | r6 |
|---|---|---|
| What a function emits | `return ,$f` -> one object (the list) | `return $f` -> the items one by one; nothing when empty |
| Caller | mixed: unwrapped in the runtime, wrapped in the tests | **always** `@(Get-FailedCheckNames ...)` |
| `@(f) -join ','` for `[ram]` | `System.Collections.ArrayList` | `ram` |
| Empty list | `System.Collections.ArrayList` | empty string |

**Collection enumeration, return semantics and comparison (the three things you asked about).**
* *Enumeration/return:* a function's output is the stream of objects it emits. An ArrayList that is returned plainly is enumerated into that stream; `,$list` suppresses the enumeration once. Zero items emit nothing, so the caller must use `@()` to get an empty array rather than `$null`.
* *Comparison:* the gate evaluator itself (`Get-StartGateChecks`: RAM `-lt`, VRAM, disk, port, hashes) compared correctly and the vector results of `gate-names:*` were right; only the *list of failed names* was mis-shaped. No comparison operator was wrong and none was changed. (All string comparisons remain `-ceq`.)
* *What r5 got right by accident:* the runtime callers did not wrap the call (`(Get-FailedCheckNames $checks).Count -gt 0`), so the ArrayList arrived intact and the **gate decision was correct** - which is why Dry Run A refused on RAM exactly as it should. What was wrong was every wrapped or joined use: the 26 tests, and the sweep report field `failed_gates` (would have been a list inside a list).

**Fix.** The two functions emit items; **every** caller (runtime x5, the sweep plan, tests) wraps with `@()`. The 26 tests were **not changed, weakened or removed**: the same vectors now pass. A sibling occurrence the audit found, `(Get-FailedCheckNames (Get-StartGateChecks ...)).Count` in the sweep dry-run plan, is wrapped too (it would have been wrong with an unrolled return).

## Issue 2 - `File.Replace` "path is not of a legal form"

**Root cause (certain).** `Write-AtomicText` wrote a temporary file and then called `[System.IO.File]::Replace($tmp, $Path, $null)`. PowerShell converts `$null` to an **empty string** when it is passed to a .NET method's `string` parameter. `File.Replace` treats the empty backup path as illegal and throws exactly "The path is not of a legal form". The code path is taken only when the destination **already exists**: the first write of any file (`File.Move`) worked, the second write of the same file crashed. In Dry Run A the second write was the run report after the markers/lease/audit files existed, and the exception came out of the unprotected tail of `Invoke-PilotRun.ps1`.

**Fix.** `[System.IO.File]::Replace($tmp, $Path, [NullString]::Value)` (the real .NET null), inside a `try`, with a fallback that copies the temporary file over the destination and deletes it, so a Replace refusal for any other reason (file locked briefly by antivirus, a share quirk) still ends with the right content.

## Why Dry Run A ended with an exception instead of a clean refusal

The refusal itself was right; what failed was the **reporting path**, and `Invoke-PilotRun.ps1` had no error boundary: the report write threw, nothing caught it, PowerShell printed the raw exception. r6 changes that independent of Issue 2:

* The run body is `try / catch / finally`. The `finally` always stops any server, writes the report (inside its **own** try/catch - a writer problem prints a WARNING and can never replace the result), writes the audit line, prints the port state.
* A new `Get-RunOutcome` classifies the run: **ok**, **gate-refused**, **failed** (failure wins over refusal).
* Resource-gate refusal prints a plain result and **exits with code 5**:
```
RESULT: REFUSED BY A RESOURCE GATE. Nothing was started; the tool itself worked as designed. Refused checks:
   - preflight: ram [available=5.62 need>=6.5]
Free the resource named above (for example close programs to raise available RAM) and run again.
```
* `report.json` gains `outcome`, `refused` and `error`. Exit codes: 0 ok; 1 failed step or error; 2/3/4 refused before starting (setup, STOP file, Live not allowed); **5 refused by a resource gate**.
* `Pilot-Agent.ps1`: each inbox cycle is in try/catch (audit `cycle-error`; five in a row end the agent cleanly with `exitReason cycle-errors`; the existing `finally` still stops any server and ends the lease).

**Your Dry Run A result is therefore expected to repeat as a clean exit-code-5 refusal while available RAM is 5.62 GiB.** To get a full planned run you need more free RAM (close programs; the gate for ctx 4096 / ngl 8 is 6.5 GiB). The gate numbers were not changed.

## Why the r5 tests did not catch either defect

Both are properties of the PowerShell runtime (output-pipeline unrolling, `$null` -> `''` conversion for .NET string parameters). The Python mirrors, source-text assertions and the static analyser can verify logic and text, not runtime semantics, and no PowerShell exists in my sandbox. r6 does three things: (1) models each rule in the Python tests, (2) adds static rules that flag the exact constructs (`return ,<expr>`; `$null` as an argument of a .NET static method) - they fire on the r5 tree, (3) adds Windows tests that exercise the real behaviour (`Test-AgentLogic.ps1` shape/outcome checks, new `Test-FileOps.ps1`). The first execution that actually proves the fix is yours.

## Not changed

Job types, HMAC format, allowlists, resource-gate numbers, emergency brake, the Live guard and its approval phrase, `Phase6B.Common.ps1`, `Verify-Kit.ps1`, `Parse-Check.ps1`, `Test-Orchestrator.ps1`, `Rollback-6C.ps1`, all vectors.
