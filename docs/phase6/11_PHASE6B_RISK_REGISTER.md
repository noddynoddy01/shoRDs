# Phase 6B - Security, licensing and compatibility risk register (2026-11-04)

Likelihood / impact: L = low, M = medium, H = high. "Residual" is after the mitigation shown. Nothing here has been tested on the owner's machine.

## Security

| ID | Risk | L | I | Mitigation in this package | Residual |
|----|------|---|---|----------------------------|----------|
| R1 | `llama-server.exe` and the DLLs are prebuilt binaries from a continuous build; release notes say only the commit is signed, so the executables may be **unsigned** and Windows reputation systems may not know them | M | H | Official repository and release only; pinned tag b11669; SHA-256 checked; Authenticode status recorded at install; runs as the normal user (no administrator); loopback only; no files outside `D:\llm` written by the script; Windows Defender stays on; rollback deletes everything | M. Trust in the maintainers is still assumed. Optional extra: upload nothing, but compare with a Defender scan (right-click > Scan with Microsoft Defender) before step D |
| R2 | A matching hash proves transport integrity, not that the release is benign (GitHub displays the digest of whatever was uploaded; no separate signed checksum file) | L | H | Same as R1; hashes also read twice by me; you compare with the page in your browser | M-L |
| R3 | A hash or URL in this package is wrong (my transcription, or the fetch tool summarised wrongly) | L | M | Two independent read routes; hash comparison against the page by the owner is requested; scripts refuse on mismatch and never rename an unverified file | L |
| R4 | Defender or Smart App Control blocks/quarantines the program; a quarantine can delete a downloaded file | M | L | Preflight prints the Smart App Control state; if it is on, stop and report - do not disable it (irreversible); Step D checks the exit code of `--version` | L |
| R5 | Local network exposure: a model server reachable by other devices or other local programs | L | M | `--host 127.0.0.1` explicit; health check records established non-local connections and firewall rules; if Windows shows a firewall dialog, press Cancel. Any local program can still call a loopback port: stop the server when not in use | L |
| R6 | Zip-slip (a zip entry that writes outside the target folder) | L | H | Install checks every entry's resolved path before extracting anything; never overwrites; extraction target is under `D:\llm\llama.cpp\b11669` | L |
| R7 | A deletion script removes the wrong thing | L | H | Rollback lists first (`-List`), requires typing `DELETE`, only deletes named paths under `D:\llm`, refuses junctions/symlinks, never touches the kit folders unless `-IncludeKit`; the 6A restriction on deleting backups is unaffected (nothing outside `D:\llm`) | L |
| R8 | Logs/health reports contain local paths and user name; if later pasted into tickets they leak that | M | L | Reports contain no secrets or paper text; the owner chooses what to send; do not post them publicly | L |
| R9 | Model output is untrusted (prompt injection via papers, wrong claims) | n/a for 6B | - | 6B sends only synthetic prompts. For 6C: the Phase 6 claim guard and validation stay in force; output is never executed | Deferred to 6C |

## Operational and compatibility

| ID | Risk | L | I | Mitigation | Residual |
|----|------|---|---|------------|----------|
| R10 | **Available RAM is the binding limit**: 7.08 GiB available vs about 4.8 GiB expected use at ngl 8 and context 4,096. A browser or IDE can push the machine into paging; the NVIDIA driver can also spill VRAM into system RAM | M | M | RAM and VRAM gates before start (6.5 GiB / 2,200 MiB); sampling during requests; fail criteria; `-Ngl` adjustable; 4B fallback with a lower gate; stop and Rollback are one command; close other programs first | M |
| R11 | **Scripts were never executed by me on Windows PowerShell 5.1**; a logic error may appear at run time. **Realised once:** the first Step C run stopped because the path check refused the root folder (fixed in r2, doc 12; it failed safe, nothing was written). Further defects are still possible in code paths not yet run (download, Step D) | M | M | Static lint, parser check by the owner, preview/list modes first, every step stops with a "STOPPED:" message and changes nothing further, partial downloads kept as `.part`, manual equivalents given for Step C | M until the first real run; then I fix defects |
| R12 | 4,096 context is too small for the multi-stage pipeline's largest calls and far too small for the one-shot baseline | H (for 6C) | M | 6B is scoped to a health check; 6C needs a context/baseline decision (C-only at 8,192 first; add a skip/cap option to the driver) | Open until 6C is decided |
| R13 | llama.cpp is a fast-moving project: defaults change (default port changed in v0.7.0), options are renamed, a later build may behave differently | M | L | Pinned tag; every flag explicit; Install checks `--help` for each flag used; no auto-update | L |
| R14 | The b11669 build or the CUDA 12.4 runtime does not work with driver 592.27 or the RTX 3050 | L | L | Driver reports CUDA 13.1 (a 12.x runtime is expected to be compatible); fallback: CPU build (about 18.6 MB; hash in the package) at `-Ngl 0`, which is slower but needs no GPU | L |
| R15 | Qwen3 "thinking" mode burns tokens and can leak think tags into outputs | M | L | `enable_thinking:false` per request (health check and pilot driver); `--jinja` so the chat template is applied; health check fails if think tags appear | L |
| R16 | Laptop thermals/power: sustained GPU/CPU load throttles, plugged-in vs battery changes speed | M | L | Run plugged in; the health check is short (3 small requests); latency numbers are indicative only | L |
| R17 | Download sources unavailable, changed or rate-limited (GitHub, Hugging Face); revision drift | L | L | Pinned commit hash in the model URL; pinned release tag; resume supported | L |
| R18 | Node.js v24.16.0 vs the versions I tested (22.23.4, 24.22.1) for the later pilot driver | L | L | Suite passes on both; the driver uses only built-ins; not used in 6B | L |
| R19 | Disk: a full D: during download | L | L | 20 GiB gate (59.3 GiB free; need about 7 GiB) | L |

