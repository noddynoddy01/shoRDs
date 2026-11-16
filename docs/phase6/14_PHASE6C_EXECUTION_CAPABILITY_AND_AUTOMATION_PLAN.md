# Phase 6C - Execution capability, verified pilot results and automation plan (2026-11-04)

Status: **investigation complete; no direct Windows execution available; a secure bridge is designed but NOT built or running.** Everything in sections 1 to 3 was observed this session. Everything from section 4 on is proposed work, labelled as such.

## 0. Executive answer

| Question | Answer |
|----------|--------|
| Can I execute commands on your Windows laptop today? | **No.** I did not, and nothing in this document claims I did |
| Why not? | My command shell on your device is a **Linux virtual machine**, not Windows; it can only see folders you attach; no PowerShell or `cmd` exists in it; its network loopback is not your laptop's loopback; the only other route (driving apps by screenshots) is blocked for terminals (section 1) |
| What can I do with the access you gave me? | Read and write files in `D:\llm` (you approved that this session) and run analysis in the Linux VM and cloud workspace |
| What closes the gap with the fewest manual actions? | A **file-mailbox agent** on your laptop (section 4): one PowerShell script you start once per work session; it executes only an allowlist of pilot jobs that I drop as files into `D:\llm\jobs`; no open port, no arbitrary commands, no remote-access software, no firewall or service change |
| Your reported pilot results | **Verified** against the health report and logs on disk (section 2) |

## 1. What I actually tested (read-only) and what it showed

| Check | Where it ran | Result |
|-------|--------------|--------|
| `get_device_info` | the desktop-app bridge | platform `win32` x64, Windows desktop app 4.16336.0, device name `nod-e`; attached folders at session start: `D:\shords`, `D:\Tools\pgsql-16.15`; **no** `D:\llm`, no local MCP servers |
| `uname -a`, `id`, `which powershell.exe pwsh cmd.exe` in the device shell | Linux VM | `Linux ... 6.8.0-138-generic x86_64 GNU/Linux`; unprivileged user; **no PowerShell, no cmd**; folders appear under `$HOME/mnt/` only if attached |
| `device_list_dir D:\llm` before any grant | bridge | names only (`downloads, health, llama.cpp, logs, models, shords-pilot6b, -r2, -r3`), no contents |
| `computer_resolve_access` for "Windows PowerShell", "Command Prompt", "Windows Terminal" | bridge | PowerShell and Command Prompt did **not** resolve to grantable apps (most likely blocked for computer use; I cannot tell the reason), Windows Terminal "not installed". By the computer-use rules terminals are in any case click-only (typing blocked) |
| `device_request_folder_access D:\llm` | bridge, **you approved** | granted; file read/write on `D:\llm` only |

