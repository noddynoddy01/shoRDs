# 13. Security and licensing review

Date 2026-11-04 · Scope: the Phase 5 native-engine code (`backend/native/`, `backend/eval/nativeCompare.js`, `scripts/native_*.js`) and the model/data licences. **Status: IMPLEMENTED controls are TESTED by unit tests; nothing here was penetration-tested, no external audit was done, and licence readings are summaries of primary pages, not legal advice.**

## 8.1 Threat model in one paragraph

The input is untrusted: a paper (or its extracted text) can contain instructions aimed at the model. The model is untrusted: it can invent, reverse or inflate. The endpoint is a cost and data-exposure risk if it is remote. The output is a reputational risk if wrong. Controls are therefore placed on **what goes in, who may be called, how much may be spent, and what may come out**, and none of them rely on the model behaving.

## 8.2 Controls and their evidence

| # | Control | Where | Evidence |
|---|---|---|---|
| 1 | **No credential reaches the frontend.** The engine runs only in backend code; keys are read from `env` by name inside the adapter; no key appears in results, logs or errors | `modelAdapter.js` | TESTED (adapter tests inspect results and error text for the key value) |
| 2 | **Remote endpoints are refused by default.** Only loopback (127.0.0.1, ::1, localhost) is "free local". A remote URL needs `allowRemote:true`, a positive price, https and a key, otherwise a `POLICY_*` error is raised **before** any network call | `createOpenAiCompatibleAdapter` | TESTED |
| 3 | **Local CLI refuses non-local model URLs** | `scripts/native_run_local.js` | IMPLEMENTED; not unit-tested |
| 4 | **Spend gate is not weakened.** Production `aiBudget.js` is unchanged. A paid native or fallback call is possible only through `withSpendLimit` (worst-case reservation, fail-closed, unmeasured = worst case) or, for Claude, through the existing `guardClient` (the fallback adapter refuses to be built without the attestation `attestSpendGuarded:true`) | `modelAdapter.js` | TESTED, including the real `createAiBudget` gate in front of the stub |
| 5 | **A policy refusal is never retried on another paid provider** | `createRouter` | TESTED |
| 6 | **Prompt-injection hardening.** Excerpts are wrapped with the production `neutralizeTags`; tag-like text in a paper is replaced with `[tag removed]`; instructions in the paper that tell the model to ignore rules produce nothing the validators can accept, because every statement must quote its chunk verbatim | `prompts.js`, `structuredExtraction.js` | TESTED with an injection paper (plain text, since JATS parsing already strips tags) |
| 7 | **Quote anchoring.** A claim is kept only if it cites a chunk that was actually given and quotes it verbatim (normalised whitespace). Drop reasons are counted | `anchorItems` | TESTED |
| 8 | **Claim guard on every shown statement** (the existing `claimGuard`, unchanged), plus the production `validateIntelligence` as a second gate | `validation.js` | TESTED |
| 9 | **No raw model output in any result.** The only path is the `onRaw` callback used by the local harness | `pipeline.js` | TESTED (a canary string in raw output must not appear in the result) |
| 10 | **Licence gate respected.** Full text is processed only if the caller passes `fullTextAllowed:true`; default is abstract-only, and the result records `licenceDowngrade` | `pipeline.js` | TESTED |
| 11 | **No "verified" claims.** Statuses are `NATIVE_PROTOTYPE` and per-statement `SUPPORTED_BY_AUTOMATIC_CHECK`; the note says the checks are not proof | `validation.js`, `pipeline.js` | TESTED (strings asserted) |
| 12 | **Evaluation tooling cannot leak system identity or restricted text** to raters | `nativeCompare.js` | TESTED (sheets searched for system names; passages hidden when the licence forbids redistribution) |
| 13 | **Structure guard** now allows exactly one new place that calls a model (`native/modelAdapter.js`, single `invoke()` call site); the allow-list change is commented in the test | `aiBudget.test.js` | TESTED. **Disclosure:** I edited an existing guard test to add this entry; it is a deliberate, reviewable one-line change, not a weakening of the production gate |

## 8.3 Known gaps (stated, not hidden)

