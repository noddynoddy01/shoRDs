# Phase 6B - Local inference pilot: approval package (2026-11-04)

> **REVISION r2 (2026-11-04, 15:5x IST).** The first scripts zip (`shords-pilot6b-scripts.zip`, SHA-256 `69864c2b...b91a0`) is **withdrawn: do not use it.** Step C stopped with "Refusing to touch a path outside D:\llm" because its path check could not accept the root folder itself. The corrected zip is `shords-pilot6b-scripts-r2.zip`; cause, fix, diff and replacement steps are in `12_PHASE6B_R2_PATHGUARD_FIX.md`. The earlier "APPROVE C" you typed was consumed by the failed run and does not carry over: **Step C needs a fresh approval after r2 passes verification. Step D remains unapproved.**

**Status: PREPARATION ONLY.** Nothing in this package has been downloaded, installed, extracted, executed, launched or processed on your machine, and I have run none of the scripts (I have no Windows PowerShell here). No GPU was rented, no money spent, no production system, Git state or credential touched. **I will execute nothing until you approve a step in the chat, and C and D are approved separately.**

> **STATUS UPDATE (2026-11-04, after Step C).** Step C completed on the owner's PC (owner-reported: three files verified, `verified-artifacts.json` present). Scripts are now **revision r3** (`shords-pilot6b-scripts-r3.zip`); the Step D material in sections 9 to 11 below is **superseded by `13_PHASE6B_STEP_D_APPROVAL_PACKAGE.md`** (hardened install, record-driven rollback, Prereq check). Use r3, not r2.

---

## 1. Decisions I need from you (read this first)

| # | Question | My recommendation |
|---|----------|-------------------|
| 1 | Approve **Step C** (download, about 5.3 GiB, nothing is run)? | Yes, after the parser check in section 7 passes |
| 2 | Approve **Step D** (extract + run the program + load the model + three synthetic test prompts)? | Only after C has been verified, as a separate decision |
| 3 | The 4,096-token context you asked for is fine for a *health check* but **too small for the real pilot** (section 6). Accept that Phase 6B proves the machine and the server only, and Phase 6C picks the real context? | Yes |

Anything not listed (Qwen3-4B download, paper processing, the Node pilot driver) is **not** requested here.

## 2. What is verified and what is not

| Item | Status |
|------|--------|
| Release tag, asset names, SHA-256 digests of the llama.cpp zips | Read from the GitHub release page twice (two routes). I read through a summarising fetch tool, not a raw download: **you should compare the hashes with the page yourself** (links in section 3). |
| Model revisions and SHA-256 of the two GGUF files | Read from the Hugging Face Git LFS pointer files at the pinned commit, through two different routes. Same advice: compare with the page. |
| Exact byte size of the two llama.cpp zips | **Not available** to me; GitHub shows rounded MB. Scripts check SHA-256 for them and size for the models. |
| Size of the extracted program folder | **Estimate** 1.0 to 1.8 GiB. Step D prints the real number. |
| llama-server memory use | **Estimate** from a calculator (section 5). The load log is the authority. |
| Whether `llama-server.exe` is code-signed | **Unknown.** Release notes say only the commit is signed. Step D records the Authenticode status. |
| Windows behaviour (Defender, Smart App Control, firewall prompt, NVIDIA shared-memory fallback) | Recalled, not tested on your machine. |
| Scripts | Written and statically linted (ASCII, balanced brackets, no PowerShell 7-only syntax, CRLF, hash manifest). **NOT EXECUTED on any PowerShell by me.** The first real run (Step C Preflight, then Download) exposed a path-check defect, fixed in r2 (see `12_PHASE6B_R2_PATHGUARD_FIX.md`). The checks in section 7 are the gate. |

## 3. Sources, versions, sizes, hashes

### 3.1 llama.cpp runtime (MIT licence, github.com/ggml-org/llama.cpp)

