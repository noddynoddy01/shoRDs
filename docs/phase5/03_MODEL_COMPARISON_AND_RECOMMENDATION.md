# 3 and 4. Open-weight model comparison and recommendation

Date 2026-11-04 · **Status: IMPLEMENTED (research) · MEASURED: nothing about quality · every ranking below is PROPOSED, a hypothesis to be tested by the evaluation, not a finding.**

No model was downloaded or called. No GPU was rented. Spend: $0.00.

## 3.1 How evidence is labelled

**P** = read on the publisher's own page this session. **S** = secondary (aggregator, community space, guide, news): treat as a lead. **U** = not verified. Prices are third-party price aggregators (cloudprice.net, data stamped 2026-11-03; haimaker.ai), not provider price pages; they move daily.

Two hard limits on what this table can say:
1. **No source I could reach measures long-document scientific summarisation for these models.** Vendor benchmarks (for example GPQA Diamond, SWE-bench Pro) measure other things. Quality on *our* task can only come from our own blinded evaluation (`05_EVALUATION_FRAMEWORK_AND_BENCHMARK_STATUS.md`): **NOT RUN**.
2. **Advertised context length is not usable context** (RULER, `02_LITERATURE_REVIEW.md`). Context numbers below say what the vendor offers, not what holds up.

## 3.2 Candidates

