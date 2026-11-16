# Phase 6B - Step D approval package (2026-11-04, scripts revision r3)

## Verdict: **READY FOR OWNER APPROVAL - conditional on three read-only gates (section 1).**

Nothing in this package has been extracted, installed, executed, started or downloaded on your PC by me, and I have run none of the PowerShell (there is none here). No firewall, Windows security, PATH, registry, Git, credential, production or purchasing change. **Step D remains unapproved until you say so in the chat.**

Why "ready" and still conditional: my review of the r2 Step D / Rollback found real gaps (section 2), which I fixed in **r3**. Every remaining unknown (the Visual C++ runtime on your PC, the contents of the two zips, whether the program is signed) is handled by a check that **stops before changing anything**, so a wrong guess costs a refused run, not a damaged system. What I cannot remove is the nature of Step D itself: you will be running a third-party, possibly unsigned program that I have never seen run.

---

## 1. Gates before you approve (all read-only; you run them)

| # | Gate | Command (in the folder you extract r3 into) | Pass condition |
|---|------|------|-----|
| G1 | Replace the scripts with r3 and verify them | see section 9 | zip hash matches; `Verify-Kit.ps1`, `Parse-Check.ps1`, `Test-PathGuard.ps1` all pass |
| G2 | Prerequisites on **your** PC | `.\Step-D-Run.ps1 -Action Prereq` | `PREREQUISITES: all OK.` (this is where a missing Visual C++ runtime shows up) |
| G3 | Preview of the undo | `.\Rollback.ps1 -Scope StepD -List` | `Nothing to delete for this scope` (before Step D) |

Please send me the output of G1 to G3. Step C evidence you reported (three files verified, `verified-artifacts.json` present) is taken as owner-reported; G2 re-hashes both zips and checks the model entry, so it also re-confirms it.

## 2. What the review of r2 found, and what r3 changed

| # | Finding in r2 | Risk | r3 fix |
|---|---------------|------|--------|
| F1 | Extraction only checked that each target string started with the destination; no check for links on the path, reserved device names (`CON`, `NUL`, ...), alternate data streams, trailing dot/space, non-ASCII names, duplicate entries, or archive size | Medium | Pass 1 validates **every** entry of **both** zips before writing anything: `Test-ZipEntryName` (no absolute names, no colon, **no `..` at all**, canonical path inside the install folder, no device names/ADS/wildcards/trailing dot or space/non-ASCII), `Assert-UnderRoot` (inside `D:\llm`, no junction/symlink on the chain), no duplicate targets, no pre-existing target, at most 2,000 files, at most 6 GiB uncompressed, free disk at least that plus 2 GiB |
| F2 | The second zip could silently skip a file the first zip also contains | Low | A duplicate target between or within the zips is now a hard stop before any extraction |
| F3 | A failed extraction left no record of what was created | Medium | The install record (list of every planned file, whether the parent folder is new) is written **before** the first file; Rollback deletes exactly those |
| F4 | `Rollback -Scope Install` deleted the whole `D:\llm\llama.cpp` folder tree (could include things you add later) and had no way to undo Step D without also being able to remove downloads in the same command | **High** (for point 5) | Rollback is now record-driven: deletes only the files listed in `install-record.json`, then folders only if empty, then the record and pid file. Unlisted files are left and reported. New `-Scope StepD` = Install + Logs, which cannot touch zips or the model. No recursive delete anywhere |
| F5 | Nothing checked for the Microsoft Visual C++ runtime | **High** (program would fail to start) | New read-only `-Action Prereq`; Install refuses to run if `vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll` or `vcomp140.dll` are missing from System32; exit codes `0xC0000135`, `0xC000007B`, `0xC0000142` are explained if the program still fails |
| F6 | No check that the CUDA DLLs ended up next to `llama-server.exe` | Medium | Install lists `ggml-cuda.dll`, `cudart64_*`, `cublas64_*`, `cublasLt64_*` as expected and warns if missing; it also reads (does not execute) the program file for DLL names and lists any that are neither next to it nor in System32 |
| F7 | A recycled process id could make `Stop` kill an unrelated program | Low | The stored process must be named `llama-server` **and** have started within 5 minutes of the recorded start time |
| F8 | Model freshness was a string comparison of a timestamp (fragile) and the program file was not re-checked after install | Low | Timestamp compared as UTC ticks; `llama-server.exe` SHA-256 compared with the install record at every Start; optional `-RehashModel` re-computes the model hash (about 1 minute) |
| F9 | "Listening on 127.0.0.1 only" was set by an argument but never verified | Medium | After start, the server's listening sockets are read; anything other than `127.0.0.1`/`::1` stops the server. Health and Status repeat the check; a manual command is given in section 7 |
| F10 | VRAM could not be checked if `nvidia-smi` was missing, and the script just continued | Medium | With `-Ngl` above 0 and no `nvidia-smi`, Start refuses |
| F11 | No protection against memory exhaustion while loading | Medium | Emergency brake: if available RAM falls below 0.7 GiB while loading (0.5 GiB during the health prompts) the server is stopped |
| F12 | `ExitCode` can come back empty with `Start-Process -PassThru` in Windows PowerShell 5.1 | Low | The process handle is cached right after start |
| F13 | Reserved device names were not refused by the shared path guard | Low | Added to the guard for every script; 8 new self-test cases |

