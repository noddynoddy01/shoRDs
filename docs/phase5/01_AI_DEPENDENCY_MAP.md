# 1. Existing AI dependency map

Date 2026-11-04 · branch `p0-fixes`, uncommitted · **Status: IMPLEMENTED (analysis) · every row below was read in the code; nothing here was run against production.**

Question answered: *which parts of shoRDs depend on Claude, and which already work without it?*

## 1.1 Short answer

Claude is used for exactly two server features (the structured paper analysis and the paper Q&A "copilot"). It is reached through one HTTP client (`backend/llm/anthropicClient.js`) behind one spend gate (`backend/llm/aiBudget.js`). Everything that **feeds** the model (paper retrieval, licence policy, extraction, chunking, evidence selection) and everything that **judges** its output (claim guard, response gate, evidence index, result validation) is already model-independent. The coupling to Claude is therefore shallow in *count* but real in *naming*: five server files carry Claude-specific names, mode literals or environment variables, and two of them (the result cache and the usage ledger) would silently treat a non-Claude answer as "not a real AI answer".

## 1.2 Component map

| Component | File(s) | Depends on Claude? | Detail |
|---|---|---|---|
| HTTP client to the model | `backend/llm/anthropicClient.js` | **Yes (this is the adapter)** | `callMessages`, price table `PRICING_PER_MTOK = {claude-sonnet-5-5: $2/$10 per Mtok}`, profiles QUICK/STANDARD/DEEP, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, price-override variables `ANTHROPIC_PRICE_*` |
| Spend gate | `backend/llm/aiBudget.js` | **Partly** | Logic is provider-neutral (kill switch, per-request ceiling, daily budgets, concurrency, breaker, duplicate lock, reserve/settle). Coupled by: it imports `resolvePrice/parsePriceOverride` from the Claude client, prices **only** models in that table or a single global override, and its breaker key is `shords:ai:breaker:v1:anthropic`. A non-Claude model is refused as `UNPRICED_MODEL` unless a person sets the override (proved by `nativeAdapter.test.js`) |
| Orchestration | `backend/llm/aiPipeline.js` | **Yes (names)** | Wraps the real client with `budget.guardClient(...)`; applies the serve-time response gate and the usage ledger in `finish()` |
| Structured analysis | `backend/llm/intelligence.js` | **Yes (names), logic independent** | Calls the model once (`callMessages` at ~line 310). Result metadata hard-codes `provider: "anthropic"`, `modelMode: "EXTERNAL_CLAUDE"`, reads `ANTHROPIC_API_KEY`; fallback reason `ANTHROPIC_API_KEY_NOT_CONFIGURED`. The prompt, `parseModelJson` and `validateIntelligence` are model-independent |
| Paper Q&A | `backend/llm/copilotService.js` | **Yes (names)** | Same pattern as above |
| Result cache | `backend/llm/resultCache.js` | **Yes** | `isRealCompleteAnswer` requires `modelMode === "EXTERNAL_CLAUDE"`: an answer from any other model would **not be cached** until this is generalised |
| Usage ledger | `backend/llm/usageLedger.js` | **Yes** | Derives `aiCalled` from `modelMode === "EXTERNAL_CLAUDE"` when not given |
| Readiness / health | `backend/readiness.js`, `backend/app.js` | **Yes** | `probeModel` from the Claude client; `health.anthropic.model` |
| Claim guard | `backend/llm/claimGuard.js` | **No** | Lexical/numeric checks on a statement and its cited chunks (numbers, direction, negation, strength, scope) |
| Response gate (Phase 4) | `backend/llm/responseGate.js` | **No** | Serve-time check of the whole response |
| Evidence selection | `backend/llm/evidence.js` | **No** | `selectForIntelligence/selectForQuestion` with category quotas, context budget 120,000 chars |
| Prompt-tag safety | `backend/llm/promptSafety.js` | **No** | `neutralizeTags`, `safeTitleAttribute` |
| Retrieval, licence, extraction | `backend/papers/{providers,paperService,licensePolicy,extract,markup,identity}.js` | **No** | JATS and article-HTML extraction. **PDF binaries are not parsed** (zero-dependency runtime): a PDF-only paper resolves to `ABSTRACT_ONLY` |
| Chunking | `backend/papers/chunker.js` | **No** | Section-aware chunks with ids `<paper>_chunk_<n>` and a content hash |
| Cache identity | `backend/llm/aiPipeline.js` (`buildCacheKey`), `intelligence.js` (`INTEL_PROMPT_VERSION = 2026.3-intel`) | **Names only** | Key already contains model and prompt version, so a different model gets a different key |
| Evaluation tooling | `backend/eval/*`, `scripts/{summary_benchmark,f1_review,benchmark_run_local}.js` | **Runner: yes. Scoring: no** | `benchmarkRun.js` drives the production pipeline (Claude). `summaryBenchmark`, `benchmarkScoring`, `guardReview`, `faithfulness`, F1 review kit are model-independent |
| Device brief | `services/paperSummarizer.ts` | **No** | Rule-based, offline, on the phone |
| Frontend analysis experience | `components/research/AnalysisPanel.tsx`, `services/analysisClient.ts`, `services/evidenceModel.ts` | **No** | Renders status, statements and evidence; shows no provider name. It would render a native-engine answer unchanged if the API returned the same shape |
| Legacy frontend gateway | `services/llm/*` (aiGateway, providers incl. anthropic/openai/gemini, costManager, modelRouter) | **Yes, but dead** | Not imported by the app (owner decision D-C-4 about removing unused code is still open) |
| Legacy Python stack | `backend/{shords_server,multi_pass_engine,section_intelligence,research_engine,pdf_parser,finetune_model}.py`, `deploy_vllm.sh` | **No model, and no capability** | Not on the Railway path (`railway.json` runs `node backend/start_local_server.js`). `section_intelligence.py` and `multi_pass_engine.py` return **hard-coded sample values** (for example "95.3% vs 92.1%") for any input: they are not extraction code and must never be counted as, or reused as, a capability. `finetune_model.py` is a QLoRA scaffold for `Qwen2-VL-7B` that trains on a single made-up sample |
| Design contract | `docs/architecture/AI_GATEWAY_DESIGN.md` (ADR-005) | n/a | A provider-neutral gateway is **designed but not built**; `aiGatewayBoundary.test.js` lists today's violations as a `todo` |

## 1.3 What "independent" requires in production (not done in this phase, PROPOSED)

1. A provider-neutral result vocabulary replacing `EXTERNAL_CLAUDE` / `provider:"anthropic"` in `intelligence.js`, `copilotService.js`, `resultCache.js`, `usageLedger.js`.
2. A **per-model price table** in the spend gate. Today one global override replaces the price of every model (including Claude's), so two paid models cannot run side by side.
3. A breaker key per provider.
4. A readiness probe that asks the configured provider, not only Claude.
5. Wiring `native/*` behind the existing `guardClient`, with Stage A fed by a PDF extractor service.

All five are in the migration proposal (`09_PRODUCTION_MIGRATION_PROPOSAL.md`). **None is implemented**: the production analysis path is untouched.
