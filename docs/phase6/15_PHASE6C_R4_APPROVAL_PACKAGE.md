# Phase 6C r4 - approval package for the supervised dry run (2026-11-04)

**Request:** approval to run the *supervised dry run* of the Phase 6C file-mailbox bridge on the owner's Windows laptop (Part 4). **Not requested:** Live mode (starts the model server). That needs a second, separate approval after the dry-run results are reviewed.

**Nothing has been executed on the laptop. The server has not been started. Nothing was installed, downloaded, committed, pushed or deployed. No Windows setting, firewall, registry or scheduled task was touched.**

## 1. What is delivered

| Item | Value |
|---|---|
| Package | `shords-pilot6c-scripts-r4.zip` (extracts to folder `shords-pilot6c-r4`), 24 files, 87,226 bytes |
| **Zip SHA-256** | **`3c3e5a7fba3d199e727e6486901de34563b89baa5bfe88d18cfe1bb871b19b1e`** |
| Build | deterministic (two builds gave the same hash); `python3 -I docs/phase6/pilot6c/build_pilot6c.py OUT.zip` |
| Manifest | `MANIFEST.sha256.txt` inside the zip lists SHA-256 of all 23 other files; the builder re-opens the zip, re-hashes every member and runs the static analyser on the exact CRLF bytes that ship |
| Source | `SOURCE_LISTING_r4.txt` (complete source of the 8 main files, 3,000+ lines) plus the zip itself (everything is plain text) |

Per-file SHA-256 (as shipped, CRLF for .ps1/.txt):

```
a1ab0aef6265b8e3d0c7849acc91a3cbbe4c9bd69af4a0edb138bdff897d858d  Invoke-PilotRun.ps1        (82 lines)
c6426854166efd7b7e8e8054ed85c576c2244146aa7e59fdb6c4158d86440dd7  Parse-Check.ps1
15a5c28417f82b385fb6c3047233e8464c10bedeecbbd7a427ad0e8b513ab8cc  Phase6B.Common.ps1         (unchanged r3 copy, 274 lines)
0e743f35e801ad5626e229fdc21642f41df5ac6099c55ac2b48c505b5df50175  Phase6C.Lib.ps1            (481 lines, pure logic)
c7f802863b3ae45b08898ff4c4cb5478b88431d3e97706e389253ae7f7bc5e7e  Phase6C.Runtime.ps1        (945 lines, side effects)
4ad980e1d99dc305cef7700581681020e68721a6d7548156e9224119af567bfb  Pilot-Agent.ps1            (104 lines)
7cc5b953c33e7e2d475c74f08bec36f86dee24880917e19b1ff8a9b9ae8272d4  README_FIRST.txt
31719d413d624755cba4f1cb6b9eb81b8cf4697dbbf0ef731fdc5a57507959a8  Rollback-6C.ps1           (79 lines)
c069128f3dc7752512b58ba6ca9ae7fadbd49f31752754eef994d3005706f971  Test-AgentLogic.ps1       (126 lines)
c545c7e2c1d1e8d5869fc5ea7da4261cc8d453d8156c0cb3a646cc8fa6c98e34  Verify-Kit.ps1
27c3a3e782aee836c35309847d2006e734f52a56c49ccf6e4d8ee98acb76bb6a  linux/gen_vectors.py
e45ea2041a5a77db3728f0ee5483dccd58a13b2359fbd682a34a71996194e332  linux/pilot_core.py
d71d1c6572f2dbbe93f114dc1d44b4ca90242ed84061085e02e4c7e908c2944d  linux/pilot_submit.py
a4e764adf02b36447903df9cea48508f408cfda96044b105161c1e0641cf0cc8  tests/ps_static_check.py
dbcbce6eccbdeb5cdad2a1e1e12d651532499ed0dd4fbdfc0dce6d28f7ea2d83  tests/test_pilot6c.py
vectors/*.json (8 files) - see MANIFEST.sha256.txt
```

## 2. Design in one page