* Release used: **b11669** (continuous build tag). Release page: https://github.com/ggml-org/llama.cpp/releases/tag/b11669
* The release marked "Latest" is **v0.7.0** (2026-10-15). It contains only a pointer file to nightly b11669. Its notes say the default server port changed to 9931, so every command here passes `--port 8080` explicitly. https://github.com/ggml-org/llama.cpp/releases/tag/v0.7.0
* These builds are published as GitHub *pre-releases*. They are official (same organisation and repository) but not "stable" in the old sense. Pinning b11669 means a later build cannot change anything underneath you.

| File | Download URL | Size | SHA-256 (as displayed by GitHub) |
|------|--------------|------|-----------------------------------|
| `llama-b11669-bin-win-cuda-12.4-x64.zip` | https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cuda-12.4-x64.zip | about 254 MB | `c2da1f73ed176ae093ac5aceb978a7b167a16113f6d74c6789eeaee2135cb8dc` |
| `cudart-llama-bin-win-cuda-12.4-x64.zip` (CUDA runtime DLLs the first zip needs) | https://github.com/ggml-org/llama.cpp/releases/download/b11669/cudart-llama-bin-win-cuda-12.4-x64.zip | about 373 MB | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` |

Other b11669 Windows assets, **not** used: CPU build about 18.6 MB (`37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b`), Vulkan about 30.7 MB (`2c07574e7bde71321cb785282b20cc821e951132149eeceeea32ddebdbf0598e`), CUDA 13.4 variants.

**Why CUDA 12.4 and not 13.4:** your driver (592.27) reports CUDA 13.1 compatibility. A CUDA 12.x runtime runs on any newer driver; a CUDA 13.4 build may need a driver that reports 13.4. The 12.4 build is also built for the RTX 30-series architecture, so no first-run shader compilation is expected (unverified). The CPU build is the safe fallback if the GPU build misbehaves.

**What the hash proves:** GitHub computes the digest of the uploaded file. Matching it proves the download is complete and not altered in transit. It does **not** prove the maintainers' build is trustworthy (see risks R1, R2).

### 3.2 Models (Apache-2.0, Qwen team, not gated, no login needed)

| File | Pinned revision | Exact size | SHA-256 |
|------|-----------------|-----------|---------|
| **Qwen3-8B-Q4_K_M.gguf** (target) | `7c41481f57cb95916b40956ab2f0b139b296d974` (repository `Qwen/Qwen3-8B-GGUF`, `main` on 2026-11-04, dated 2025-05-21) | 5,027,783,488 bytes = 4.68 GiB | `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` |
| Qwen3-4B-Q4_K_M.gguf (fallback, **not requested**) | `bc640142c66e1fdd12af0bd68f40445458f3869b` (repository `Qwen/Qwen3-4B-GGUF`) | 2,497,280,256 bytes = 2.33 GiB | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |

* 8B URL: https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf
* 8B page: https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/7c41481f57cb95916b40956ab2f0b139b296d974
* 4B URL: https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf
* The URL contains the commit hash, so the file cannot silently change. Hugging Face redirects the download to its content network (signed, temporary address); this is normal.
* Qwen3-8B is a "thinking" model. The pilot driver already sends `enable_thinking:false`; the health check does too.

### 3.3 Scripts (mine, written for Windows PowerShell 5.1)

`shords-pilot6b-scripts-r2.zip`: 9 files, 25,313 bytes, **SHA-256 `0e4c38adea936c53e4e5e020e868ca4555b6c6852871570df967cd39cfce9108`**. I attach it to this chat; save it to `D:\llm\downloads`.

