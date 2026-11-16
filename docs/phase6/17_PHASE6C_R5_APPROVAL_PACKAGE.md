# Phase 6C r5 - approval package (supersedes the r4 package, 2026-11-04)

**Status:** built and tested in the cloud only. **Nothing was executed, installed, extracted, started or changed on your laptop.** No commit, push, deploy, Windows-setting change, or Live approval request. The r4 sources, the r4 zip and the Phase 6B files were not modified or deleted (the r4 zip still hashes to `3c3e5a7f...19b1e` and the r4 tree rebuilds to that hash). **r5 is not interchangeable with r4: do not use the r4 folder again.**

## 1. Confirmed root cause

`Invoke-PilotRun.ps1` declared `[ValidateSet(4096, 8192, 12288)][int]$Ctx = 4096`. A script parameter is a variable in *script scope* and keeps its type and validation attributes. The script then dot-sources `Phase6C.Runtime.ps1`, which runs in that same scope and executes `$script:Ctx = $null` (the pilot-context object). PowerShell variable names are case-insensitive, and `$script:Ctx` *is* `$Ctx`, so the assignment re-assigned the parameter: `$null` converts to `0` for `[int]`, and `ValidateSet(4096,...)` refuses `0`. That matches your error text exactly. Nothing else in Dry Run A had run (no folder, file, process or request).

Why the r4 checks missed it: `Test-AgentLogic.ps1` dot-sources only `Phase6C.Lib.ps1`, never the orchestrator; my mirror tests and static analyser compared names inside single files and treated every `$script:` name as "defined"; and I had no Windows PowerShell to run the scripts.

**Not the only defect.** The audit found a second one, with safety relevance: `[ValidateSet('DryRun','Live')]` ignores case and keeps the typed spelling. With `-Mode live`, `$Mode -ceq 'Live'` was false (orchestrator showed the DRY RUN approval, asked for `APPROVE E-DRYRUN`) while the handlers test `$script:Ctx.Mode -ceq 'DryRun'`, also false, so they took the **live** branch. r5 normalises the spelling in both entry scripts before first use and `Initialize-PilotContext` refuses any other value. No gate was loosened.

## 2. Exact files and lines changed (r5 line numbers; unified diff in `DIFF_r4_to_r5.patch`)

| File | Lines | Change |
|---|---|---|
| `Invoke-PilotRun.ps1` | 19 | `[Alias('Ctx')][ValidateSet(4096, 8192, 12288)][int]$ContextSize = 4096` (was `...$Ctx = 4096`) |
| | 9-10, 13 | help text |
| | 21, 24-25 | `[switch]$BindingTest`; Mode spelling normalised |
| | 32-36 | `-BindingTest` block: after all three dot-sources prints bound values, `exit 0` before `Initialize-PilotContext` |
| | 51, 58, 60, 64, 85 | `$Ctx` -> `$ContextSize` (approval text, plan steps, audit, report) |
| `Pilot-Agent.ps1` | 26-27, 30-31, 38-42 | `[switch]$BindingTest`; Mode normalised; `-BindingTest` block |
| `Phase6C.Runtime.ps1` | 27 | `Initialize-PilotContext` throws unless Mode is exactly `DryRun` or `Live` (`$script:Ctx`, `$script:St`, all runtime variables unchanged) |
| `Rollback-6C.ps1` | 25-26; r4 line 27 | `-Scope` spelling normalised; dead self-assignment `$cfg = $script:Cfg` removed |
| `Test-AgentLogic.ps1` | 47-50 | loop variable `$j` -> `$jobObj` (`$j` is the same variable as parser state `$script:J`) |
| `Phase6C.Lib.ps1` 8, `linux/pilot_core.py` 10 | | version `r4.0` -> `r5.0` (the dry-run marker is version-bound, so an r4 dry run cannot unlock r5 Live) |
| new | | `Test-Orchestrator.ps1`, `CHANGELOG_r5.txt`; build script names r5; static analyser and tests extended |

Unchanged byte for byte: `Phase6B.Common.ps1`, `Parse-Check.ps1`, `Verify-Kit.ps1`, all `vectors\*.json`.

## 3. Why the correction is safe

