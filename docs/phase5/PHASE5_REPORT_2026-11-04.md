# Phase 5 report: the shoRDs-native research intelligence engine

Date 2026-11-04 · Branch `p0-fixes` (uncommitted) · Spend this phase: **$0.00** · Paid calls: **none** · GPU rented: **none** · Production touched: **no**

## 0. The honest summary

I built the **engine around the model**: document parsing, quote-anchored extraction, hierarchical summarisation, a nine-section brief where missing information is written as "unavailable", and validation with your existing claim guard. It runs end to end and is tested, but only with a **deterministic stub that copies sentences, not with a language model**. So:

- **What is real:** the pipeline, the provider abstraction (local / hosted open-weight / Claude fallback behind spend controls), the evaluation framework, the cost model, the documents.
- **What is not known:** how good any open-weight model is on your papers, how fast, or how much it really costs per paper. **No quality, accuracy, latency or cost-per-paper figure was measured.** No claim that the native engine matches or beats Claude is made, and none should be inferred.
- **What I recommend:** keep Claude as default. At today's scale it costs tens of dollars a month; independence is about control, not savings. Run the evaluation (about $3.51 of hosted open-weight calls plus the Claude baseline you already budgeted) before deciding anything.

Labels used below: **IMPLEMENTED** (code exists), **TESTED** (automated test passes), **MEASURED** (real measurement of a real model/system), **PROPOSED** (design only), **NOT RUN** (needs something I did not have or you did not approve).

## 1. The 14 deliverables

| # | Deliverable | Labels | Where |
|---|---|---|---|
| 1 | AI dependency map | IMPLEMENTED (document). Code-grounded; not a runtime trace | `01_AI_DEPENDENCY_MAP.md` |
| 2 | Research and literature review | IMPLEMENTED (document). 5 sources abstract-verified (BooookScore, MiniCheck, RULER, SciRIFF, Lost in the Middle), the rest marked unverified background; says what is learnable vs unknowable about Claude | `02_LITERATURE_REVIEW.md` |
| 3 | Open-weight model comparison | IMPLEMENTED (document); licences from primary pages where reachable, secondary otherwise, each marked. **No quality measured** | `03_MODEL_COMPARISON_AND_RECOMMENDATION.md` |
| 4 | Recommended model + justification | PROPOSED. First prototype Qwen3.8-27B; future production gpt-oss-120b *conditional on evaluation*; small model gpt-oss-20b. The ranking is by licence, size, context and fit, not by measured quality | same file |
| 5 | Architecture diagram | IMPLEMENTED (document) | `04_ARCHITECTURE.md` |
| 6 | Working independent summarisation prototype | IMPLEMENTED, TESTED with the stub (19 pipeline + 8 adapter tests). **NOT RUN** with any real language model | `backend/native/*`, `scripts/native_run_local.js` |
| 7 | Document extraction + hierarchical summarisation pipeline | IMPLEMENTED, TESTED on a fictional JATS paper and a fictional PDF through `pdftotext`. **NOT RUN** on real papers or real-world PDFs. Layout-aware extraction (columns, scanned pages, true tables, equations) is not solved; the quality report flags it | `documentIntelligence.js`, `structuredExtraction.js`, `hierarchical.js`, `brief.js` |
| 8 | Evidence mapping and validation integration | IMPLEMENTED, TESTED. Existing claim guard reused **unchanged** plus production `validateIntelligence` as a second gate; two guard gaps found (F-5-1, F-5-2), left unfixed and documented as todo tests | `validation.js` |
| 9 | Model evaluation framework | IMPLEMENTED, TESTED (8 tests, synthetic ratings only). Pre-declared decision rule | `backend/eval/nativeCompare.js`, `scripts/native_compare.js`, `05_…` |
| 10 | Benchmark comparison vs Claude pipeline | **NOT RUN.** Needs licence-confirmed papers, the Claude baseline, an open-weight arm, two raters. Run order in `05_…` | `05_EVALUATION_FRAMEWORK_AND_BENCHMARK_STATUS.md` |
| 11 | Cost and scaling analysis | IMPLEMENTED as a reproducible model. Arithmetic on assumptions and third-party prices; **MEASURED: nothing** | `06_COST_AND_SCALING.md`, `scripts/native_cost_model.js` |
| 12 | Fine-tuning feasibility | PROPOSED. Five gates before any training; no Claude outputs used; dataset licences analysed (SciRIFF `odc-by` with three CC BY-NC subsets) | `07_FINETUNING_FEASIBILITY.md` |
| 13 | Security and licensing review | IMPLEMENTED controls, TESTED by unit tests; not pen-tested; licence readings are not legal advice | `08_SECURITY_AND_LICENSING_REVIEW.md` |
| 14 | Production migration proposal | PROPOSED (5A to 5E; default not switched) | `09_PRODUCTION_MIGRATION_PROPOSAL.md` |