* **No port, no shell, no command text.** You start `Pilot-Agent.ps1` in one window. It polls `D:\llm\jobs\inbox` for small JSON files. Only 8 job types exist (preflight, verify-integrity, server-start, server-stop, health, sweep, run-suite, collect). Each has an exact parameter key set with numeric/enum ranges. A job cannot carry a path, a URL, a command, or a flag.
* **Signed jobs.** HMAC-SHA256 with a per-session random key (`jobs\.session-key`, regenerated every agent start). Canonical string covers id, type, created, expires and every parameter. Lifetime <= 1800 s, clock skew 120 s, replay protection (`seen-ids.txt`), file <= 16 KiB, strict own JSON parser (duplicate keys, floats, odd escapes, BOM-less ASCII only for jobs).
* **Gates before any server start (cannot be changed by a job):** available RAM >= 6.5 GiB at ctx 4096 (7.7 / 8.9 for 8192 / 12288), free VRAM >= estimate + 250 MiB (estimate = 600 + 135*ngl + (ctx/256)*ngl; 1,808 MiB at ngl 8 / ctx 4096 vs measured peak 1,613), disk >= 20 GiB, port 8080 free, no foreign or leftover llama-server, `llama-server.exe` hash = install record, model size/mtime = Step C (full SHA-256 once per session).
* **Emergency brake while a server runs** (checked on every HTTP wait and between jobs; first match shuts down): STOP file, lease expired, non-loopback listener, external connection, RAM < 1.0 GiB, VRAM > 3,700 MiB, fatal server-log text, job time budget, telemetry lost (5 unknown samples), server exited. Shutdown = stop process, verify port free, write `outbox\incident-*.json`, audit line.
* **Hardened launch (fixes finding V1 from the plan):** `--host 127.0.0.1 --port 8080 --api-key-file D:\llm\secrets\server.key --no-webui --no-slots --cors-origins http://127.0.0.1:8080 --no-cors-credentials --parallel 1 --jinja`; key generated on the PC (never in chat, log or command line); `LLAMA_*` environment variables cleared; kill-on-close Windows Job Object so closing the window ends llama-server. `health` also tests: no-key and wrong-key rejected, foreign Origin not allowed, web UI and slots endpoints off.
* **Dry run vs Live.** DryRun (default, phrase `APPROVE E-DRYRUN`) measures and plans; it never starts a process or sends HTTP. Live (phrase `APPROVE E-LIVE`) is refused unless a dry run of this exact version covered the required job types within 7 days.
* **Audit:** `jobs\audit.jsonl` (append-only JSON lines: agent start/end, each job accepted/rejected with reason code, gate results, brake events). Secrets are never written to it.
* Claude production default is unchanged; nothing here touches D:\shords, Railway, Git or the backend.

## 3. Verification performed in the cloud (Linux; no PowerShell available)

| Check | Result |
|---|---|
| Python suite `tests/test_pilot6c.py` | **31 tests, OK** (23 s) |
| - conformance | 243 cross-language cases (jobs 105, strict JSON 41, gates 26, brakes 23, suites 22, timestamps 18, canonical 5, server args 3) all agree with the reference implementation; vectors regenerate byte-identically (`gen_vectors.py --check`) |
| - fuzz | 6,000 random byte mutations of a signed job: none accepted unless semantically identical; signature proven to bind every field |
| - mirror | the PowerShell *text* is compared with the oracle: every constant, regex, type list, per-type parameter key set and value rule, validation-reason order, gate-check order, brake priority order, hardened server argument list, memory formulas |
| - security text | exactly one `Start-Process` (llama-server.exe from the install record, after gates + hash checks); no `Invoke-Expression`/dynamic invoke; one loopback-only network constant; every write goes through `Assert-UnderRoot`; no recursion; dispatcher covers exactly the 8 types; live paths are only reachable behind the DryRun branch; API key never in audit/log |
| - fake agent | the real submitter's 18-job battery run end to end against a Python stand-in agent applying the reference validator |
| Own static analyser `tests/ps_static_check.py` | **0 findings** on the shipped CRLF bytes (ASCII, bracket balance, banned PS7/network/registry/persistence/recursion constructs, case-sensitivity rules, `Write-Host` plus pitfall, unknown commands, named parameters, undefined variables); proven to catch injected faults |
| Node wrapper `backend/tests/node/pilot6cBridge.test.js` (registered in `test:node`) | 3 tests pass |
| Full regression `npm run test:node` | **Node 22: 638 tests, 637 pass, 0 fail, 1 todo. Node 24: identical.** (previous baseline 635/634) |