* **Renaming the parameter, not the runtime variable.** `$script:Ctx` keeps its meaning; only the orchestrator's own context-size parameter changed, so no runtime code path changed.
* **`-Ctx` still works** through `[Alias('Ctx')]`. An alias exists only for parameter binding; it creates no variable, so it cannot recreate the collision. Accepted values stay exactly 4096, 8192, 12288; `-Ngl` stays 0-20.
* **No safety gate, allowlist entry, parameter range, approval phrase or emergency-brake rule was touched.** The only behavioural additions are stricter: Mode spelling can no longer reach a live branch under the dry-run phrase.
* **`-BindingTest`** sits after the dot-sources and before any action; a test confirms it contains no file, audit, process or network call and that it exits.
* Static proof: a new rule flags any script parameter whose name equals a `$script:` name or top-level name in the same dot-source closure. It reports the r4 defect on the r4 files (4 findings) and 0 findings on r5 (one reviewed, allow-listed share: the plain string `$Root` in the unchanged r3 `Phase6B.Common.ps1`).

## 4. New tests (cloud) and the Windows test you can run

16 new Python tests (47 total, was 31): collision checker reproduces the r4 defect and accepts the fix; case/prefix variants; Python model of the r4 failure; orchestrator has no `$Ctx` variable and keeps the alias/ValidateSet/default; whole-package collision scan; **binding mirror** for default, 4096, 8192, 12288, alias `-Ctx`, invalid (0, -1, 2048, 5000, 16384, abc, 4096.5), `-Ngl` 0/20/21/-1, `-Hours` and `-PollSeconds` bounds; Mode spelling (before first use, initialiser refuses others, Rollback scope); `-BindingTest` placement and no-action content; Test-Orchestrator expectations match what the scripts print; dry branches of the five live-capable handlers contain no start/stop/HTTP/chat/emergency call and the live part does; orchestrator/agent reach servers only through the dispatcher; version r5.0.

`Test-Orchestrator.ps1` (new, for Windows PowerShell 5.1) runs both entry scripts in child `powershell.exe` processes with `-BindingTest` and checks 52 conditions: defaults; context 4096 / 8192 / 12288; alias `-Ctx`; dot-sourcing of all three dependencies leaving `ContextSize` intact and `$script:Ctx` null; invalid context/ngl/mode/hours/poll values rejected with no binding output; `-Mode live/LIVE/Live` normalised; root with a space refused. It writes nothing and starts nothing except those PowerShell children.

## 5. Actual Windows PowerShell 5.1 test status

**Not run. No Windows PowerShell 5.1 (or any PowerShell) is available to me; the earlier attempt to run a downloaded PowerShell was refused by the sandbox and I did not work around that.** The parser check, the runtime binding tests, and the "dry run plans Ngl 8 / ctx 4096, starts no server, sends no HTTP" test have **not** passed on Windows: the cloud tests are text/static checks and Python mirrors, which are not equivalent. The Windows evidence will come from `Parse-Check.ps1`, `Test-AgentLogic.ps1`, `Test-Orchestrator.ps1` and then Dry Run A, in that order, on your machine, when you approve it.

## 6. Regression results (cloud)

| Run | Result |
|---|---|
| Python `tests/test_pilot6c.py` (repo copy and the copy extracted from the final zip) | 47 tests OK |
| Vectors regenerate byte-identically (`gen_vectors.py --check`) | OK (243 cases) |
| Static analyser on the zip's CRLF bytes | 0 findings |
| `npm run test:node`, Node v22.23.4 | 638 tests, 637 pass, 0 fail, 1 todo |
| `npm run test:node`, Node 24.22.1 | 638 tests, 637 pass, 0 fail, 1 todo |

Details with commands in `19_PHASE6C_R5_TEST_REPORT.md`.

## 7. r5 package

| Item | Value |
|---|---|
| File | `shords-pilot6c-scripts-r5.zip` (extracts to `shords-pilot6c-r5`) |
| Size | 99,089 bytes, 26 files |
| **SHA-256** | **`777b7186da9267c144076e0bb3e766f6f3a74299bcf64cd394923fb3f8a56daf`** |
| Deterministic | two builds gave the same hash |
| Manifest check | all 25 files listed in `MANIFEST.sha256.txt` verified with `sha256sum -c` on a fresh extraction of the final zip (25/25 OK); the builder additionally re-opened the zip, re-hashed every member and compared the file set |

Per-file SHA-256 (as shipped; CRLF for .ps1/.txt):