| File inside `shords-pilot6b-r2\` | Bytes | SHA-256 |
|-------------------------------|------:|---------|
| Phase6B.Common.ps1 (changed: path guard) | 10,617 | `e58c19288363a1175af4f4208bb35f8dd052afc81dce0c038033d22d8ce6fa9f` |
| Step-C-Acquire.ps1 (changed: preflight now runs the guard) | 8,724 | `e8cda5c51a44f858ff9d6720f3eb6240cf6948d384d061cf7cdff9a7625e067a` |
| Test-PathGuard.ps1 (new: path-guard self-test) | 8,215 | `5a89925367732f620db0f5cdbd752d528dbdf4af50e19749c0ea200c8562e63b` |
| Step-D-Run.ps1 (unchanged) | 25,250 | `fdc2e3010381b33902de96d00af9bc5a5c47998b456450ea9ab5a86f3c07be71` |
| Rollback.ps1 (unchanged) | 7,734 | `8f7cc1f725a61883d137405f28a9e049fdb56960b3db6b850dc0d6b5c38e0316` |
| Parse-Check.ps1 (unchanged) | 1,472 | `c6426854166efd7b7e8e8054ed85c576c2244146aa7e59fdb6c4158d86440dd7` |
| Verify-Kit.ps1 (reused from 6A) | 1,398 | `c545c7e2c1d1e8d5869fc5ea7da4261cc8d453d8156c0cb3a646cc8fa6c98e34` |
| README_FIRST.txt | 1,691 | `7bed49be96f995d3492beb2ddbc036eed2cd0dc03a5ed74c9357f91aaa20c233` |
| MANIFEST.sha256.txt | 669 | `fb5b4a2184e248925483a4caecd3931b6adcd708e8907691587baf80f87b8e00` |

## 4. Steps C and D: what each one does and does not do

| | **Step C - Acquire** | **Step D - Install, run, check** |
|---|---|---|
| In one line | Copy three verified files onto D: | Unpack the program, **run** it, load the model, test it |
| Network | **Yes**: https downloads from github.com and huggingface.co (about 5.3 GiB) | **No** internet. Server listens on 127.0.0.1 only; health check talks only to 127.0.0.1 |
| Files created | `D:\llm\downloads\*.zip` (2), `D:\llm\models\Qwen3-8B-Q4_K_M.gguf`, `D:\llm\verified-artifacts.json` | `D:\llm\llama.cpp\b11669\...` (extracted program), `install-record.json`, `server.pid.json`, `logs\*`, `health\*` |
| Program executed | **None.** Only `curl.exe` (ships with Windows) and `Get-FileHash` | **Yes**: `llama-server.exe` (downloaded, maybe unsigned) - `--version`, `--help`, then as a server |
| Memory use | Negligible | About 5 GiB RAM and 1.7 GiB VRAM while the server runs |
| Approval phrase typed by you | `APPROVE C` | `APPROVE D` (Install and Start each ask) |
| Undo | `Rollback.ps1 -Scope Downloads` / `Models` | Stop the server, then `Rollback.ps1 -Scope Install` / `Logs` |
| What can go wrong | Slow download, disk space, hash mismatch (then nothing is renamed or used) | Defender/Smart App Control block, out-of-memory, GPU driver problem, unexpected program behaviour |

Neither step reads or processes any paper, uses the Node pilot driver, touches `D:\shords`, Git, Railway, production, secrets, PATH, the registry, services or the execution policy.

*Mapping from the older lettering in the Phase 6A drafts: old C (downloads) = new C; old D (install) + old E (start server) = new D; old F (process papers) = Phase 6C, not requested.*

## 5. Disk and memory

### 5.1 Disk (D: has 59.3 GiB free)

| Item | Size |
|------|-----:|
| Two llama.cpp zips | about 0.6 GiB |
| Qwen3-8B Q4_K_M | 4.68 GiB |
| **Step C total** | **about 5.3 GiB** |
| Extracted program (Step D) | 1.0 to 1.8 GiB (estimate) |
| Logs and health reports | under 0.1 GiB |
| **Peak after D** | **about 6.5 to 7.2 GiB** (the zips can be deleted afterwards to save 0.6 GiB) |
| Optional 4B fallback | +2.33 GiB |

Step C refuses to start with less than 20 GiB free. A resumed download writes into one `.part` file, so no second copy is needed.

### 5.2 Memory for Qwen3-8B Q4_K_M, context 4,096, one slot

Output of `node scripts/llm_memory_budget.js --ctx 4096` (an **estimate**; fixed GPU overhead 700 MiB and host overhead 600 MiB are assumptions). KV cache is 144 KiB per token, 576 MiB in total at 4,096 tokens.

| `-ngl` (layers on the GPU, of 36) | GPU MiB | RAM MiB | Headroom on a 4 GiB card, after ~600 MiB used by Windows |
|---:|---:|---:|---:|
| 0 | 0 | 5,971 | 3,496 |
| 4 | 1,206 | 5,465 | 2,290 |
| **8 (chosen start)** | **1,711** | **4,960 (4.8 GiB)** | **1,785** |
| 12 | 2,217 | 4,454 | 1,279 |
| 16 | 2,722 | 3,948 | 774 |

For comparison at 8,192 context (what the multi-stage pipeline needs, section 6): `-ngl 8` is 1,839 MiB GPU and 5,408 MiB RAM.

**Your RAM is the tight resource, not the GPU.** The latest reading you gave was 7.08 GB available out of 16 GB. The server needs about 4.8 GiB plus working room, so Step D refuses to start (gate) if available RAM is below **6.5 GiB** (4.5 GiB for the 4B model) or free VRAM below 2,200 MiB. Close browsers and other large programs first. The numbers are provisional: after the first start, send me the health report and I will set `-ngl` from the real load log.

NVIDIA's Windows driver can silently spill GPU memory into system RAM when VRAM is full, which makes things slow instead of failing. The health check records VRAM; please also glance at Task Manager > Performance > GPU > "Shared GPU memory" (it should stay near zero).

## 6. Configuration and a finding about the 4,096 context

**Server command line (the scripts build exactly this):**

```
llama-server.exe --model D:\llm\models\Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --alias qwen3-8b --ctx-size 4096 --parallel 1 --n-gpu-layers 8 --jinja
```

* `--host 127.0.0.1`: reachable from this computer only. `--parallel 1`: one request at a time (recent builds can default to several slots, which would split the context). `--port 8080` is explicit because defaults changed. No API key is needed because nothing is exposed. `--n-gpu-layers 8` is provisional.
* Output goes to `D:\llm\logs\server-<time>.out.log` and `.err.log`.

**Finding (measured against the Phase 6 pipeline's real prompts):** at 4,096 tokens the largest multi-stage ("C") calls (prompt about 9,400 characters plus 1,000 to 1,200 output tokens) are at or over the limit, and the one-shot baseline ("B", up to about 62,900 characters) cannot fit at all; B needs roughly 24,576 tokens, which at about 7 GiB RAM is not feasible on 7.08 GiB available. So 4,096 is right for **this** step (does the machine load the model and answer, how fast, how much memory) and wrong for the pilot itself. **Phase 6C decision, not needed now:** C-only at 8,192 context first, with the baseline B skipped or capped (I would add a `--skip-direct` option to the driver), or a smaller model/shorter documents for B.

## 7. Gate before any approval: the parser check

You approved doing this kind of check in 6A, so it needs no new approval, but it is a file operation, so I list it:

```powershell
# 1. Save shords-pilot6b-scripts-r2.zip to D:\llm\downloads (browser download from this chat), then:
(Get-FileHash -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r2.zip -Algorithm SHA256).Hash.ToLower()
#    must print: 0e4c38adea936c53e4e5e020e868ca4555b6c6852871570df967cd39cfce9108
# 2. Extract (creates D:\llm\shords-pilot6b-r2 with 9 small files; the old shords-pilot6b folder is not touched):
Expand-Archive -LiteralPath D:\llm\downloads\shords-pilot6b-scripts-r2.zip -DestinationPath D:\llm
cd D:\llm\shords-pilot6b-r2
# 3. Read-only checks (nothing is run, no network):
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Kit.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Parse-Check.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-PathGuard.ps1
```

All three must end with "verified" / "parse cleanly" / "behaved as expected". If either prints a problem, stop and paste the output. `-ExecutionPolicy Bypass` applies to that one process only; no setting is saved. You can also open the `.ps1` files in a text editor and read them; each is commented.

## 8. Step C - exact commands (after you approve C)

Preview (read-only, safe any time): checks free space, curl, Smart App Control state, **runs the path-safety check on every folder and file it would use (new in r2; the first Preflight did not, which is how the defect slipped through)**, and lists what would be downloaded.

```powershell
cd D:\llm\shords-pilot6b-r2
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-C-Acquire.ps1 -Action Preflight
```

Download (asks you to type `APPROVE C`; default group = the two zips + Qwen3-8B):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-C-Acquire.ps1 -Action Download
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-C-Acquire.ps1 -Action Verify
```

