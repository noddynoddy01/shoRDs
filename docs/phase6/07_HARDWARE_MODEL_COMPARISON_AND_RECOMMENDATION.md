# Phase 6A / 07 – Corrected hardware report, model comparison and the one recommended first model

Labels: **OWNER-STATED** = told to me, not measured by me. **VERIFIED (source)** = read from the named primary source in this session through a summarising fetch tool, so exact digits were transcribed by a model: compare file sizes and hashes with the Hugging Face "Files" page when you download. **COMPUTED** = arithmetic from verified configuration values. **ESTIMATE** = reasoning from hardware limits, not measured. **NOT RUN** = nothing was executed.

## 1. Hardware (replaces the earlier "owner's machine NOT VERIFIED" statements)

| Item | Value | Label |
|---|---|---|
| CPU | Intel Core i5-12450H (12th gen), 8 cores / 12 threads | OWNER-STATED |
| RAM | 16 GB | OWNER-STATED |
| GPU | NVIDIA GeForce RTX 3050 Laptop, 4 GB dedicated VRAM | OWNER-STATED |
| Driver / CUDA | 592.27 / CUDA compatibility 13.1 | OWNER-STATED |
| OS | Windows 11 (seen earlier in this session) | observed |
| Memory pressure | Task Manager showed 92–95 % memory in use with browsers open (observed earlier in this session) | observed |
| Free disk on the model drive, SSD or HDD, battery/AC, current free RAM and VRAM | unknown until the probe is run | **NOT RUN** |

What is still unknown matters more than what is known: how much of the 16 GB is actually free once the programs you normally have open are closed, and how much of the 4 GB VRAM Windows and the browser already hold. `Probe-Hardware.ps1` reads exactly those numbers (section 4 of this folder; it is read-only and sends nothing anywhere).