Not changed (checked, fine): the Step D command line, the gates' numbers, Step C, `Verify-Kit.ps1`, `Parse-Check.ps1`.

---

## 3. Every operation Step D performs

Nothing happens at all until you type `APPROVE D` at a prompt. Step D has two approval points: **D1 Install** and **D2 Start**. I recommend approving them one after the other, not together (section 12).

| Action | Needs `APPROVE D` | What it does | Writes | Network | Runs a downloaded program |
|--------|:--:|----|----|----|:--:|
| `Prereq` | no | Reads: PowerShell bitness, Visual C++ files in System32, `nvidia-smi`, RAM, VRAM, disk, port 8080, other `llama-server` processes, hashes of the two zips, the model entry in `verified-artifacts.json`, firewall rules whose name contains "llama" | nothing | none | no |
| `Install` (D1) | yes | See 3.1 | files under `D:\llm\llama.cpp\b11669`, `D:\llm\install-record.json`, `D:\llm\logs\version-*`, `help-*` | none | **yes**: `llama-server.exe --version` and `--help`, each once, 30-second limit, hidden window |
| `Start` (D2) | yes | See 3.2 | `D:\llm\logs\server-*.log`, `D:\llm\server.pid.json` | loopback only | **yes**: `llama-server.exe` as a server |
| `Health` | no | See section 8 | `D:\llm\health\*` | loopback only | no (talks to the running server) |
| `Stop` | no | Stops only the server this package started | deletes `server.pid.json` | none | no |
| `Status` | no | Prints RAM, VRAM, server state, listening sockets, `/health` | nothing | loopback only | no |

### 3.1 Install (D1) in order

1. Refuses if `verified-artifacts.json` is missing, if the Visual C++ runtime is incomplete, if PowerShell is 32-bit, if `install-record.json` or `D:\llm\llama.cpp\b11669` already exists.
2. Asks for `APPROVE D`.
3. Re-computes SHA-256 of both zips and compares with the expected values (c2da1f73...8dc and 8c79a9b2...e1d6).
4. **Pass 1 (writes nothing):** opens both zips, validates every entry (section 4) and prints `Validated N files, M MiB uncompressed ...`.
5. **Pass 2:** writes `install-record.json` (status `extracting`, the list of files), creates `D:\llm\llama.cpp` (only if new) and `D:\llm\llama.cpp\b11669`, creates sub-folders it needs, and extracts file by file with overwrite disabled. Status becomes `extracted`.
6. Locates `llama-server.exe`; lists the DLLs next to it; warns about missing CUDA files; reads (does not run) the program file for DLL names.
7. Reads the Authenticode signature. `HashMismatch` (signed but altered) stops everything without running it. `NotSigned` is expected to be possible and is recorded, not blocked.
8. Runs `llama-server.exe --version` and `--help` (each captured to `D:\llm\logs`), checks that all options Step D uses are listed (`--model --host --port --alias --ctx-size --parallel --n-gpu-layers --jinja`).
9. Updates the install record (executable hash, signature status, DLL list, exit code).