What it does for each file: `curl.exe --fail --location --proto '=https' --tlsv1.2 --retry 3 --retry-delay 5 --continue-at - --output <file>.part <url>`, then checks size (models) and SHA-256, and **only then** renames `.part` to the final name. A mismatch leaves the `.part` file and stops. Expected duration: minutes to an hour, depending on your line. If it stops half-way, run the same command again; it resumes.

Manual equivalent for any one file (e.g. the model), if you prefer to type it yourself:

```powershell
curl.exe --fail --location --proto "=https" --tlsv1.2 --output D:\llm\models\Qwen3-8B-Q4_K_M.gguf.part "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf"
(Get-FileHash -LiteralPath D:\llm\models\Qwen3-8B-Q4_K_M.gguf.part -Algorithm SHA256).Hash.ToLower()
# only if it equals d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785 :
Rename-Item -LiteralPath D:\llm\models\Qwen3-8B-Q4_K_M.gguf.part -NewName Qwen3-8B-Q4_K_M.gguf
```

(`-Group runtime|model8b|model4b|all` selects other sets; the 4B file is only fetched if you ask for it.)

**If a hash does not match:** do not use the file and do not extract it. (1) Open the source page in your browser and compare the hash there with the "expected" value in the message (a typo on my side is possible). (2) If the page differs from my value, send me both - I will re-verify and re-issue. (3) If the page equals my value but your file differs, delete the `.part` file (`Rollback.ps1 -Scope Downloads`), check disk and network, download again; if it fails twice, stop. (4) Never run a file whose hash is unexplained.