### Why 16 GB RAM + 4 GB VRAM does not mean 20 GB for a model
1. VRAM holds only the layers and cache you explicitly offload; it cannot hold the rest of the model "as spillover", and the desktop and browser already use some of it.
2. Windows and background programs take a large share of 16 GB. A fresh Windows 11 session with a few services and one app commonly sits at 5–7 GB used (ESTIMATE); you saw 92–95 % with browsers open.
3. Parts of the model that stay on the CPU must be resident in RAM to run at useful speed. If they are not, Windows reads them from disk on every token (ESTIMATE: on a fast SSD that is a large fraction of a second or more per token for a model this size; on a hard disk, unusable).
4. The runtime adds its own buffers on top of weights and the key-value cache (llama.cpp's own gpt-oss guide lists 2.7 GB of compute buffers for its example).
**Working budget used here (ESTIMATE, to be replaced by the probe):** about 7.5–9.5 GB of RAM and 3.3–3.7 GB of VRAM available to the model with browsers closed and 1.5 GB kept free for Windows.

## 2. Candidates

| | **gpt-oss-20b, MXFP4 GGUF** (CPU/GPU split) | **Qwen3-8B, Q4_K_M GGUF** | Qwen3-4B, Q4_K_M GGUF (lighter fallback) |
|---|---|---|---|
| Repo, revision (VERIFIED, source: Hugging Face API) | `ggml-org/gpt-oss-20b-GGUF`, `ef9b12f2ff56c69cf32153a02784e7a3c88bf524` (modified 2026-07-28). *The revision I recorded earlier, `15dcfc7e…`, is out of date: this repo changed, so always pin the revision.* | `Qwen/Qwen3-8B-GGUF`, `7c41481f57cb95916b40956ab2f0b139b296d974` | `Qwen/Qwen3-4B-GGUF`, `bc640142c66e1fdd12af0bd68f40445458f3869b` |
| File | `gpt-oss-20b-MXFP4.gguf`, 12,109,566,624 bytes (12.11 GB), sha256 `27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901` | `Qwen3-8B-Q4_K_M.gguf`, 5,027,783,488 bytes (5.03 GB), sha256 `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` | `Qwen3-4B-Q4_K_M.gguf`, 2,497,280,256 bytes (2.50 GB), sha256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| Architecture (VERIFIED, source: config.json) | 24 layers; 64 attention heads, 8 key-value heads, head size 64; 32 experts, 4 used per token; every second layer is sliding-window (128); trained context 131,072 (YaRN) | 36 layers; 32 heads, 8 key-value heads, head size 128; dense; native context 32,768 (config 40,960) | 36 layers; 32 heads, 8 key-value heads, head size 128; tied embeddings; context 40,960 in config |
| Context memory (COMPUTED, 16-bit cache) | 24 KiB per token for the 12 full-attention layers: **0.2 GB at 8k tokens, 0.5 GB at 24k** (matches the 0.2 GB per 8k in the llama.cpp guide). The sliding layers add little if the runtime uses its window-sized cache (not verified). | 144 KiB per token: **1.21 GB at 8k, 3.62 GB at 24k** | 144 KiB per token: **1.21 GB at 8k, 3.62 GB at 24k** |
| Total footprint (see section 5 for the corrected Qwen figures) | llama.cpp's guide (VERIFIED, source: llama.cpp discussion 15396): 12.0 GB weights + 2.7 GB buffers + 0.2 GB cache = **14.9 GB at 8k tokens**, quoted for an all-on-GPU setup. With experts on the CPU, roughly 10–11 GB of that must sit in RAM (ESTIMATE). | Weights 4,795 MiB + cache 3,456 MiB at 24,576 tokens + ~1,300 MiB of runtime buffers/overheads ≈ **9,550 MiB (9.3 GiB)** in total, split between RAM and VRAM. At the provisional `-ngl 8`: ≈ 7,200 MiB (7.0 GiB) in RAM and ≈ 2,350 MiB in VRAM (ESTIMATES from `scripts/llm_memory_budget.js`; the llama-server load log replaces them). | ≈ 7,100 MiB (7.0 GiB) in total at 24k: the cache is the same size as the 8B's, so it saves only the 2.4 GiB of weights (ESTIMATE). |
| Fit on 16 GB RAM + 4 GB VRAM | **Marginal to poor.** Needs about 12.5 GB of *available* RAM with everything else closed. | **Fits** with ordinary headroom. | Fits with more headroom than the 8B (about 2.4 GiB less). |
| Runtime | llama.cpp (`llama-server`); needs `--jinja` (harmony chat format); `--n-cpu-moe N` keeps MoE layers on the CPU (VERIFIED in the guide). | llama.cpp; standard chat template; ordinary dense model. | same |
| Licence (VERIFIED, source: HF tag + model card) | Apache-2.0. The card I read does not mention a separate usage policy; check the repo's file list for one before commercial use. | Apache-2.0 (tag, `LICENSE` file, README) | Apache-2.0 (tag) |
| Commercial use | Permitted under Apache-2.0 with its notice/attribution terms; model outputs are not restricted by the licence text itself. | same | same |
| Reasoning behaviour | Always reasons before answering (low/medium/high effort via `reasoning_effort`); the reasoning tokens are generated and billed in time even though the pipeline never keeps them. The model card recommends temperature 1.0 and says to use the harmony format only. | Hybrid: `enable_thinking=false` gives direct answers (the pilot's `--no-thinking` sends this). Card recommends temperature 0.7 for non-thinking mode. | same family |
| Expected limitations | Slowest per answer on this machine because of reasoning tokens and CPU-resident experts; highest memory risk; harmony/reasoning field handling by the local server not yet exercised by us (if the server leaves harmony tags in `content`, JSON parsing fails — would show up as extraction failures). | Smaller and more heavily quantised than gpt-oss: expect more missed claims, weaker handling of long tables, more malformed JSON (the claim guard and validator drop what they cannot verify; failures are counted, not hidden). 32k context limit. | Weaker again; useful only to test the plumbing or if RAM is very tight. An official GGUF exists for Qwen3-4B but not for the newer 4B-Instruct-2507 (community conversions only, which I would not pin). |
| Speed on this machine | **NOT RUN.** ESTIMATE: bounded by memory bandwidth for the CPU-resident part; plan for single-digit to low-double-digit tokens per second plus minutes of prompt processing for a long paper. | **NOT RUN.** Same order of magnitude; fewer wasted tokens in non-thinking mode. | **NOT RUN.** Fastest. |

Not evaluated in this phase: other 3B–8B families (Llama, Gemma, Phi, Mistral). I did not look up their licences or files, so I make no claim about them.

Note on the pilot's settings: the adapter sends temperature 0 for reproducibility. That deviates from the vendors' recommended sampling for both models and may change quality; it is a documented limitation of this first run, not a tuned setting.

## 3. Recommendation: ONE first model – **Qwen3-8B Q4_K_M** (`Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974`), run in non-thinking mode through llama.cpp

Chosen on the verified hardware, not popularity:
- **Memory.** about 7 GiB of RAM at the provisional offload (6.2–8.6 GiB across `-ngl` 12 to 0) leaves Windows room if the browsers are closed; gpt-oss-20b needs ~11–12.5 GB of RAM-side memory on a machine that already showed 92–95 % use. Swapping to disk would make it slow and could make the laptop unresponsive.
- **Feasibility of the pilot as designed.** The one-shot baseline puts up to 60,000 characters (about 15–18k tokens) into a single prompt, so the server needs a ~24k-token context. At that length Qwen3-8B's cache costs 3.6 GB; gpt-oss's costs 0.5 GB (a real advantage of gpt-oss, but it does not offset the 12 GB of weights).
- **Predictability.** A plain chat template and no hidden reasoning stream: fewer unknowns in a first end-to-end run, and every failure is easier to attribute.
- **Licence and provenance.** Apache-2.0, an official Qwen repository, a pinned revision and a published file hash.

Trade-offs accepted: lower ceiling on quality than gpt-oss-20b, and 4-bit quantisation loss. **A weak result from this model is evidence about this model on this pipeline, not about open-weight models in general, and not about gpt-oss-20b.** If the pilot shows the pipeline works but quality is limited by the model, the next step is gpt-oss-20b — and only if the probe reports ≥ 12.5 GB *available* RAM with everything else closed (or after a RAM upgrade, which is your decision and costs money, so it is not assumed anywhere).

Why not the others first: gpt-oss-20b fails the memory test above; Qwen3-4B is the retreat position if the probe shows less than ~9.5 GB available even after closing programs.

## 4. What this phase did and did not do
Implemented and tested: `Probe-Hardware.ps1` (PowerShell 5.1-style; **not executed on Windows or on PowerShell 5.1 by me** – only reviewed and linted for PowerShell 7-only syntax and bracket balance), `Verify-Kit.ps1`, a self-contained pilot kit whose extracted copy ran end to end against a fake local server (protocol only), and a `--no-thinking` switch in the pilot driver with a test. **Nothing was downloaded or installed on your machine, no model weights were fetched, no model was run, nothing was committed.**

## 5. Memory recheck (Phase 6A review; supersedes the figures above where they differ)
Reproduce with `node scripts/llm_memory_budget.js` (3 hand-checked tests in `llmMemoryBudget.test.js`). Inputs verified from `config.json`: 36 layers, 8 key-value heads, head size 128, hidden 4096, vocab 151,936. Everything marked ESTIMATE is an assumption that the llama-server load log must replace.

**Key-value cache (COMPUTED, 16-bit cache = llama.cpp's default).** Per token per layer: 2 (K and V) × 8 × 128 × 2 bytes = 4,096 bytes. Per token for all 36 layers: **147,456 bytes**. At **24,576 tokens: 96 MiB per layer, 3,456 MiB (3.375 GiB, 3.62 GB) in total**. At 8,192 tokens: 1,152 MiB. The earlier figure of 3.62 GB was right; what was wrong was how I used it (below).

**How llama.cpp splits it (from memory of its default behaviour; the load log is the authority).** With `-ngl N`, N transformer layers are placed on the GPU, and each of those layers' key-value cache goes with it. So a layer moved to the GPU costs its weights **plus its share of the cache**: about 110 MiB of weights (derived: file size minus embedding and output matrices, divided by 36) + 96 MiB of cache = **about 206 MiB of VRAM per layer**. The embedding table and the output matrix stay in RAM unless `-ngl` exceeds the layer count. The GPU also needs a fixed amount for the CUDA context and compute buffer (ESTIMATE ~700 MiB), and the host needs ~600 MiB for the server process and CPU buffers (ESTIMATE).

| `-ngl` | VRAM used by the model (ESTIMATE) | Headroom on a 4,096 MiB card if Windows already uses ~600 MiB | RAM used (ESTIMATE) |
|---|---|---|---|
| 0 | 0 | – | 8,851 MiB (8.6 GiB) |
| 4 | 1,526 MiB | 1,970 MiB | 8,025 MiB (7.8 GiB) |
| **8** | **2,351 MiB** | **1,145 MiB** | **7,200 MiB (7.0 GiB)** |
| 12 | 3,177 MiB | **319 MiB** | 6,374 MiB (6.2 GiB) |
| 16 | 4,002 MiB | negative: does not fit | 5,548 MiB (5.4 GiB) |

**Corrections to what I told you before.** (1) I had put `-ngl 12` forward and described it as using "about 3.0–3.5 GB of VRAM". The table gives 3,177 MiB plus whatever Windows and the browser already hold, which leaves almost nothing; if the desktop uses 1 GiB the model no longer fits. (2) My earlier RAM range "5.5–8 GB" understated the low-offload end: at `-ngl 0` it is 8.6 GiB. (3) The probe's rule of thumb (needs 8.0 GB + 1.5 GB headroom = 9.5 GB available) is conservative for `-ngl 8` (7.0 GiB + 1.5 = 8.5 GiB) and about right for `-ngl 0` (8.6 + 1.5 = 10.1 GiB).

**Why the starting offload is provisional.** The numbers above are arithmetic on a model of llama.cpp's allocation. The real values are printed by `llama-server` when it loads (per-device model buffer, KV buffer and compute buffer sizes, and the number of layers offloaded). The final `-ngl` will be chosen from that log and from `nvidia-smi` after loading, not from this table. A further hazard on Windows: when dedicated VRAM runs out, NVIDIA drivers can silently spill CUDA allocations into shared system memory instead of failing (a "sysmem fallback" behaviour introduced in drivers from about 2023; recalled, not checked against driver 592.27). That makes an over-ambitious `-ngl` show up as slow generation rather than an error, so Task Manager's *Shared GPU memory* must be watched during the first run.

**Context length.** The one-shot baseline sends up to 60,000 characters plus about 1,700 characters of instructions and allows 3,000 output tokens. At 3.0 characters per token that is about 20,600 + 3,000 ≈ 23,600 tokens, inside 24,576; for unusually dense text (about 2.8 characters per token) it would not fit and the one-shot call would fail with a context error, which the pilot records as a finding. Typical English prose is nearer 4 characters per token (about 15,000). The server must also be started with a single slot (`-np 1`): recent llama.cpp builds can default to several parallel slots, and depending on the build that either splits the context between them or reserves memory for them (not verified for the build you will use).