```
96b02b47c4f6c977b276feb296de8c49958b1cf8679577f3474a6ddfcd12e78e  CHANGELOG_r5.txt
6680bb1ba325a005ce630cb811e0c336525bf53e26f4ced168f8130ecb82d12f  Invoke-PilotRun.ps1
c6426854166efd7b7e8e8054ed85c576c2244146aa7e59fdb6c4158d86440dd7  Parse-Check.ps1
15a5c28417f82b385fb6c3047233e8464c10bedeecbbd7a427ad0e8b513ab8cc  Phase6B.Common.ps1
472a9765c4c99a541c8020124e6f797fa5bf81f499d9307755270fde9f24ecf5  Phase6C.Lib.ps1
029efb3c07b4214da3d0ecc276d4c36c3414470a7635a6b1007c4ad215417a8d  Phase6C.Runtime.ps1
776b6f46b1d55afd84697698c060bcf9b361670ec170fb852af5815fa24f7e59  Pilot-Agent.ps1
73467382e4fb4d155936d02e276c4249d88494c4059b778f6f312f09163c7b58  README_FIRST.txt
666e37f74d9d22d7842fd250d3ed3e21f98b4f15791ade585978349c55a1e8d7  Rollback-6C.ps1
7d0b2c0a2720f5f0273e14050e453d701c3f030d63c377643fa4c1429e2a6b66  Test-AgentLogic.ps1
9ee1251449cba52d6faeb4ec8aa22d012a67a92608d0da4624c587a9af2297f0  Test-Orchestrator.ps1
c545c7e2c1d1e8d5869fc5ea7da4261cc8d453d8156c0cb3a646cc8fa6c98e34  Verify-Kit.ps1
27c3a3e782aee836c35309847d2006e734f52a56c49ccf6e4d8ee98acb76bb6a  linux/gen_vectors.py
2e3c54cede4a09b1d12d7d01f67c4a7744cac83b410d21d8996a157983ac4088  linux/pilot_core.py
d71d1c6572f2dbbe93f114dc1d44b4ca90242ed84061085e02e4c7e908c2944d  linux/pilot_submit.py
```
(plus `tests/` and 8 `vectors/` files; the full list is `MANIFEST.sha256.txt`, whose own bytes are not self-listed). Run `Get-FileHash` on the zip itself; the per-file values are what `Verify-Kit.ps1` checks.

## 8. Unresolved limitations

* The PowerShell has still never been executed by me; r5's first real execution is yours. A different PowerShell 5.1-only behaviour could still surface in the dry run (for example CIM/`Get-NetTCPConnection`/`nvidia-smi` handling), and I audited the dry-run path by reading, not running.
* Live-only paths (HTTP client, server start/health/sweep/run-suite, job object) remain unexercised until a separately approved Live stage.
* Provisional VRAM/RAM formulas; HMAC key readable by anyone who can read `D:\llm` (prevents accidents and stale files, not hostile local malware); no monitor ticks during non-HTTP handler work. (Unchanged from r4; see the r4 security review.)
* `Test-Orchestrator.ps1` is itself new unexecuted PowerShell. If it reports a failure, the output says which condition; it cannot harm anything because it only starts `powershell.exe -BindingTest` children.

## 9. Windows installation and verification commands - for your review only (nothing will be run until you approve)

64-bit Windows PowerShell 5.1, one step at a time, paste each output back:

```powershell
# 1  verify the zip (expected SHA-256 below)
Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r5.zip
#    777b7186da9267c144076e0bb3e766f6f3a74299bcf64cd394923fb3f8a56daf
# 2  extract next to (not over) r4; creates D:\llm\shords-pilot6c-r5 only
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r5.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6c-r5
# 3  read-only checks
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1        # Kit verified: 25 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1       # All 10 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1   # 0 failed, exit code 0
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Orchestrator.ps1 # Checks passed: 52   failed: 0
# 4  ONLY after you approve it separately (Dry Run A, prompts for APPROVE E-DRYRUN):
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -ContextSize 4096
```

Rollback (unchanged in purpose): `.\Rollback-6C.ps1 -Scope All -List`, then `.\Rollback-6C.ps1 -Scope All` (type `DELETE`); delete `D:\llm\shords-pilot6c-r5` (and the unused `shords-pilot6c-r4`) in File Explorer yourself; `D:\llm\shords-pilot6b-r3\Step-D-Run.ps1 -Action Stop` if a server is ever running. Step 3 changes nothing on disk except `Test-Orchestrator.ps1`'s child processes (no files). Step 4 is the same Dry Run A as before; nothing in it can start the model server.
