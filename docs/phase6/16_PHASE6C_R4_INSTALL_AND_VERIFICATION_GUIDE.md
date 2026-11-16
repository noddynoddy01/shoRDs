# Phase 6C r4 - installation and verification guide (supervised dry run)

Audience: the owner, at the laptop. Everything below is read-only or writes only under `D:\llm`. Nothing installs software, opens a port, starts the model server, or changes Windows settings. Use **64-bit Windows PowerShell 5.1** (Start menu "Windows PowerShell", not "(x86)"). Run one step at a time and paste the output into the chat.

## 0. Before you start

* Prerequisites already in place from Phase 6B: `D:\llm\llama.cpp\...\llama-server.exe` (b11669, CUDA 12.4), the Qwen3-8B Q4_K_M model, `D:\llm\install-record.json`, `D:\llm\verified-artifacts.json`. The r3 kit stays in `D:\llm\shords-pilot6b-r3`.
* Close other heavy programs (browser with many tabs, games) so the RAM gate is representative. The dry run only measures and reports: a gate that would fail on a live start shows as status `gate-failed` for that job (information, not a tool fault), and the battery expects `planned`, so free RAM first for a clean result.
* Ensure nothing is listening on port 8080 (`netstat -ano | findstr ":8080"` prints nothing).

## 1. Get and check the package

1. Download/copy `shords-pilot6c-scripts-r4.zip` to `D:\llm\downloads\`.
2. `Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r4.zip` must equal `3c3e5a7fba3d199e727e6486901de34563b89baa5bfe88d18cfe1bb871b19b1e`. **If it differs, stop and tell me.**
3. `Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r4.zip -DestinationPath D:\llm` then `cd D:\llm\shords-pilot6c-r4`.

## 2. Read-only checks (expected output)

| Command | Expected |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1` | `Kit verified: 23 files match the manifest.` |
| `... .\Parse-Check.ps1` | every `.ps1` listed as OK; no parse errors (this is the first time a real PowerShell parses them) |
| `... .\Test-AgentLogic.ps1` | `PowerShell 5.1.x, 64-bit process: True`, then a pass/fail summary with **0 failed**; exit code 0 (`$LASTEXITCODE`) |
| optional `... .\Test-AgentLogic.ps1 -WithJobGuard` | same, plus the kill-on-close job object compiled and created (one temp file in %TEMP%, no process started) |

If Parse-Check or Test-AgentLogic reports anything, **do not continue**; paste the full output. A failing vector line names the case, so fixes are small and local. I would then revise the package (r5) and re-issue the hash.

## 3. Dry run A - one command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -Ctx 4096
```
Type `APPROVE E-DRYRUN` when asked. Expected: five steps (preflight, verify-integrity quick, server-start, health, server-stop). Preflight and verify-integrity say `ok` with the measured RAM / VRAM / disk / port values; the three server steps say `planned`. The report is `D:\llm\runs\<run id>\report.json`. If a gate would fail on a live start (e.g. RAM too low right now), server-start/-health steps show `gate-failed` with the failing check named. Free memory and repeat; do not treat it as a tool fault.

## 4. Dry run B - agent with test jobs (optional but required before Live)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 1
```
Type `APPROVE E-DRYRUN`. The window prints the allowlist, gates and brake, then `Agent is running`. Tell me in the chat. With your permission I then send 9 valid jobs (covering all 8 types; `sweep` and `run-suite` are planned only) and 9 invalid ones (bad signature, expired, unknown type, extra key, out-of-range ngl, bad suite name, malformed JSON, replay, ...). Each invalid job must be rejected with its specific reason; the agent window logs one line per job. End the agent with Ctrl+C, closing the window, or `New-Item D:\llm\jobs\STOP -ItemType File` (delete that file before the next run).

## 5. Acceptance checks (after A and/or B)

```powershell
Get-Process llama-server -ErrorAction SilentlyContinue        # nothing
netstat -ano | findstr ":8080"                                # nothing
Get-Content D:\llm\jobs\dryrun-complete.json                  # B: types_ok lists all 8 types
Select-String -Path D:\llm\jobs\audit.jsonl -Pattern 'EMERGENCY'   # nothing
Get-ChildItem D:\llm\secrets                                  # only dryrun.key (no server.key)
```
Pass = all as commented, battery "as expected", Test-AgentLogic 0 failures. Anything else: stop and report.

## 6. Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `The root folder must not contain spaces` / `64-bit` message | wrong shell or root; use the 64-bit "Windows PowerShell" and default root `D:\llm` |
| `A STOP file exists` | delete `D:\llm\jobs\STOP` |
| `Another agent window seems to be running` | close it, or wait for its lease (`jobs\agent.lease.json`) to expire |
| Job rejected with reason | codes: size, json, top-keys, schema, id, id-name-mismatch, type, timestamps, lifetime, params-type, params-keys, params-value:<key>, expired, not-yet-valid, hmac-format, hmac, replay |
| Antivirus quarantines a file | do not disable Defender; tell me which file and path; I will not ask you to change security settings |
| Execution blocked | commands use `-ExecutionPolicy Bypass` for that single process only (same as r3) |

## 7. Undo

`.\Rollback-6C.ps1 -Scope All -List` shows what would be removed; `.\Rollback-6C.ps1 -Scope All` removes it after you type `DELETE`. Delete the folder `D:\llm\shords-pilot6c-r4` yourself to remove the kit. Details: approval package section 5.

## 8. What comes after (not authorised yet)

Live mode needs: a completed dry run of this exact version, your report/outputs reviewed by me, then a **new** approval from you in the chat. The planned Live sequence: preflight + integrity (full, once) -> server start with API key (ngl 8, ctx 4096) -> health incl. security checks (key enforced, foreign origin refused, web UI off) -> short sweep (ngl/ctx combinations to calibrate the provisional VRAM/RAM formulas) -> a synthetic suite -> later, a licensed-paper suite and the Qwen3-8B vs Claude comparison once you provide the papers with licence records and approve the Claude baseline spend.