## 9. Step D - exact commands (only after C is verified and you approve D)

```powershell
cd D:\llm\shords-pilot6b-r2
# D1  extract + run --version/--help once (asks: APPROVE D)
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Install
# D2  start the local server (asks: APPROVE D); first load takes 1 to 3 minutes
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Start
# D3  health check
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Health
# D4  stop
powershell -NoProfile -ExecutionPolicy Bypass -File .\Step-D-Run.ps1 -Action Stop
```

`-Action Status` shows RAM, VRAM and the server state any time. `-Ngl 4` (0 to 16) lowers GPU use; `-Model 4b` uses the fallback model.

**D1 Install** re-checks both zip hashes, refuses any zip entry that would land outside the target folder, extracts without overwriting, records the SHA-256 and Authenticode signature of `llama-server.exe`, runs `--version` and `--help` (30 s limit each) and checks that every option the script uses exists in this build.
**D2 Start** checks: no other `llama-server`, port 8080 free, model file unchanged since verification, RAM and VRAM gates. It launches the server hidden, loopback only, and waits up to 5 minutes for `/health`; on failure it stops the process and prints the last 40 log lines.
**D3 Health** is section 10.

Possible Windows prompts: Defender SmartScreen/"unrecognised app" on first run, or Smart App Control blocking the unsigned program (if it is on, **do not turn it off** - it cannot be re-enabled - tell me instead); a Windows Firewall dialog (press **Cancel**; the server listens on loopback only).

## 10. Health-check procedure and pass criteria

`Step-D-Run.ps1 -Action Health` takes RAM/VRAM/server-memory samples before, every 1.5 s during, and after three **synthetic** requests (no paper, no real text), then writes `D:\llm\health\health-<time>.json` and a load-log extract `loadlog-extract-<time>.txt`.