## Licensing

| ID | Item | Status | Note |
|----|------|--------|------|
| L1 | Qwen3-8B / Qwen3-4B weights | Apache-2.0 (model card), not gated, no acceptance form | Verified on the model page; permits commercial use with notice and licence text. Keep the licence and attribution if weights are ever redistributed or served to users. Apache-2.0 carries no warranty |
| L2 | llama.cpp | MIT | Recalled and consistent with the repository; permissive |
| L3 | CUDA runtime DLLs in `cudart-...zip` | NVIDIA CUDA Toolkit EULA (redistributable runtime files) | **Recalled, unverified.** Fine for local evaluation. Check the EULA attachment before bundling the DLLs into anything shipped |
| L4 | Papers used in the pilot (6C) | Licence-confirmed only | Unchanged rule: no unconfirmed or restricted papers; 6B uses none |
| L5 | Outputs of the model | Apache-2.0 places no restriction on outputs | The product's existing claim-guard and evidence rules still apply to anything shown to users |
| L6 | Production use of local inference | Not approved | Claude remains the production default; any local-model path is a separate, later decision with its own review |

## What would change my recommendation

* Defender flags `llama-server.exe` as malicious, or Authenticode shows a signature that does not belong to the project: stop, do not run, report.
* Available RAM below 6.5 GiB with everything closed: use `-Model 4b` or CPU-only offload settings, or defer the pilot.
* The first health check shows Shared GPU memory growth or generation under about 1 token/s: lower `-Ngl` or move to the 4B model before any paper is processed.

## Added with Step D review (r3)

| ID | Risk | L | I | Mitigation | Residual |
|----|------|---|---|------------|----------|
| R20 | Microsoft Visual C++ x64 runtime missing; the program would not start | M | L | `Step-D-Run.ps1 -Action Prereq` and Install check the four runtime files in System32 and refuse; installing the redistributable is a separate system change that needs separate approval | L |
| R21 | Contents of the two llama.cpp zips unknown to me (I could not download them): file names, extracted size, bundled DLLs, executable count | H (unknown) | L | Two-pass install validates everything before writing; limits (2,000 files, 6 GiB, free disk); hard stops on duplicates, odd names, existing targets; the size and file list are reported after extraction | L |
| R22 | Executing an unsigned third-party binary (`--version`, `--help`, then as a server) | M | H | See R1/R2; additionally: signature status recorded, `HashMismatch` blocks, executable hash re-checked at every Start, only `llama-server.exe` is ever run, loopback listener verified, memory brake | M |
| R23 | Process-id reuse makes `Stop` hit the wrong process | L | M | Stop only acts on a process named `llama-server` whose start time matches the record (within 5 minutes) | L |
| R24 | Firewall prompt appears and the user allows network access | L | M | The script never touches firewall rules; instruction: close or Cancel the dialog, tick nothing; Health lists rules containing "llama" and non-local connections | L |
| R25 | Rollback deletes files that were not part of the install | L | H | Record-driven exact names; `-List` first; typed `DELETE`; no recursion; `StepD` scope cannot reach zips or model; unlisted files are left | L |
| R26 | Junction/symlink race between validation and extraction | L | M | Chain checked per entry; residual TOCTOU window of seconds; no other program is expected to be creating links in `D:\llm` | L |
