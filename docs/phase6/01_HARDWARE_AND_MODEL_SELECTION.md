# Phase 6 / 01 – Hardware and inference readiness, and first-model selection

> **Phase 6A update (2026-11-04):** the owner's hardware is now known (16 GB RAM, RTX 3050 Laptop 4 GB). With it, the first-model recommendation changed from gpt-oss-20b to **Qwen3-8B Q4_K_M** (memory headroom), and the gpt-oss GGUF revision recorded below (`15dcfc7e…`) is out of date (now `ef9b12f2…`). Current facts are in `07`, `08` and `09`; this file is kept for history.

Labels: **MEASURED** = observed in this session. **NOT VERIFIED** = could not be observed. **RECALLED/UNVERIFIED** = from memory or a summarising fetch; re-check before relying on it.

## 1. Hardware

| Machine | CPU | RAM | GPU / VRAM / CUDA | Can it run a local model server? | Status |
|---|---|---|---|---|---|
| Cloud working VM (this session) | 2 vCPU | 7.8 GB total, ~7.4 GB free | none | A small quantised model could in principle load; a 20B-class model (~12–16 GB of weights) cannot. Weights also cannot be downloaded (no route to Hugging Face). | **MEASURED** |
| Owner's Windows machine "nod-e" | Intel Core i5-12450H, 8 cores / 12 threads | 16 GB (Task Manager showed 92–95% in use with browsers open) | RTX 3050 Laptop, 4 GB VRAM, driver 592.27, CUDA 13.1 compatible | Yes in principle; what fits is decided by *available* memory (see 07) | **OWNER-STATED** (live availability **NOT RUN**: `Probe-Hardware.ps1` reads it) |

The two machines are not assumed equal. The owner has since stated the Windows machine's hardware (above). The remaining unknowns are *available* RAM/VRAM and disk space at run time, which a standalone PowerShell probe reads (see `07`–`09`). The earlier Node-based probe still exists:

```
node scripts/native_pilot.js probe --out hardware.json
```
It records CPU model and cores, total and free RAM, `nvidia-smi` name / total and free VRAM / driver / CUDA version, which of `llama-server`, `llama-cli`, `ollama`, `pdftotext`, `python` are on PATH, and free disk. It runs no model, makes no network call and sends nothing anywhere. Send me `hardware.json` and this document gets its real row.

No GPU rental and no purchase was made or proposed.

## 2. Candidates (RECALLED/UNVERIFIED unless noted: read through a summarising fetch of the Hugging Face API; the model card must be re-read before download)

| Model | Repo / revision as read | Licence | Size / shape | Fit |
|---|---|---|---|---|
| **gpt-oss-20b** | `openai/gpt-oss-20b`, sha `6cee5e81…` | Apache-2.0 | ~21B parameters, ~3.6B active (mixture of experts), MXFP4 weights | Active parameters are small, so CPU generation is feasible if RAM allows. |
| gpt-oss-20b GGUF | `ggml-org/gpt-oss-20b-GGUF`, sha `15dcfc7e…` | follows the base model (Apache-2.0) | MXFP4 GGUF, repo ~12.1 GB | The file llama.cpp loads directly. |
| Qwen3.8-27B | sha `1d4bf0f2…` | Apache-2.0 | dense, 18 shards | Needs roughly ≥24 GB VRAM or ≥32 GB RAM once quantised. Not feasible on either known machine. No small Qwen3.8 exists. |
| A ~4B-class small model (e.g. a Gemma-family E4B) | not looked up | not verified | small | Fallback if the owner's RAM is under ~16 GB. Licence conditions must be read first (some families use custom terms, not Apache-2.0). |

## 3. Earlier recommendation (SUPERSEDED by `07_HARDWARE_MODEL_COMPARISON_AND_RECOMMENDATION.md`): gpt-oss-20b, as the ggml-org MXFP4 GGUF, served by llama.cpp

Why this one: permissive licence (commercial use allowed without a custom agreement, as read); active parameters are small, so it is the only candidate that plausibly runs on a consumer CPU or a modest GPU; llama.cpp's server is OpenAI-compatible and the existing adapter already speaks that protocol; llama.cpp returns per-request `timings`, which the adapter now records.

Conditions and caveats (all must be true before the pilot is meaningful):
1. The owner's machine needs about 16 GB of free memory (RAM + VRAM combined) for the weights plus context. With memory already 92–95% used, browsers must be closed. If the probe shows less, the pilot should use the smaller fallback instead, and I will pick one with its licence read first.
2. gpt-oss is a reasoning model that writes hidden reasoning tokens in the harmony format. The adapter reserves `reasoningHeadroomTokens` and reports `truncated` when the budget runs out; reasoning effort can be set (`--reasoning-effort low|medium|high`).
3. CPU-only speed is **not measured** here. Do not plan around any tokens-per-second figure until the pilot reports one.
4. The exact revision (commit sha) and the GGUF file hash must be recorded in the run report (`--revision`, `--quant`, `--runtime`). The pilot refuses to write a report without them being supplied or marked unknown.
5. No weights were downloaded by me (blocked), so there is nothing to clean up, and nothing was run.

Decision needed from the owner: approve downloading ~12 GB of weights and installing llama.cpp on the Windows machine (both free), after the probe.
