# Phase 6C r5 - installation and verification guide

For review now; execute nothing until you approve it in the chat. 64-bit Windows PowerShell 5.1. One step at a time; paste each output into the chat; stop at the first problem. r5 does **not** replace r4 on disk: it extracts to its own folder `D:\llm\shords-pilot6c-r5`. Do not use `D:\llm\shords-pilot6c-r4` again.

## 1. Get and check the package
1. Put `shords-pilot6c-scripts-r5.zip` in `D:\llm\downloads\`.
2. `Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r5.zip` must print `777B7186DA9267C144076E0BB3E766F6F3A74299BCF64CD394923FB3F8A56DAF` (PowerShell prints upper case). **If it differs, stop.**
3. `Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r5.zip -DestinationPath D:\llm` then `cd D:\llm\shords-pilot6c-r5`.

## 2. Read-only checks, with expected results
| Command (prefix: `powershell -NoProfile -ExecutionPolicy Bypass -File`) | Expected |
|---|---|
| `.\Verify-Kit.ps1` | `Kit verified: 25 files match the manifest.` |
| `.\Parse-Check.ps1` | ten lines `OK ...`, then `All 10 scripts parse cleanly.` |
| `.\Test-AgentLogic.ps1` | `Checks passed: N   failed: 0`, then `All vectors agree...`; exit code 0 |
| `.\Test-Orchestrator.ps1` | `Checks passed: 52   failed: 0`, then `Both scripts bind their parameters correctly...`; exit code 0 |

`Test-Orchestrator.ps1` starts only short `powershell.exe ... -BindingTest` child processes that stop before touching any folder, file, process or network; it writes nothing.
If a line says `FAIL`, copy the whole output; do not continue. Optional: `.\Test-AgentLogic.ps1 -WithJobGuard` (also compiles the kill-on-close job object; one temp file in `%TEMP%`; starts no process).

## 3. Dry Run A (separate approval needed first)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096
```
(`-Ctx 4096` still works.) Type `APPROVE E-DRYRUN` at the prompt. Expected: five lines (preflight, verify-integrity, server-start, health, server-stop); preflight and verify-integrity `ok` (or `gate-failed` with the failing check named if, for example, RAM is low right now); the three server steps `planned`; report `D:\llm\runs\<run id>\report.json`.
Acceptance (after the run): `Get-Process llama-server -ErrorAction SilentlyContinue` prints nothing; `netstat -ano | findstr ":8080"` prints nothing; `Select-String -Path D:\llm\jobs\audit.jsonl -Pattern 'EMERGENCY'` prints nothing.

## 4. Dry Run B (agent with test jobs) - later, separate approval
Unchanged from the r4 guide: `.\Pilot-Agent.ps1 -Mode DryRun -Hours 1`, then Claude sends 18 test jobs with your permission to use the linked-computer bridge. Not part of this approval.

## 5. Rollback
`.\Rollback-6C.ps1 -Scope All -List` shows what would be removed; `.\Rollback-6C.ps1 -Scope All` removes it after you type `DELETE` (scopes `Jobs|Runs|Secrets|Suites|Logs|All`, spelling case no longer matters). Delete the extracted folders (`shords-pilot6c-r5`, and the unusable `shords-pilot6c-r4`) yourself in File Explorer. If a server is ever running by mistake: `D:\llm\shords-pilot6b-r3\Step-D-Run.ps1 -Action Stop`. Phase 6B (r3) rollback is unchanged.

## 6. Not authorised by this package
`-Mode Live`. It is refused without a completed dry run of **r5.0** (an r4 dry run does not count) and needs `APPROVE E-LIVE` plus its own approval in the chat.