**Exact technical limitation:** the Windows desktop app exposes (a) file staging and a shell, but the shell runs in a Linux VM; (b) screenshot/mouse/keyboard control, which excludes typing into terminals; (c) a built-in browser that can only open web pages. None of these can launch `llama-server.exe`, run `Step-D-Run.ps1` or reach `127.0.0.1:8080` on the laptop (the VM's loopback is its own, and the VM reaches the internet only through an allowlist proxy).

## 2. Your reported results, checked against the files (this is verified execution evidence of *your* run, read by me)

Read from `D:\llm\health\health-20261104-162636.json`, `logs\server-20261104-162501.err.log`, `install-record.json`.

| Claim | File says | Verdict |
|-------|-----------|---------|
| 10 of 10 health/safety checks passed | 10 PASS lines (listens 127.0.0.1 only, brake not triggered, /health, ctx 4096, one slot, three prompts HTTP 200, no think tags, RAM >= 1.0 GiB, VRAM <= 3,600 MiB, no external connection) | confirmed |
| Lowest available RAM 3.32 GiB | `minAvailRamGiB 3.32` | confirmed |
| Peak VRAM 1,613 MiB | `maxVramUsedMiB 1613` (my estimate was 1,711 MiB; slightly conservative) | confirmed |
| Server working set | up to 5,390 MiB (estimate was about 4.8 GiB) | new fact |
| Context 4096, 1 slot, 8 GPU layers | `n_ctx 4096`, `total_slots 1`, `ngl 8` in the server record | confirmed |
| Loopback only | log: `listening on http://127.0.0.1:8080`; listeners before/after `127.0.0.1:8080` only; no external connections; no firewall rules named llama | confirmed |
| Latency | T1 1.91 s (31-token prompt, 2 generated), T2 9.39 s (86 / 56), T3 1.86 s (472 / 3) | new fact |
| Speed | prompt processing 30.8 / 149.5 / 388.2 tok/s (grows with prompt length); **generation 8.0 / 7.4 / 7.7 tok/s** | new fact |
| Build | `version: 0.7.0-dev (build 11669, commit 620d2225c)`, built with **Clang 20.1.8**, so the Visual C++ question was moot; `libomp.dll` is bundled | new fact |
| Install | 55 files, 1,144 MiB, **21 executables extracted, only `llama-server.exe` ever run**, signature `NotSigned`, exe SHA-256 `6a4635ae...65141b`, no expected CUDA file missing | new fact |
| Port closed / RAM recovered to 8.5 GiB | not in any file I can read (the server was already stopped); **owner-reported, not independently verified** | unverified |

### Issues found in the verified run (to fix, none dangerous for a short loopback run)

| # | Finding | Why it matters | Planned fix |
|---|---------|----------------|-------------|
| V1 | Server log warns: **"no API key is set and CORS allows all origins"** | While the server runs, any web page open in your browser could send requests to `127.0.0.1:8080` (the model would answer a stranger's page, and long runs make this window large) | Start with `--api-key-file` (a random key generated on your PC and never shown in chat) plus `--no-webui`, `--no-slots`, and `--cors-origins` limited to the loopback origin; all supported by this build's `--help`. Needs one change to Step D Start and the pilot adapter's auth header |
| V2 | `loadlog-extract-*.txt` is 100 bytes; the log shows no "offloaded N/M layers" or buffer-size lines at default verbosity | I cannot confirm *from the log* that 8 layers went to the GPU (VRAM 1,613 MiB and the speeds make it very likely) | Parse the whole `.err.log` into the report and add `--verbosity` only if needed, measured by the agent |
| V3 | Generation is ~7.7 tok/s with 8 of 36 layers on the GPU while VRAM peaked at only 1.6 GiB of 4 GiB | A 1,000-token output costs ~2 minutes; more layers on the GPU would speed it up | Automated `-ngl` sweep (8, 12, 16, 20) under the VRAM gate, reporting speed, VRAM, RAM |
| V4 | 4,096 tokens is too small for the real pipeline (known) | see section 6 | context ladder in the same sweep |
| V5 | Extraction produced 20 executables never needed | extra attack surface sitting on disk, none executed | agent never runs anything except `llama-server.exe`; optional later: delete unused tools via Rollback record (needs your approval) |

## 3. Bridge options considered

| Option | Verdict | Reason |
|--------|---------|--------|
| A. You run every command by hand | works today | many manual actions; what we did so far |
| B. One-command orchestrator (`Invoke-PilotRun.ps1`): preflight to report in a single run | **build as the base layer** | one action per experiment, no new attack surface |
| **C. File-mailbox agent** (B's functions + a job watcher) | **recommended** | zero open ports, no arbitrary exec, I can submit jobs and read results through the folder you already attached |
| D. Loopback HTTP "exec" service with a token | **rejected** | unreachable from the Linux VM; any binding reachable from it would not be loopback; an authenticated remote-exec endpoint is the most dangerous design |
| E. SSH / WinRM / remote desktop / scheduled task / service | **rejected without approval** | installs remote access or persistent configuration; you excluded it |
| F. Computer-use typing into a terminal | blocked | terminals are click-only; PowerShell did not resolve as grantable |
| G. Browser (built-in) as a bridge | not a bridge | opens pages only; could at most call the running server over HTTP, cannot start anything |

## 4. Proposed design (NOT built, NOT approved): the mailbox agent

### 4.1 How it works

* You run **one command once per work session**: `.\Pilot-Agent.ps1 -Hours 4` (asks you to type `APPROVE E`; shows the allowlist and the time limit). The window stays open; closing it or creating `D:\llm\jobs\STOP` ends it. Nothing is installed, no scheduled task, no service, no firewall rule, no PATH change.
* I write **job files** (JSON) into `D:\llm\jobs\inbox` using the folder access you granted. The agent polls that folder every few seconds, validates the file, executes the allowed operation with the same code as Step D, and writes the result to `D:\llm\jobs\outbox\<id>.json` plus artefacts under `D:\llm\runs\<id>\`.
* I read results and continue. Typical loop: preflight, start, health, sweep, run, stop, with **no manual action** between jobs.

### 4.2 What the agent can and cannot do

| Allowed job types (fixed list, parameters range-checked) | Never possible through a job |
|----------------------------------------------------------|------------------------------|
| `preflight`, `verify-integrity` (hash zips, exe, model), `server-start` (ctx in {4096, 8192, 12288}, ngl 0-20, parallel 1), `server-stop`, `health`, `sweep` (list of ngl/ctx values), `run-suite` (a named suite file from `D:\llm\suites`, local-only), `collect` (copy logs/reports) | running any other program or script or a command string; reading or writing outside `D:\llm`; network access other than `127.0.0.1:8080`; changing PATH, registry, services, scheduled tasks, firewall, Defender, execution policy; downloads; deletions (Rollback stays a separate typed-`DELETE` action); starting a server on any host other than 127.0.0.1 |

### 4.3 Safety rules enforced inside the agent (a job cannot relax them)

1. **Resource gates before every start:** available RAM at least 6.5 GiB, free VRAM at least the model/ngl requirement, free disk at least 20 GiB, port 8080 free, no foreign `llama-server`, the exe hash equals the install record, the model hash equals Step C (full re-hash at first start of each session).
2. **Emergency shutdown while running:** available RAM < 0.7 GiB while loading or < 0.5 GiB while serving, VRAM used > 3,700 MiB, GPU/driver error in the log, any non-loopback listener or established external connection, a job exceeding its time budget, a `STOP` file, or the agent's lease expiring. The server is stopped, port closure is verified and the incident is written to the outbox.
3. **Authenticity:** each job carries an HMAC (SHA-256) made with a session key the agent creates at start in `D:\llm\jobs\.session-key`; jobs without a valid HMAC, outside the allowlist or past the lease are moved to `rejected\` with a reason. **Honest limit:** I read that key through the shared folder, so anything that can write to `D:\llm` can also sign jobs. The HMAC prevents accidents and stale files, not a hostile program already running as you. The real protection is the allowlist: a forged job can only do what a legitimate job could (start/stop the local model within the gates).
4. **Secrets never go through chat:** the server API key (V1) is generated on your PC into `D:\llm\secrets\server.key` and used by the agent; it is not echoed or logged.
5. **Auditing:** every job, decision, gate reading, command line and result is appended to `D:\llm\jobs\audit.jsonl` (append-only by the script).

### 4.4 Threat model summary

| Threat | Control | Residual |
|--------|---------|----------|
| Arbitrary code through a crafted job | no free-form fields are executed; schema validation; enumerations and numeric ranges | script bug (not yet written or tested on Windows) |
| Malware or another program drops jobs | allowlist + gates + audit; the same program could already do worse as you | cannot be fully excluded |
| Web page talks to the model server | API key, no web UI, CORS limited, loopback only | low |
| Agent left running unattended | lease expiry (default 4 h, maximum 8 h), STOP file, visible window | low |
| Runaway memory use | emergency shutdown (4.3) | low |
| Prompt injection from paper text steering the pipeline | model output is data; only allowlisted job types exist; outputs are never executed | low |
| I (the builder) make a mistake | read-only `-DryRun` mode that validates and logs without starting anything; first session is supervised | medium until run once |

### 4.5 Manual actions required from you if this is approved

1. One time: save the agent zip, verify its hash, run the three read-only checks (the same pattern as r3). 
2. Each work session: run the one agent command and type `APPROVE E`.
3. Physical-machine actions only when unavoidable: e.g. close memory-heavy programs if the RAM gate refuses, plug in the charger for long runs, and read Task Manager's "Shared GPU memory" the first time.

## 5. Lifecycle automation map (your list, items 1 to 10)

| # | Your requirement | Today (verified) | With the agent (proposed) |
|---|------------------|------------------|----------------------------|
| 1 | Preflight RAM, VRAM, disk, port | `Step-D-Run.ps1 -Action Prereq` exists, run by you | `preflight` job, automatic before every start |
| 2 | Runtime and model integrity | hashes at Step C; Install re-hashes zips; Start re-hashes exe | `verify-integrity` job, model hash once per session |
| 3 | Safe startup | Step D Start (typed approval) | `server-start` job, gates enforced |
| 4 | Loopback verification | listener check in Start, Health, Status | same, plus external-connection check each cycle |
| 5 | Readiness | `/health` poll | same, plus a one-token generation canary |
| 6 | Synthetic tests | three prompts in Health | same, plus fixtures for the evaluation suites |
| 7 | Memory and GPU monitoring | samples every 1.5 s during requests | continuous sampler for the whole run, CSV |
| 8 | Emergency shutdown | RAM brake 0.7/0.5 GiB | all thresholds in 4.3 |
| 9 | Shutdown and port-closure check | Stop prints it | automatic, recorded |
| 10 | Machine-readable reports | health JSON | one JSON per job + audit log + consolidated `report.json` |

## 6. Evaluation pipeline: what exists in the repo and what is missing

Existing components (inspected: `backend/native/*`, `backend/eval/*`, `scripts/*`, Phase 4 to 6 docs):

| Your requirement | Existing component | Gap |
|------------------|--------------------|-----|
| Reproducible benchmark dataset | `backend/eval/benchmark.js`, `benchmarkRun.js`, licence-gated paper manifests (`papers.template.json`) | **no real licensed papers yet (owner to supply with licence records)** |
| PDF extraction, section identification | `backend/eval/pdfExtraction.js`, `pdf_eval.js`, native `documentIntelligence.js` | extractor choice for real PDFs still to be measured on the real set |
| Hierarchical summarisation | `backend/native/hierarchical.js`, `brief.js`, `pipeline.js` | needs context 8,192+ on this laptop |
| Evidence-grounded claims, traceability | `structuredExtraction.js`, `validation.js`, claim guard, `faithfulness.js` | none known beyond listed claim-guard limits |
| Hallucination detection, accuracy | claim guard + `guardReview.js` (human review), `faithfulness.js` | automated checks are heuristics; **human ratings are required** |
| Coverage and completeness | `summaryMetrics.js`, `summaryBenchmark.js`, `benchmarkScoring.js` | needs the real set |
| Human-review workflow | review kit and `agreement.js` (inter-rater) | raters must be people; no ratings will be invented |
| Latency, tokens, resources | `pilotMetrics.js`, `native_pilot.js` (server timings) | resource sampling to be merged into the run report (agent) |
| Fair comparison with Claude | `nativeCompare.js`, `native_compare.js`, `directBaseline.js` | **Claude runs cost money: needs your approval and the spend limit**; baseline "B" needs about 24,576 context (does not fit this laptop's RAM), so a fair comparison needs either C-only at 8,192 plus a Claude run of the *same* multi-stage pipeline, or a documented baseline cap |
| Cost per paper | `native_cost_model.js`, `estimate_analysis_cost.js` | local cost is electricity/time; Claude cost from the existing estimate |
| Hardware requirements | memory budget script, this run's measurements | add measured table per ngl/ctx from the sweep |

## 7. Plan (proposed) and what I will do without further approval

| Step | Needs your approval? | Runs where |
|------|----------------------|------------|
| 1. This document, execution ledger, verified analysis | no (done) | cloud + Linux VM |
| 2. Build `Pilot-Agent.ps1`, `Invoke-PilotRun.ps1`, job schema, submitter (Linux side), tests (schema/HMAC/allowlist/gates logic mirrored in Python/Node), r4 zip with hashes, plus V1 hardening | no for building; **yes (APPROVE E) before anything runs** | cloud |
| 3. `-DryRun` first session | yes (APPROVE E) | your PC |
| 4. Sweep `-ngl` and context, pick the config | yes (covered by E, within gates) | your PC |
| 5. Pilot on three licence-confirmed papers (local model only) | needs the papers + licence records from you | your PC |
| 6. Claude run on the same papers and human review | **needs spend approval and raters** | Claude API / people |
| 7. Written evaluation and recommendation (Claude stays default until you approve a change) | no | cloud |

Not requested and not done: any download or install, firewall or security change, remote-access software, Git operation, production or Railway access, API-key change, purchase.

## 8. Execution report (this turn)

| Item | Detail |
|------|--------|
| Commands executed | `get_device_info`; in the device Linux VM: `uname -a; id; echo $HOME; ls $HOME/mnt; which powershell.exe pwsh powershell cmd.exe; cat /proc/version`; `device_list_dir D:\llm`; `computer_resolve_access` (three names); `device_request_folder_access D:\llm` (you approved); in the VM: `ls -la` on `llm`, `health`, `logs`; a Python script that only reads and prints the health report, install record and help text; `grep` on the help text; in the cloud workspace: `ls` of `scripts`, `backend/eval`, `backend/native` |
| Environments | Linux VM on your device (not Windows); cloud workspace. **Nothing ran on Windows** |
| Files changed | none on your PC; in the repo workspace: this document added (uncommitted) |
| Tests executed | none new (no code changed this turn) |
| Failures / unresolved | no Windows execution; V1 to V5 above; port-closure and RAM-recovery statements unverified |
| Approvals needed | decision on section 4 (mailbox agent), then `APPROVE E` per session; later: papers, Claude spend, raters |
