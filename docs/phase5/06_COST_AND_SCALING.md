# 11. Cost and scaling analysis

Date 2026-11-04 · **Status: IMPLEMENTED as a reproducible model (`node scripts/native_cost_model.js`). MEASURED: nothing. Every number is arithmetic on stated assumptions and third-party prices. No subscription, purchase, GPU rental or paid call was made. Cost: $0.00.**

## 6.1 Inputs, and how much to trust each

| Input | Value | Source / trust |
|---|---|---|
| Claude Sonnet 5.5 | $2 in / $10 out per Mtok | pinned in `backend/llm/anthropicClient.js` (the Console is the truth) |
| Hosted Qwen3.8-27B | typical $0.40 / $3.00; cheapest listed $0.15 / $1.88 | cloudprice.net, 17 listings, stamped 2026-11-03 (third-party, volatile) |
| Hosted gpt-oss-120b | typical $0.15 / $0.60; cheapest $0.037 / $0.17 | cloudprice.net, 24 listings (a further 16K characters were not read) |
| GPU rental | H100 80GB $2.89/h (RunPod secure PCIe; Vast.ai from $1.33; Lambda $3.29 to $4.29); L40S $0.99; RTX 4090 $0.74 | hostinger.com table, September 2026 (third-party) |
| Tokens per typical paper, Claude single call | 17,000 in / 3,000 out | **assumption**: ~15K tokens of paper + prompt; output size unmeasured. (Phase 3 assumed ~$0.13; this model gives $0.064. Both are unmeasured: the Phase 4 pilot will settle it) |
| Tokens per typical paper, multi-stage pipeline | 51,000 in / 11,700 out | **assumption derived from the code's call structure**: 12 field calls (≤ 9,000 chars each), one call per section group (≤ 8,000 chars), one brief call, the system prompt repeated on every call. A stub run on a 6K-character paper measured 17K in / 6.7K out with the stub's own token estimate; real tokenisers differ |
| One-shot (system B) | 16,000 in / 2,000 out | assumption |
| Serving throughput of one GPU (27B-class, batched) | low 8K prefill / 800 decode tok/s; mid 20K / 1,800; high 40K / 3,500 | **placeholders for a measurement that has not been run** |
| Cache hit rate | 0 / 30 / 60% | assumption; the cache key already includes model and prompt version |

## 6.2 Results (typical paper)

| System | Cost per paper | 1,000 papers | 10,000 papers | 100,000 papers |
|---|---|---|---|---|
| Claude, current single call | $0.064 | $64 | $640 | $6,400 |
| Hosted gpt-oss-120b, pipeline (typical price) | $0.015 | $15 | $147 | $1,467 |
| Hosted gpt-oss-120b, one-shot | $0.0036 | $4 | $36 | $360 |
| Hosted Qwen3.8-27B, pipeline (DeepInfra-type) | $0.056 | $56 | $555 | $5,550 |
| Hosted Qwen3.8-27B, one-shot | $0.012 | $12 | $120 | $1,200 |
| Self-hosted H100 24/7, mid throughput, sized for 50% busy | fixed $2,110 per GPU-month | $2,110 | $2,110 | $2,110 (one GPU holds ~145K papers/month at 50% busy under the mid placeholder) |
| Hybrid: 90% hosted gpt-oss-120b pipeline + 10% Claude | | $20 | $196 | $1,960 |

A long paper (~30K tokens) costs about 1.5x as much on the Claude path ($0.099) and 1.2x to 1.3x on the pipeline. Full per-paper tables (including self-hosted cost per paper at 100%, 50% and 20% utilisation under all three throughput scenarios) are the output of the script.

**Caching** at 10,000 papers/month: Claude $640 → $448 (30% hits) → $256 (60% hits); hosted gpt-oss-120b pipeline $147 → $103 → $59. A cache hit costs nothing, so the saving is proportional to the hit rate and independent of the model.

## 6.3 What this says (and what it does not)

1. **At today's scale the money is not the reason to change.** Even at 10,000 papers a month the current Claude path costs about $640 a month. The reason to build the engine is control: no single provider, no permanent per-paper bill that scales with success, the ability to tune and evaluate your own model.
2. **A multi-stage pipeline is not automatically cheap.** On hosted Qwen3.8-27B ($3 per Mtok output) it costs about the same per paper as Claude's one call ($0.056 vs $0.064), because it sends about 3x the input and produces about 4x the output. It is cheap only on a cheap-output model: hosted gpt-oss-120b is about 4x cheaper than Claude even with the pipeline.
3. **Self-hosting is not cheaper until volume is high.** One H100 rented around the clock costs $2,110 a month (before any engineer time). It beats paying per paper only above about 33,000 papers a month against Claude, 38,000 against hosted Qwen3.8-27B and 144,000 against hosted gpt-oss-120b; with $1,500 a month of operations overhead (illustrative, supply your own) the break-evens rise to about 56,000, 65,000 and 246,000. Under the low-throughput placeholder one GPU holds only 25,000 to 63,000 papers a month, so the break-even may be unreachable on one GPU. Utilisation matters as much as price: at 20% busy the same GPU costs 5x per paper what it does at 100%.
4. **Recommendation at the current scale (PROPOSED):** do not rent or buy a GPU. Run the evaluation with a local model for development and, with your approval, a few dollars of hosted open-weight calls for the 50-paper arms. Keep Claude as the default until the decision rule in `05_…` is met.
5. **At 10,000 to 100,000 papers a month (PROPOSED):** a hybrid. Hosted open-weight (gpt-oss-120b if it passes the evaluation) for the bulk; Claude for failures, low-confidence results and escalation (the router already supports this order); aggressive caching. Revisit self-hosting only if measured utilisation can stay above about 50% and monthly volume is above the break-even for the measured throughput.
6. **Before any of this is trusted:** replace the three placeholders (tokens per paper, serving throughput, price) with measurements from the pilot and from one local benchmark run. The script takes them as constants at the top.

## 6.4 Other quantities requested

| Quantity | Value | Basis |
|---|---|---|
| GPU memory | Qwen3.8-27B ~16 to 19 GB (4-bit), ~31 GB (8-bit), ~56 GB (BF16); gpt-oss-120b fits one 80 GB GPU; gpt-oss-20b fits 16 GB | vendor-primary for the gpt-oss figures; guide (secondary) for Qwen. KV-cache memory at long context is additional and not estimated |
| Storage | Weights 15 to 65 GB per model. Results: a brief with evidence is about 20 to 60 KB JSON; 100,000 papers is a few GB in Postgres | estimate |
| Concurrency | not measured. A batching server holds many requests at once; the pipeline is sequential per paper by default (`concurrency` option exists, 1 by default) | design |
| Latency | stub: ~40 ms per paper (plumbing only). Real models: **NOT RUN**. Rough shape: 20 to 25 sequential calls make a paper take minutes where a single call takes tens of seconds; field calls can run in parallel (supported, untested on a real server) | design / assumption |
| Maintenance overhead | self-hosting adds patching, GPU drivers, model updates, monitoring, on-call. Not priced here; the illustrative $1,500 a month is a placeholder for you to replace | assumption |

## 6.5 Reproduce

`node scripts/native_cost_model.js` (markdown) or `--json`. Edit the constants at the top to change an assumption.