**What this does NOT prove:** the PowerShell has never been executed. A real PowerShell parser was unavailable, so syntax and runtime behaviour on Windows PowerShell 5.1 are unverified until `Parse-Check.ps1` and `Test-AgentLogic.ps1` run on your machine (Part 4 steps 4-6; they are read-only). The Live-only paths (HTTP client, server start, health, sweep, run-suite, job object) are not exercised by the dry run and will first run in the later supervised Live stage.

## 4. Exact Windows commands - supervised dry run

Run in **64-bit Windows PowerShell 5.1**, one step at a time, pasting each output into the chat. Stop at the first problem.

```powershell
# 1. verify the zip (compare with the hash in section 1)
Get-FileHash -Algorithm SHA256 D:\llm\downloads\shords-pilot6c-scripts-r4.zip
# 2. extract (creates D:\llm\shords-pilot6c-r4 only)
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6c-scripts-r4.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6c-r4
# 3-5. read-only checks
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentLogic.ps1
# 6a. one-command dry run (prompts: type  APPROVE E-DRYRUN )
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-PilotRun.ps1 -Mode DryRun -Ngl 8 -Ctx 4096
# 6b. agent dry run (prompts: type  APPROVE E-DRYRUN ); leave open, tell Claude; Claude sends 18 test jobs
powershell -NoProfile -ExecutionPolicy Bypass -File .\Pilot-Agent.ps1 -Mode DryRun -Hours 1
# end it: Ctrl+C, or close the window, or:  New-Item D:\llm\jobs\STOP -ItemType File
# 7. acceptance checks (all must print nothing / as stated)
Get-Process llama-server -ErrorAction SilentlyContinue
netstat -ano | findstr ":8080"
Get-Content D:\llm\jobs\dryrun-complete.json
Select-String -Path D:\llm\jobs\audit.jsonl -Pattern 'emergency'
```

Steps 1-5 only read/hash files and create the extracted folder. Steps 6a/6b create the files listed in `README_FIRST.txt` under `D:\llm` only and start **no** program besides PowerShell itself.

**How Claude would deliver the test jobs in step 6b (needs the linked-computer bridge to be online):** read `jobs\.session-key`, sign jobs in the cloud, write each as `inbox\<id>.json.tmp` and rename to `.json` (the agent ignores `.tmp`). This writes only inside `D:\llm\jobs\inbox` and reads one file; it will be announced in chat first. If the bridge is unavailable, 6a alone is a sufficient first dry run and 6b waits.

**Pass criteria:** Verify-Kit prints `Kit verified: 23 files match the manifest.`, Parse-Check clean, Test-AgentLogic exit code 0 with 0 failures; 6a report.json has preflight/verify-integrity `ok` and server steps `planned`; 6b battery "as expected" (9 positive statuses, 9 negative rejections with the stated reasons); acceptance commands in step 7 as described in README_FIRST.

## 5. Rollback

| Situation | Command |
|---|---|
| See what would be removed | `.\Rollback-6C.ps1 -Scope All -List` |
| Remove everything the bridge created (jobs, runs, secrets, suites, logs) | `.\Rollback-6C.ps1 -Scope All` (type `DELETE`); narrower scopes: `Jobs`, `Runs`, `Secrets`, `Suites`, `Logs` |
| Remove the extracted kit | delete `D:\llm\shords-pilot6c-r4` in File Explorer |
| Agent stuck / want it gone now | create `D:\llm\jobs\STOP`, or Ctrl+C, or close the window |
| A llama-server is running by mistake | `D:\llm\shords-pilot6b-r3\Step-D-Run.ps1 -Action Stop` |
| Undo Phase 6B (r3) | `D:\llm\shords-pilot6b-r3\Rollback.ps1` (unchanged) |