**Extraction destinations:** exactly `D:\llm\llama.cpp\b11669\` (+ sub-folders from the zips). **Executables:** `llama-server.exe` is the only one run by the scripts; the zips may contain other `.exe` tools (for example `llama-cli.exe`, `llama-bench.exe`); they are extracted but never run. **DLLs:** extracted next to the programs; the scripts do **not** copy anything into System32, do **not** change PATH, and register nothing. At launch the working folder is the folder of `llama-server.exe`; Windows looks for DLLs in the program's own folder first, then System32, so the CUDA runtime DLLs from the second zip are found there as long as they sit beside the executable (the Install check confirms this) and the Visual C++ and NVIDIA driver DLLs come from System32.

### 3.2 Start (D2) in order

1. Reads the install record and refuses unless status is `extracted` and `--version` exited 0; re-hashes `llama-server.exe` against the record; checks the model file size and timestamp against `verified-artifacts.json` (and its hash with `-RehashModel`).
2. Refuses if any `llama-server` is already running or port 8080 is in use.
3. Gates: available RAM at least **6.5 GiB**, free VRAM at least **2,200 MiB** (at `-Ngl 8` or more), `nvidia-smi` present. Nothing starts if a gate fails.
4. Prints the exact command line and asks for `APPROVE D`.
5. Launches hidden, output to `D:\llm\logs\server-<time>.out.log` and `.err.log`, writes `server.pid.json`, waits up to 5 minutes for `/health` with the memory brake active.
6. Reads the server's listening sockets; stops the server if any is not loopback.
7. Prints process id, working set, available RAM, VRAM.

**Model configuration and server command line (exactly):**

```
D:\llm\llama.cpp\b11669\llama-server.exe --model D:\llm\models\Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --alias qwen3-8b --ctx-size 4096 --parallel 1 --n-gpu-layers 8 --jinja
```

| Setting | Value | Why |
|---------|-------|-----|
| Model | Qwen3-8B Q4_K_M, 5,027,783,488 bytes, SHA-256 verified in Step C | agreed first model |
| Context | **4,096** tokens (health-check size only; the real pilot needs more, Phase 6C) | your instruction; about 576 MiB of KV cache |
| Parallel requests | **1** | no split of the context between slots |
| GPU offload | **8 of 36 layers, provisional** (`-Ngl 0..16` allowed) | about 1.7 GiB VRAM; set properly from the load log after the first run |
| Binding | **127.0.0.1:8080** | this computer only; port explicit because defaults changed in recent llama.cpp |
| `--jinja` | on | uses the model's chat template; per-request `enable_thinking:false` is sent by the health check |
| API key, web UI | none / default | loopback only; nothing is exposed |
| Threads, batch, flash-attention, KV type | build defaults | not tuned yet; tune after the first measurement |

**Firewall behaviour:** the scripts never create, change or remove a firewall rule (they only read rule names in `Prereq` and `Health`). A program that listens only on loopback is not normally subject to the inbound-connection prompt (recalled, not tested on your PC). If a Windows Defender Firewall dialog appears anyway: **close it or press Cancel**, do not tick "Private" or "Public", and tell me. **Process management:** the server is started with `Start-Process` (hidden, no window); closing the PowerShell window does not stop it; a reboot does. The script stores the process id and start time, and `Stop` only acts on a process that is named `llama-server` and matches that start time.

---

## 4. Archive extraction safety (requirement 3)

| Threat | Protection | Where | Tested here? |
|--------|-----------|-------|:--:|
| Entry with `..` (zip-slip), including `a/../b` | any `..` segment refused outright | `Test-ZipEntryName` | yes (4 cases, mirror + self-test) |
| Absolute entry (`/x`, `\x`, `C:\x`) | refused | same | yes |
| Alternate data stream (`x.dll:evil`) | any colon refused | same + `ConvertTo-CanonPath` | yes |
| Reserved device names (`CON`, `NUL`, `AUX`, `COMn`, `LPTn`, `CONIN$`), with or without extension | refused | `ConvertTo-CanonPath` | yes |
| Trailing dot/space, wildcard characters, non-ASCII or control characters | refused | same | yes |
| Backslash vs slash spelling of the same traversal | both treated as separators before checking | same | yes |
| Path outside the install folder after normalisation | `Test-PathWithinRoot` against `D:\llm\llama.cpp\b11669` on a whole-segment boundary, case-insensitive | same | yes |
| **Junction or symbolic link** already on the path (including `D:\llm`, `D:\llm\llama.cpp` and sub-folders) | `Assert-UnderRoot` walks the chain and refuses any existing reparse point | Pass 1, per entry | logic yes (fake links); real links: your PC |
| Links **inside** the archive | ZIP has no NTFS junctions; the .NET `ExtractToFile` call writes ordinary files only (it does not interpret Unix-style link attributes), so an entry that claims to be a link would become a plain file | Pass 2 | by design (recalled .NET behaviour, not tested) |
| Two entries with the same target / same name differing in case | hard stop before writing | Pass 1 | source check only |
| Zip bomb | at most 2,000 files, 6 GiB uncompressed, disk-space check | Pass 1 | source check only |
| Partial extraction after an error | record written first; Rollback removes exactly the listed files | Pass 2 / Rollback | source check only |

Residual limits: (a) a junction created **between** Pass 1 and Pass 2 (a race by another program) is not caught; (b) the self-test and my mirror test exercise the logic, not the real file system; (c) the entry names inside the two zips are unknown to me (I could not download them), so a legitimate non-ASCII or oddly named entry would make Install **refuse** (safe, but then you would send me the message).

## 5. Extraction cannot overwrite unrelated files (requirement 4)

* The install folder must **not exist** (`D:\llm\llama.cpp\b11669`) and `install-record.json` must not exist, or Install stops before approval is even asked.
* Pass 1 refuses if **any** target path already exists, which also covers files in a folder that somehow appeared.
* `ExtractToFile(..., overwrite = $false)` throws instead of replacing a file.
* All paths are inside `D:\llm\llama.cpp\b11669`; the guard forbids anything outside `D:\llm` at all. `D:\shords`, `D:\Tools`, `C:\` and your home folder cannot be reached.
* Duplicate targets between the two zips stop the install (no silent skip).

## 6. Rollback touches only what Step D created (requirement 5)

| Command | Deletes | Never touches |
|---------|---------|---------------|
| `Rollback.ps1 -Scope Server` | nothing (stops the server) | everything |
| `-Scope Install` | exactly the files in `install-record.json` (listed by name), then folders it created if empty, then `install-record.json`, `server.pid.json` | zips, model, `verified-artifacts.json`, logs, kit, anything unlisted inside the program folder (left and reported) |
| `-Scope Logs` | files named `server-*`, `version-*`, `help-*`, `health-*`, `loadlog-extract-*` in `logs` and `health`, then those folders if empty | everything else |
| **`-Scope StepD`** | Install + Logs | **zips, model, `verified-artifacts.json`, kit** |
| `-Scope Downloads` / `Models` | the two runtime zips and `.part` files / the `.gguf` files, and their entries in `verified-artifacts.json` | everything else; **run these only if you want the downloads gone** |
| `-Scope All` | StepD + Models + Downloads (kit only with `-IncludeKit`) | - |

Every scope: `-List` first (changes nothing); then you type `DELETE`; deletion is by exact file name through the same path guard; there is no recursive delete; if no install record exists, nothing under the program folder is deleted. Files you or Windows changed after install but that are on the list are still deleted (they are "ours"); files not on the list are never deleted.

## 7. Stopping the server and verifying 127.0.0.1-only (requirement 8)

```powershell
cd D:\llm\shords-pilot6b-r3
# stop (always allowed, no approval needed)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Stop
#   expected: "Stopped llama-server (process N). Available RAM now X GiB."  then  "Port 8080 is closed."