## 2. What the architecture does (one screen)

`paper → A document intelligence (sections, chunks with page provenance, quality flags) → B structured extraction (12 fields; a claim is kept only if it quotes a given chunk verbatim) → C hierarchical summaries and claims (merge, dedupe, method↔result links, contradictions) → D nine-section brief (missing = "Unavailable" with a reason) → E existing claim guard on every statement + production validator`. Output statements are labelled `SUPPORTED_BY_AUTOMATIC_CHECK`; withheld ones are listed with reason codes; no raw model text is ever returned.

## 3. Tests and verification

- Full unit suite after the last edit: **565 tests, 562 pass, 0 fail, 3 todo** (2 are the new known-gap tests F-5-1/F-5-2; 1 pre-existing). 35 of the tests are new (adapter 8, pipeline 19, comparison 8).
- Integration tests (need Postgres/Redis), Node 20, `build:web`, Lighthouse, `npm audit`, GitHub CI, real devices: **NOT RUN this phase.** No production source file was modified, so the Phase 4 integration result is unchanged by design, but I have not re-proved that.
- One existing test was edited: the structure guard in `aiBudget.test.js` now also allows `native/modelAdapter.js`, with a comment. This is a visible, reviewable one-line change; the production gate itself is unchanged.
- Also touched: `package.json` (test list), and a comment path in `nativePipeline.test.js`.

## 4. Findings you should know about

1. **Claim-guard gaps (existing code):** "rises" vs "falls" is not caught as a reversal; swapped "from X to Y" numbers pass the number check. They affect production today and the native engine inherits them. Fix proposed (needs prompt-version bump), not made.
2. **Legacy Python files fabricate output:** `backend/multi_agent_engine.py` returns fixed invented analysis for any text; `backend/finetune_model.py` trains on one invented record if its dataset is missing. Neither is referenced by JS/Docker/CI files I searched. A risk if anyone deploys them.
3. **Claude coupling is wide but shallow:** a result-vocabulary string (`EXTERNAL_CLAUDE`) and a single price table are the main hooks; the design contract in `AI_GATEWAY_DESIGN.md` was never implemented. See the migration steps.
4. **Pipeline cost can exceed Claude's** on a model with expensive output tokens, because it sends about 3x the input and writes about 4x the output. Only a cheap-output model makes it cheaper.
5. **Fine-tuning on Claude outputs is excluded** by your rules and by the terms question; the cheapest useful training target is a small evidence checker, not a bigger writer.

## 5. What is ready, what is unsafe

**Ready to use now (local, free):** run the prototype against a model server on your own machine with `node scripts/native_run_local.js` (local URLs only), run the cost model, build blinded rating sheets with `native_compare.js`. Nothing is wired into the app.

**Unsafe or not to be trusted yet:** presenting any native-engine brief to real users; claiming the native engine is as accurate as Claude; deploying the legacy Python engines; trusting the hosted-price table (third-party, volatile); relying on the PDF path for real-world PDFs; using the stub's output as an indication of model quality; the automatic lexical checks as proof of correctness.

## 6. Decisions I need from you

D-5-1 hardware (a GPU, or none); D-5-2 approve about $3.51 for two hosted open-weight arms on 50 typical papers (plus the Phase 4 Claude baseline, inside the $25 ceiling you set); D-5-3 PDF extractor choice; D-5-4 approve a reviewed guard fix with prompt-version bump; D-5-5 legacy Python engines (quarantine, delete or leave); D-5-6 licence confirmation of the benchmark papers and who the two raters are; D-B-3 how to commit the large uncommitted working copy (nothing committed). Also still open from earlier: the Anthropic Console spend limit.

## 7. Compliance with your strict rules

Worked on the existing `p0-fixes` working copy; Phase 2, 3 and 4 work preserved; **nothing committed, pushed, merged or deployed**; no production database or Railway access; no production secret or Anthropic configuration changed; no paid model call, GPU rental, subscription or purchase; no destructive migration; spend gate not weakened; licence gate not disabled; no raw model output exposed; no restricted papers used; experimental code isolated (no production file requires the native engine, enforced by a test); no performance claim without a measurement. The only index change remains the staged deletion of `android/replay_pid29016.log` you approved earlier.