- **F-5-1 (existing `claimGuard`):** third-person direction verbs are not seen as opposites, e.g. "Latency rises." versus "Latency falls." Not detected as a reversal. A todo test exists.
- **F-5-2 (existing `claimGuard`):** swapped "from X to Y" numbers pass the number check, because each number appears somewhere in the evidence ("rises from 18.7 to 41.2" against "falls from 41.2 to 18.7"). A todo test exists.
  *Proposed fix (needs your decision):* extend the direction lexicon with 3rd-person forms, and add an ordered-pair check for "from X to Y". Because the guard decides what production shows, a change alters cached results, so it needs `INTEL_PROMPT_VERSION` bumped and re-checking against the Phase 3 corpus. I did not touch the guard in this phase. The native engine inherits both gaps; the second-opinion defence is the human reading the cited quote, which is shown with every statement.
- **Automatic checks are lexical and numeric.** A fluent statement that is wrong in a way no rule sees will pass. Stage E labels say so.
- **Stub:** the extractive stub is not a language model; every statement it produces is a copied sentence. It tests plumbing, not quality.
- **Prompt-injection hardening is tested against one hand-written attack.** A real adversarial set has not been run against a real model.
- **PDF:** the only PDF path exercised is `pdftotext` on a fictional PDF. Layout, columns, scanned pages, tables and equations are flagged by the quality report, not solved.
- **Sampling/timeouts:** the adapter sets a per-call timeout; a hung local server is the main availability risk (not load-tested).
- **Dependency/audit checks (`npm audit`, GitHub CI, Node 20, real-device tests): NOT RUN this phase.** The code adds no npm dependency.

## 8.4 Legacy files that look like AI features but are not

`backend/multi_agent_engine.py` returns hard-coded "research questions", an invented "p < 0.001" and other fixed text for any input. `backend/finetune_model.py` trains on one invented record when its dataset file is absent (see `07_…` 7.7). Neither is referenced from JS, Docker or CI files I searched. The risk is that someone runs them, or exposes one behind an endpoint, and the product shows fabricated analysis as if it were real. **Proposed (owner decides):** move `backend/*.py` AI engines to a clearly labelled `legacy/` folder with a README stating "returns fixed text, do not deploy", or delete them in a reviewed commit. I did neither.

## 8.5 Data handling

| Question | Answer |
|---|---|
| What leaves the machine when a **local** model is used? | Nothing. Loopback only |
| What leaves when a **hosted open-weight** endpoint is used? | The excerpts and prompts. Paper text may be copyrighted; processing it at a third party needs that provider's data-use terms checked (retention, training on inputs) and the paper licence to allow it. The licence gate already restricts to papers whose licence allows redistribution/processing, but I did not review any hosted provider's terms |
| What is stored? | Nothing new. The native engine writes no database rows. Evaluation files are local JSON/CSV |
| Personal data | Rater identifiers appear only in the score files the owner creates |
| Logging | Stage metadata (model, tokens, latency, cost, drop counts) only; no paper text, no prompts, no keys |

## 8.6 Licence review of what the engine depends on

| Component | Licence | Reading | Risk |
|---|---|---|---|
| Native engine code | project's own | written this phase | none |
| `pdftotext` (poppler) | GPL-2.0-or-later (◇ background) | invoked as a **separate process**, not linked or bundled; the GPL does not attach to our code by running a program. If the extractor is ever shipped inside the product image, redistribution duties begin | low for now; decide in D-5-3 |
| Qwen3.8-27B | Apache-2.0 (vendor model card, P) | commercial use permitted | low |
| gpt-oss-120b / 20b | Apache-2.0 (vendor page, P) | the vendor's usage policy applies as well; I did not read it | low to medium |
| Mistral Small 4 | Apache-2.0 on the repo reviewed | the repo reviewed was a variant; verify on the exact repo downloaded | low, verify |
| Gemma 4 | Apache 2.0 per the Google blog (P); sizes from community sources | verify on the exact weights page | low, verify |
| Llama 4 | Llama 4 Community License (S via mirror): >700M MAU clause, attribution, derivative naming, acceptable-use policy | usable but with strings | medium; ranked last for that reason |
| SciRIFF | `odc-by`, with three CC BY-NC subsets | filter subsets before commercial use | medium |
| Papers | per paper | `licensePolicy` gate; restricted papers excluded from training and evaluation | the Phase 4 licence confirmation is still the human step |
| Claude fallback | Anthropic commercial terms | I did not re-read them this phase; no Claude outputs are used for training | owner to confirm |

## 8.7 Prohibited actions confirmed not taken

No commit, push, merge or deploy. No production database or Railway access. No production secret or Anthropic configuration change. No paid model call, GPU rental, subscription or purchase. No model weights downloaded. No `.env` read. Restricted papers not used.
