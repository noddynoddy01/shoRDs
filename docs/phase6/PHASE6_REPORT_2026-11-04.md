# Phase 6 report – first real open-weight model integration and research evaluation
Date: 2026-11-04. Branch `p0-fixes` (HEAD `38de369`), **everything uncommitted**; the only staged change is the approved deletion of `android/replay_pid29016.log`. Nothing pushed, merged, deployed, purchased or spent. Production default unchanged (Claude).

## Headline
**No real open-weight model has been run.** The sandbox cannot download weights or papers, and I will not substitute fictional papers or restricted material. What is done is everything that does not need the model: the adapter and a local-only, licence-gated pilot kit (tested against a fake server), the claim-guard fix, the legacy-engine quarantine, and a PDF-extractor scoring harness with a synthetic baseline. The definition of success (a real model generating briefs on real papers with measured results) is **not yet met**; the exact remaining steps are in `02_REAL_MODEL_INTEGRATION_AND_PILOT.md`.


## Phase 6A addendum (2026-11-04, after the owner stated the hardware)
- **Hardware is no longer "unknown":** Intel Core i5-12450H (8 cores / 12 threads), 16 GB RAM, RTX 3050 Laptop 4 GB VRAM, driver 592.27, CUDA 13.1 compatible – **OWNER-STATED**, not measured by me. What remains unmeasured is how much of that is *available* at run time; `Probe-Hardware.ps1` (standalone, PowerShell 5.1-style, read-only) measures it. **IMPLEMENTED; not executed on Windows by me.**
- **First-model recommendation changed:** **Qwen3-8B Q4_K_M** (`Qwen/Qwen3-8B-GGUF` @ `7c41481f…`, 5.03 GB, Apache-2.0), non-thinking mode, llama.cpp. gpt-oss-20b (12.11 GB; llama.cpp's own guide lists 14.9 GB total at 8k tokens) stays the planned second model, only if the probe shows ≥ 12.5 GB *available* RAM. The gpt-oss GGUF revision I recorded earlier is stale (repo now at `ef9b12f2…`).
- **Delivered:** `07` hardware report, model comparison and recommendation; `08` setup steps (revised: A/B only); `09` approval checklist (revised: A/B only); `shords-pilot-kit.zip` (self-contained, does not need `D:\shords`, SHA-256 in `08`).
- **Code:** pilot `--no-thinking`, output-folder creation; 2 new tests (full suite re-run below).
- **Nothing downloaded, installed or run on the owner's machine; no weights fetched; no model run; nothing committed.** Items 3–5 and 9 below remain **NOT RUN**.


### Phase 6A review corrections (same day, after the owner agreed with Qwen3-8B Q4_K_M)
- **Probe status: still NOT EXECUTED on PowerShell 5.1** (no PowerShell exists in the cloud sandbox or the device shell). A line-by-line review found and fixed two defects (single-processor machines; `[N/A]` from `nvidia-smi`). The owner can now parse-check the scripts on 5.1 without running them (setup step 3).
- **Memory recomputed** (`scripts/llm_memory_budget.js`, 3 tests): KV cache at 24,576 tokens = 96 MiB per layer, 3,456 MiB in total (the earlier 3.62 GB was right); a GPU layer costs ≈ 206 MiB (weights + its cache), so the earlier `-ngl 12` (≈ 3,177 MiB + Windows) was too tight. **Provisional start is now `-ngl 8`** (≈ 2,351 MiB VRAM, ≈ 7.0 GiB RAM), to be set from llama.cpp's load log; `-np 1` is required; driver sysmem fallback on Windows is a hazard to watch (recalled, unverified). Details: `07`, section 5.
- **Approval request narrowed to A and B only**, with the exact file-system effects listed (folders, a zip download, extraction, a script run, and `hardware-probe.json` written). C–F are withdrawn until the probe has been read. Earlier `08`/`09` text on C–F is superseded.
- No weights, runtimes or papers were touched; nothing started; production default remains Claude; nothing committed.

## Phase 6B addendum (2026-11-04, local inference pilot preparation)
- **Scope:** prepare, do not execute. The owner ran A/B and reported: Windows 11 Home, PowerShell 5.1, i5-12450H, 16 GB RAM (**7.08 GB available at the latest reading**), RTX 3050 Laptop 4 GB, D: 59.3 GB free, Node v24.16.0. Target Qwen3-8B Q4_K_M, fallback Qwen3-4B Q4_K_M.
- **Delivered:** `10_PHASE6B_APPROVAL_PACKAGE.md` (sources, versions, sizes, hashes, disk/memory tables, exact commands, health-check and rollback procedures, **C and D defined separately**), `11_PHASE6B_RISK_REGISTER.md`, and `shords-pilot6b-scripts.zip` (8 files, 21,151 bytes; scripts in `docs/phase6/pilot6b/`). 
- **Runtime chosen:** official llama.cpp **b11669** `win-cuda-12.4-x64` plus `cudart` zip (not 13.4: the owner's driver reports CUDA 13.1). Hashes and model revisions were read twice through different routes via a summarising fetch tool and are **unverified at source until the owner compares them with the pages**. Exact byte sizes of the two zips are unknown; the size of the extracted program is an estimate.
- **Configuration:** context 4,096, one slot, `-ngl 8` (provisional), loopback only, port 8080 explicit. Estimated 1.7 GiB VRAM and 4.8 GiB RAM; RAM, not VRAM, is the binding limit.
- **New finding:** 4,096 tokens is a health-check setting only. The multi-stage pipeline's largest calls need about 8,192 and the one-shot baseline about 24,576, which does not fit in the available RAM. Phase 6C needs a decision (C-only first at 8,192, with a skip/cap option for the baseline).
- **Status:** all PowerShell **NOT EXECUTED** (no PowerShell here); static lint only; the owner-side parser check is the gate. Nothing downloaded, installed, extracted, executed, launched or processed on the owner's machine; no GPU rental, spend, production access, Git change or credential change. Claude remains the production default.

## The ten items
| # | Item | Label | Where |
|---|---|---|---|
| 1 | Verified hardware and runtime report | cloud VM **MEASURED** (2 vCPU, 7.8 GB, no GPU, no route to model/paper hosts); owner's machine **OWNER-STATED** (live availability **NOT RUN**); PowerShell and Node probes **IMPLEMENTED** (Node one TESTED; PowerShell one reviewed/linted only) | 01, 07 |
| 2 | Selected model and exact revision | **PROPOSED (revised in 6A)**: Qwen3-8B Q4_K_M, `Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974`, sha256 `d98cdcbd…`, Apache-2.0 (read through a summarising fetch: compare with the Hugging Face page when downloading). gpt-oss-20b is the later option | 07 |
| 3 | Real-model integration | adapter extensions and pilot driver **IMPLEMENTED, TESTED** (fake server only); real model **NOT RUN** | 02 |
| 4 | Three-paper pilot | **NOT RUN** (no weights, no licence-confirmed papers, hardware unknown) | 02 |
| 5 | One-shot vs multi-stage | kit **IMPLEMENTED, TESTED**; comparison **NOT RUN**; decision rule unchanged and not met by a pilot | 02 |
| 6 | Claim-guard fix and regressions | **IMPLEMENTED, TESTED**; before/after **MEASURED on synthetic texts**: false drops 0→0 of 97 identity + 13 same-direction; swapped order 0/6→6/6; flipped direction 8/13→10/13; version `2026.4-intel`; full suite 631 tests, 630 pass, 1 todo, 0 fail (after 6A review) | 03 |
| 7 | PDF extractor comparison | poppler default / `-layout` / OCR **MEASURED on a 4-document synthetic corpus**; GROBID, Docling and real-world PDFs **NOT RUN**; licences of those two UNVERIFIED | 04 |
| 8 | Legacy Python quarantine | 10 files moved, hashes recorded, tested; 4 files in an imported cluster **not moved** (decision) | 05 |
| 9 | Measured cost and latency | no real-model figures (**NOT RUN**); poppler 13–27 ms and OCR ≈3 s/page **MEASURED** (2 vCPU); paid calls this phase: 0 | 02 |
| 10 | Updated roadmap | **PROPOSED** | 06 |

## What is ready
- Claim-guard fix, ready to merge when you approve (note: it changes production behaviour and invalidates `2026.3-intel` cache entries on deploy).
- Legacy quarantine; pilot kit; PDF scoring code and synthetic corpus; tests registered in `package.json`.

## What is unsafe or unproven
- The native system's quality is unknown. Do not describe it as better than, or equal to, Claude.
- Guard remaining gaps (mixed-direction sentences, noun-only direction words, reversed comparisons with no direction word) – listed in 03.
- Model revisions and licence statements for gpt-oss/Qwen were read via a summarising fetch and are unverified at source; GROBID/Docling licences are from memory.
- Memory on the owner's machine was seen at 92–95% used with browsers open; gpt-oss-20b (12 GB of weights) is marginal on 16 GB RAM even with programs closed, which is why the first model is the 8B.
- The Python FastAPI cluster still contains templated fake output; do not run it.

## Decisions needed
1. Approve A and B in `09`, run the probe, send `hardware-probe.json`. C–F (runtime, 5.03 GB Qwen3-8B download, server) will be requested only after I have read it.
2. Supply three licence-confirmed open-access papers (different domains) with licence records.
3. Supply 10–20 permissioned PDFs for the extractor comparison; approve GROBID/Docling trial locally.
4. Quarantine the whole legacy FastAPI cluster, or leave it.
5. Whether and when to commit the uncommitted Phase 2–6 work and merge the guard fix.
6. Still open from earlier phases: Anthropic Console spend limit; Phase 4 benchmark items.

## Controls kept
Isolation (no Railway, no production DB, no secrets read or changed); no paid calls, rentals or purchases; spend, licence and validation controls untouched and still tested; no training on Claude outputs; no restricted papers; Phase 2–5 work preserved.