| | Qwen3.8-27B | gpt-oss-120b | gpt-oss-20b | Mistral Small 4 (119B-A6B) | Gemma 4 31B | Llama 4 (Maverick/Scout) |
|---|---|---|---|---|---|---|
| Licence | **Apache-2.0** (P: model-card tag) | **Apache 2.0** (P) | **Apache 2.0** (P) | **Apache-2.0** (P: model-card header of the Eagle variant; the base repo was not opened) | **Apache 2.0** (P: Google Open Source Blog, "OSI-approved") | **Llama 4 Community License**, not OSI: separate licence above 700M monthly users, "Built with Llama" attribution, derivative-model naming rule, Acceptable Use Policy (S: licence text via a mirror, Meta's page not opened) |
| Size / architecture | 28B dense, multimodal (P: Qwen org page) | 117B total / 5.1B active MoE (P) | 21B / 3.6B MoE (P) | 119B total / 6.5B active MoE, 128 experts, 4 active (P) | 31B dense (S); also 26B MoE (4B active), E4B, E2B (S) | U (aggregator only) |
| Context | 262,144 native, 1M with YaRN (S) | not stated on the page (P); 128K per aggregators (S) | not stated (P) | 256k (P) | 256K for 31B and 26B, 128K for E2B/E4B (S) | "10M" is a marketing ceiling per aggregator; quality falls well before (S) |
| Memory to serve | 4-bit about 16 to 19 GB, 8-bit about 31 GB, BF16 about 56 GB (S: guide, not measured by us) | **fits one 80 GB GPU** (P, MXFP4 weights) | **fits 16 GB** (P) | page's example uses tensor-parallel 2; no memory figure (P) | about 62 GB for 31B (S: community estimate) | U |
| Quantisation | community GGUF 8.5 to 28.9 GB (S); FP8 repo by Qwen (P: org page lists `-FP8`) | MXFP4 native (P) | MXFP4 native (P) | not stated (P) | U | U |
| Fine-tuning | standard HF/PEFT stack (S); vLLM/SGLang serving (P) | "fine-tunable on a single H100 node" (P) | fine-tunable (P: model card) | not stated | U | allowed within the licence (S) |
| Output format | JSON via prompt; vLLM structured output not verified by us | must use **harmony** response format; chain-of-thought is not for end users (P) | same as 120b | U | U | U |
| Languages | multilingual (S) | U | U | 24 languages listed (P) | U | U |
| Hosted price, USD per 1M tokens in / out | $0.15 to $0.99 / $1.28 to $4.00 across 17 listings; DeepInfra-type $0.40 / $3.00 (S) | $0.025 to $0.80 / $0.092 to $0.80 across 24 listings; typical $0.15 / $0.60; DeepInfra $0.037 / $0.17 (S) | not looked up | not looked up | not looked up | not looked up |
| Vendor-quoted quality | GPQA Diamond 89.2, IFBench 79.5 (S: vendor figures in guides; not our task) | not looked up | not looked up | not looked up | LMArena about 1452 (community space, S) | U |

Other families seen only in an aggregator ranking and **not** verified or shortlisted: DeepSeek V4 (MIT per aggregator), GLM-5.3 (custom licence), Kimi K2.7/K3, MiniMax M3, MiMo-V2.6-Pro (MIT per aggregator), Hunyuan Hy4, Step 5. Reasons for exclusion: most are hundreds of billions to trillions of parameters (not practical to self-host for this product), and none was verified from a primary source.

## 3.3 Ranked shortlist (PROPOSED)

Ranking weighs: Apache-class licence verified at the source, self-hostable on one rented GPU, cost per paper, context, ease of serving. It does **not** and cannot weigh summarisation quality, which is unmeasured.

| Rank | Model | Why | Main risk |
|---|---|---|---|
| 1 | **Qwen3.8-27B** | Apache-2.0; dense 28B, simplest to serve; runs at 4-bit in about 16 to 19 GB (so a rented 24 GB card or the owner's own GPU, if there is one); 262K native context; broad hosted availability (17 listings) | Hosted output price ($3.00 typical) makes the multi-stage pipeline about as expensive per paper as Claude's single call. Quality on scientific summarisation is unknown |
| 2 | **gpt-oss-120b** | Apache 2.0; one 80 GB GPU; only 5.1B active parameters so decode is fast; cheapest hosted tokens by roughly 3x to 10x ($0.15 / $0.60 typical); fine-tunable | harmony format and reasoning-trace handling need adapter work; context length unconfirmed; unknown scientific-text quality |
| 3 | **gpt-oss-20b** | Apache 2.0; fits 16 GB; the cheapest thing that could serve a section-classification or claim-extraction role | Likely weaker on long, numeric scientific text (not measured) |
| 4 | Mistral Small 4 (119B-A6B) | Apache-2.0, 256k, 24 languages | The vendor's own example uses two GPUs; no memory figure; not priced here |
| 5 | Gemma 4 31B | Apache 2.0 (P), 256K | Specs are community-sourced; about 62 GB so a single 80 GB card is tight at long context |
| 6 | Llama 4 | Large, widely hosted | Community licence (attribution, naming, usage policy, user-count clause) is a permanent legal constraint on a product whose goal is ownership. Not recommended unless the others fail |

## 3.4 Recommendations

1. **Best model for the first prototype: Qwen3.8-27B.** It is the only candidate that can be developed against at zero marginal cost on modest hardware (4-bit local), is a single dense model (fewest serving surprises) and has a verified Apache-2.0 licence. The first *evaluation* should nevertheless run **two arms on the same 50 papers, Qwen3.8-27B and gpt-oss-120b**, because the cost difference between them is large and the quality difference is unknown. At published prices that is about $2.78 and $0.73 for the pipeline on 50 typical papers (`06_COST_AND_SCALING.md`), but it is a paid call and needs your approval.
2. **Best model for future production scale: gpt-oss-120b (PROPOSED, conditional on the evaluation).** Lowest cost per paper by a wide margin, one 80 GB GPU if self-hosted, Apache 2.0. Choose it only if its human-rated accuracy is non-inferior under the pre-declared rule.
3. **Best smaller low-cost model: gpt-oss-20b** for narrow jobs (section classification, claim-type tagging, query routing), where a 16 GB footprint matters. Runner-up: Gemma 4 E4B (Apache 2.0, specs community-sourced).
4. **Keep the provider seam.** The decision above is reversible by design: the adapter takes any OpenAI-compatible endpoint, so replacing the model changes a configuration entry and a price, not code.

## 3.5 What would change this ranking

A model that scores clearly higher on factual and quantitative accuracy in the blinded evaluation; a primary-source licence term that differs from what is recorded here; a hosted price change of 3x or more; confirmation that a model cannot hold quality at the 8,000 to 9,000 character calls the pipeline uses.