Rollback-6C never recurses, never touches llama.cpp, the model, downloads, `install-record.json`, `verified-artifacts.json`, Phase 6B health reports, the r3 kit or D:\shords, and leaves files with unexpected names alone (reports them).

## 6. Security review

**Assets:** the laptop's availability and files, the model/binaries (hash-pinned), the API key, shoRDs production (not reachable from here).
**Trust boundary:** only the owner-started PowerShell window acts; job files are untrusted input; the local network is out of scope because nothing listens.

| # | Threat | Control | Residual |
|---|---|---|---|
| T1 | Malformed / oversize / injected job | size cap, strict parser, exact key sets, value ranges, ids and suite names regex-limited, no free-text reaches a command or a path (suite path = constant folder + validated name) | PowerShell parser unproven until run |
| T2 | Stale or replayed job | expiry <= 30 min, skew 120 s, replay list, per-session key | none beyond clock accuracy |
| T3 | Forged job by other local software | HMAC with session key | **the key file is readable by anything that can read `D:\llm`; the HMAC prevents accidents and stale files, not hostile local malware.** Compensation: the allowlist and gates apply regardless of who submits; worst case is a gated start/stop of the one pinned binary. Windows ACLs not changed (no security-setting changes authorised) |
| T4 | Server exposed on the network | `--host 127.0.0.1`, dry-run never starts it, brake on any non-loopback listener/external connection, health job asserts loopback | firewall untouched by design |
| T5 | Unauthenticated local use of the server / browser CSRF / web UI | API key file (never in argv or logs), foreign-Origin CORS test, no web UI, no slots endpoint | other local processes that can read the key file can call the server |
| T6 | Resource exhaustion on a 4 GB GPU / 16 GB RAM laptop | gates before start, continuous brake, idle auto-stop, time budgets, kill-on-close job object | VRAM/RAM formulas provisional until the first sweep; brake is checked only during HTTP waits and between jobs (long non-HTTP handler work, e.g. full integrity hashing, has no mid-task tick, so such scopes are refused while a server runs) |
| T7 | Swapped or tampered binary/model | exe SHA-256 = install record before each start; model size/mtime each start, full SHA-256 once per session | a swap that preserves size/mtime between sessions is caught by the per-session full hash only |
| T8 | Writes outside the root / link tricks | every path through the r3 `Assert-UnderRoot` (segment-boundary, reparse-point aware); no recursion | none known |
| T9 | Orphan server after crash | kill-on-close job object; orphan check at agent start; r3 `Stop` fallback | hard power loss is not a process issue |
| T10 | Secret leakage | key and Authorization never logged or echoed; audit review test | key file exists on disk during sessions (T3) |
| T11 | Privilege / persistence | no admin needed, no registry, services, scheduled tasks, firewall, Defender or execution-policy changes (enforced by static checks and the Node test) | -ExecutionPolicy Bypass is per-process only, as in r3 |
| T12 | Training/test data licensing | suites carry provenance (`synthetic` or `licensed` + `licence_ref`); the dry run uses only synthetic items | papers/licence records still pending from the owner |

**Findings fixed during build:** V1 (server previously unauthenticated with web UI) is closed by the hardened launch; several PowerShell 5.1 pitfalls (case-insensitive default operators, `\z`, `Write-Host` plus, `.Count` unrolling, date coercion in `ConvertFrom-Json`) were designed out and are enforced by the static analyser. **Open items:** none blocking the dry run; the residuals above are accepted for dry run and will be re-reviewed before Live.

## 7. Decisions requested

1. **Approve the supervised dry run** as in Part 4 (you type the phrase at each prompt). You may approve 6a only, or 6a + 6b.
2. Permission for Claude to use the linked-computer bridge for 6b (read `.session-key`, write job files into `D:\llm\jobs\inbox`, read results from `outbox`), announced in chat first. Without it 6b is skipped.

After the dry run, Claude will report results and ask for a **separate** approval before any Live step (server start with API key, health incl. security checks, sweep, a first synthetic suite, then the Qwen3-8B vs Claude comparison under the earlier benchmark rules).