# while it runs: what is it listening on? (read-only)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Status
#   expected line: "Listening sockets: 127.0.0.1:8080   (loopback only - OK)"
Get-NetTCPConnection -State Listen -LocalPort 8080 | Select-Object LocalAddress, LocalPort, OwningProcess
#   expected: exactly one row, LocalAddress 127.0.0.1, LocalPort 8080
netstat -ano | findstr :8080
#   expected: "TCP    127.0.0.1:8080   0.0.0.0:0   LISTENING   <pid>"; there must be NO line showing 0.0.0.0:8080, [::]:8080 or your LAN address as the local address
```

If you cannot use the script: Task Manager > Details > `llama-server.exe` > End task. Closing the PowerShell window does **not** stop it. Do not use `Stop-Process -Name llama-server` unless Status says no server of ours exists and you are sure which process it is.

## 8. Health check and memory safeguards (requirement 7)

Your hardware: Intel i5-12450H, 16 GB RAM (**9.18 GiB available** at your Step C preflight; 7.08 GiB earlier), RTX 3050 Laptop GPU 4,096 MiB, driver 592.27, D: 59.3 GiB free.

| Safeguard | Value | Effect |
|-----------|-------|--------|
| Expected use, 8B Q4_K_M, ctx 4,096, 8 layers on the GPU | about 4.8 GiB RAM, about 1.7 GiB VRAM (estimate from a calculator, not measured) | leaves about 4.3 GiB RAM at your 9.18 GiB reading, about 1.8 GiB VRAM after Windows' own use |
| RAM gate at Start | available at least 6.5 GiB (4.5 GiB for `-Model 4b`) | refuses to start otherwise |
| VRAM gate at Start | free at least 2,200 MiB (at `-Ngl 8`+); `nvidia-smi` required unless `-Ngl 0` | refuses to start otherwise |
| Memory brake | available RAM below 0.7 GiB while loading, below 0.5 GiB during the health prompts | stops the server |
| Health pass criteria | available RAM never below 1.0 GiB; VRAM used never above 3,600 MiB; no think tags; HTTP 200 on three synthetic prompts; context 4,096; one slot; listening sockets loopback only; no established non-local connection; brake not triggered | exit code 1 and a FAIL line otherwise |
| Windows shared-GPU-memory spill | not measurable by the script | you read Task Manager > Performance > GPU > "Shared GPU memory" during the test (should stay near zero) and tell me |

The model file is memory-mapped, so Windows will show "Standby/Cached" memory growing; "available" memory is what the script watches. Close browsers and large programs first. If a gate refuses, the remedy is to close programs and try again. I would change `-Ngl` only from the real load log after the first run (a higher `-Ngl` moves memory from RAM to VRAM, and your VRAM margin is only about 1.8 GiB). `-Model 4b` is a fallback only if you separately approve its download.

## 9. Replacement of r2 by r3 and fresh verification

r3 extracts to its own folder; nothing is deleted or overwritten; do not use the r2 folder any more.

1. Save `shords-pilot6b-scripts-r3.zip` to `D:\llm\downloads`.

```powershell
# a) zip hash - must print exactly:  ff9d63d07c000470c8f47734657406c2b3685cbe41aaaaab5b72f203c589234c   (32,086 bytes)
(Get-FileHash -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r3.zip -Algorithm SHA256).Hash.ToLower()
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r3.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6b-r3
# b) read-only checks
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1       # Kit verified: 8 files match the manifest.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1      # 7 lines "OK", then: All 7 scripts parse cleanly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-PathGuard.ps1   # All 90 path-guard cases behaved as expected.
# c) gates G2 and G3
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Prereq
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope StepD -List
```

| File in `shords-pilot6b-r3\` | Bytes | SHA-256 |
|------------------------------|------:|---------|
| Phase6B.Common.ps1 | 15,156 | `15a5c28417f82b385fb6c3047233e8464c10bedeecbbd7a427ad0e8b513ab8cc` |
| Step-D-Run.ps1 | 38,217 | `c9a82e32df8b64d30fffae8fe6a986414f7701a35f9994a8a66e622e9cfc992e` |
| Rollback.ps1 | 11,000 | `0f13efc1737f5a8a840af011c39d6d0adc66d2e7d22047fc4d6a7e049ac88d3a` |
| Test-PathGuard.ps1 | 11,730 | `aa26cbd86581833759a7cc9cc189d5c6febd1a922bc92f4621b6ee1659ad154b` |
| Step-C-Acquire.ps1 (unchanged) | 8,724 | `e8cda5c51a44f858ff9d6720f3eb6240cf6948d384d061cf7cdff9a7625e067a` |
| Parse-Check.ps1 (unchanged) | 1,472 | `c6426854166efd7b7e8e8054ed85c576c2244146aa7e59fdb6c4158d86440dd7` |
| Verify-Kit.ps1 (unchanged) | 1,398 | `c545c7e2c1d1e8d5869fc5ea7da4261cc8d453d8156c0cb3a646cc8fa6c98e34` |
| README_FIRST.txt | 1,875 | `9df73a44b0c483aa182d64ce613659b05d0c8a9d655493f329464080fb39edfb` |
| MANIFEST.sha256.txt | 669 | `fd04268020b04dda3213d85176afb1b9eb85592d57d73e248650ee63e2f487c8` |

**Expected `Prereq` output (shape, not measured):** `PowerShell : 5.1.x (64-bit)`; four `present <version>` lines for the Visual C++ files; `Visual C++ 2015-2022 x64: OK`; `nvidia-smi : C:\Windows\System32\nvidia-smi.exe`; `RAM : ~9 GiB available of 15.x GiB`; `VRAM : ~3,000+ MiB free of 4096`; `Port 8080 : free`; `Other llama-server : none`; two `hash OK` lines; `Model ... present, listed in verified-artifacts.json`; `Firewall rules "llama" : none (expected)` (or "could not be read" without admin rights); `PREREQUISITES: all OK.`

## 10. Missing runtime dependencies (requirement 9)

| Dependency | Status | Handling |
|------------|--------|----------|
| **Microsoft Visual C++ 2015-2022 Redistributable (x64)** (`vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll`, `vcomp140.dll`) | **Unknown on your PC.** llama.cpp's Windows builds are made with Microsoft's compiler and, as far as I know, do not bundle these files (recalled, not verified: I could not open the zips). Very common on Windows 11 because other software installs it | `Prereq` checks; Install refuses without it. If missing: the fix is Microsoft's own installer (as far as I know `https://aka.ms/vs/17/release/vc_redist.x64.exe`, listed on Microsoft Learn under "latest supported Visual C++ Redistributable downloads"). That is a **download plus an installation that changes the system (writes to System32 and the registry)**, so it needs a separate approval from you; I have not prepared or run it |
| CUDA runtime (`cudart64_12.dll`, `cublas64_12.dll`, `cublasLt64_12.dll`) | Inside the second zip (names recalled) | Install checks they are beside the executable. No CUDA Toolkit install is needed |
| NVIDIA driver (`nvcuda.dll`, `nvidia-smi.exe`) | Your driver 592.27 provides both | `Prereq` and Start check `nvidia-smi` |
| Windows 10/11 64-bit, .NET Framework 4.x, PowerShell 5.1 | Present (you ran 5.1) | `Prereq` checks the PowerShell is 64-bit |
| Other DLL names mentioned inside `llama-server.exe` | Unknown | Install lists any that are neither beside the program nor in System32 (informational: some are optional backends) |