| Test | Prompt | Purpose |
|------|--------|---------|
| T1 | "Reply with the single word: ready." (max 8 tokens) | Round trip, first-token latency |
| T2 | Two-sentence summary of a 60-word text (max 120 tokens) | Typical generation speed |
| T3 | 30 numbered lines + "how many lines?" (max 12 tokens) | Prompt-processing speed on about 500 tokens |

Recorded: wall time per request, prompt and generated token counts, the server's own prompt tokens/s and generation tokens/s, finish reason, whether the answer contains think tags; the server properties (`n_ctx`, slots); load-log lines about offloaded layers, model/KV/compute buffers; lowest available RAM, highest VRAM, server working set; established network connections of the server process; any firewall rule mentioning llama.

**Pass criteria (all must hold):** `/health` answers; `n_ctx` = 4096; exactly 1 slot; all three requests return HTTP 200; no think tags; available RAM never below 1.0 GiB; VRAM used never above 3,600 MiB; no established connection to a non-local address. Exit code 1 and a FAIL line if any fails.
**Not a pass/fail criterion but I will read:** the generation speed (expect low single-digit to about 10 tokens/s with 8 of 36 layers on the GPU - an expectation, not a measurement), the layer split in the load log, and Task Manager's "Shared GPU memory".

Please send me the `.json` and the load-log extract. They contain file paths and your Windows user name in paths, but no secrets or paper content.

## 11. Rollback and cleanup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope All -List     # shows what would go; changes nothing
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope Server        # stop the server
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope Install       # delete extracted program + records
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope Models
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope Downloads     # the two zips and *.part only
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope Logs
powershell -NoProfile -ExecutionPolicy Bypass -File .\Rollback.ps1 -Scope All           # all of the above; kit folders kept unless -IncludeKit
```

Deleting asks you to type `DELETE`, is permanent (no Recycle Bin), refuses anything outside `D:\llm`, refuses junctions/symbolic links, and will not run while a server is up. Fully by hand: stop the process in Task Manager, delete `D:\llm\llama.cpp`, `D:\llm\models`, `D:\llm\logs`, `D:\llm\health` and the zips.

Left behind on purpose (check them if you want a perfectly clean system): the NVIDIA shader cache `%LOCALAPPDATA%\NVIDIA\ComputeCache` (may not even exist; safe to delete), Windows Defender scan history, PowerShell command history, and a Windows Firewall rule if you ever clicked "Allow" in the prompt (Windows Security > Firewall > Allowed apps; remove `llama-server`). Nothing else is changed outside `D:\llm`: no PATH, registry, service, scheduled task or policy.

## 12. Risks

The full register is `11_PHASE6B_RISK_REGISTER.md`. The ones that matter for your decision: unsigned/unknown-provenance binary and hashes that prove integrity but not trust (R1, R2); RAM headroom of about 0.6 GiB at your last reading (R10); scripts never run on real PowerShell (R11); 4,096 context too small for the real pilot (R12); licensing is clean for a local evaluation (Apache-2.0 model, MIT runtime, CUDA runtime DLLs under NVIDIA's redistribution terms - recalled, unverified) but needs review before any commercial or user-facing use (L1 to L3).

## 13. Approval requested

Nothing is requested for execution today except your decision on these, each separately:

1. **Review gate (you run it; it executes none of the steps and uses no network):** save the scripts zip, check its hash, extract, run `Verify-Kit.ps1`, `Parse-Check.ps1` and `Test-PathGuard.ps1`, and tell me the output. I need this output before C is meaningful, because the step scripts have never run on a real PowerShell.
2. **"Approve C"**: Step C Download of the two llama.cpp zips and Qwen3-8B Q4_K_M from the URLs above, to `D:\llm`, with hash verification, and nothing run.
3. **"Approve D"** (separate message, after C is verified): Step D1 Install, D2 Start and D3 Health as above, with `-Ngl 8`, context 4,096, loopback only.

I will wait for your explicit approval and will not execute, download or process anything on my own.