## 11. Risks (summary; full list in `11_PHASE6B_RISK_REGISTER.md`)

| Risk | Likelihood | Impact | Control | Residual |
|------|:--:|:--:|---------|:--:|
| Running an unsigned third-party binary (it cannot be proven benign by a hash) | M | H | Pinned official release; hashes checked twice; runs as normal user; loopback only; no admin; Defender on; signature status recorded; stop and rollback one command away | M |
| Visual C++ runtime missing | M | L | Prereq / Install refuse before running anything | L |
| Defender or Smart App Control blocks or quarantines files (Smart App Control was reported off) | L-M | L | Install reports the exit code; never disables protection; a quarantined file is simply re-obtained in a new Step C | L |
| Out-of-memory, system slowdown | M | M | RAM and VRAM gates, memory brake, `Stop` | L-M |
| NVIDIA driver spills VRAM into system RAM (slow, not a failure) | M | L | You watch Shared GPU memory; lower `-Ngl` | L |
| A script defect (never executed on Windows by me; Step C's r1 defect was exactly this kind) | M | M | Every step fails closed with "STOPPED:" and leaves a record; Prereq/List/Parse/self-test first | M until the first real run |
| Server reachable from the network | L | M | `--host 127.0.0.1`; listener verified by script and by you; Cancel any firewall prompt | L |
| Rollback deletes something it should not | L | H | Record-driven, exact names, `-List` first, no recursion, never zips/model in `StepD` scope | L |
| Logs and health reports contain local paths/user name | M | L | No secrets or paper text; you choose what to send | L |

## 12. Approval requested (two separate decisions)

I recommend splitting Step D so you can look in between:

* **D1 - Install:** *"I approve D1: extract the two verified llama.cpp zips into `D:\llm\llama.cpp\b11669` and run `llama-server.exe --version` and `--help` once."* Then you send me the Install output.
* **D2 - Start and health check:** *"I approve D2: start the local server on 127.0.0.1:8080 with ctx 4096, 1 slot, -Ngl 8 and run the health check."* Only after D1 looks right.

Not requested: any download or installation (including the Visual C++ Redistributable and the Qwen3-4B model), paper processing, firewall or security changes, Git, production, or the Node pilot driver. If you approve only part of this, tell me which part and nothing else will run.

I will wait for your explicit approval and execute nothing.
