# Phase 2 implementation report (2026-11-03 to 2026-11-04)

Branch `p0-fixes`, cloud working copy `/home/claude/shoRDs`. **Nothing is committed, pushed, merged or deployed.** No production, Railway, Firebase, billing or secret change was made. No paid service was used and no purchase was made. Every statement below is marked as one of: **verified** (I ran it and saw the result), **expected** (follows from the change, not measured), or **not done / not possible**, with the reason.

## 1. F1: evidence-validation gap

Finding F1 (from the P0 code review): the claim guard checked only part of a statement, so a model could state a number, a reversed result or an unqualified conclusion that the paper does not support and still have it shown as grounded.

What changed (verified by tests):

| Area | Change |
|---|---|
| `backend/llm/claimGuard.js` (new) | One deterministic checker used by production and by the offline evaluator, so they cannot drift apart. Checks, per statement against its cited passages: numbers and units (including numbers in narrative and free-text fields, decimals, percentages, ranges), reversed meaning (up/down, increase/decrease, significant/not significant, better/worse, for/against), negation, overclaim words (proves, always, causes, all) when the passage hedges, dropped hedges and qualifications (may, suggests, in this sample), and scope (a claim about "all patients" cited to a passage about one group). |
| `backend/llm/intelligence.js` | `INTEL_PROMPT_VERSION` bumped to `2026.3-intel` (cache keys change, old cached analyses are not reused). Every statement in every field is checked, not only the headline fields; context fields are number-checked; each surviving statement carries `evidenceSpans` (character offsets only, no copied text). Statements that fail are dropped, and what was dropped is counted so the UI can say so. |
| `backend/eval/faithfulness.js` | Claim-level faithfulness checker for offline evaluation using the same guard. |
| Regression data | `backend/tests/fixtures/evidence_regression.json` (cases written by an engineer, each marked as such) and `evidenceRegression.test.js` (39 tests), `evidenceGaps.test.js`. Pinned fingerprint of the checker's behaviour (`PINNED_FINGERPRINT 280e95885fc9ffeb`): any change to what the guard accepts or rejects now fails a test until someone re-pins it on purpose. |
| Protections kept | Spend gate, idempotency, budget reservation, cache identity, prompt safety tests all still pass (see test report). |

**What this does not prove.** The regression cases are synthetic. They show that the guard catches the failure types it was written for. They do not show how often real model summaries are wrong, how often the guard wrongly drops a correct statement, or what it misses. Known misses are documented in `claimGuard.js`: reversals with no cue word, wrong attribution (right fact, wrong subject), and paraphrased numbers ("a quarter" vs "25%"). Known false drops: "1,024" versus "1024" style formatting. **No accuracy rate is claimed.** The only way to measure it is the human benchmark (section 2); until then the guard is a safety net, not a guarantee.

**Owner decision (protected area):** this changes which statements survive and invalidates cached analyses. It needs your review before merge.

## 2. Summary-quality benchmark

Built and tested the machinery; **ran no study**. The cloud environment cannot reach scholarly APIs and there are no raters, so there are no ratings, no kappa, no failure-pattern results. Details and the owner steps are in `docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md`. Synthetic data in the tests checks the arithmetic (kappa, bootstrap, blinding, licence gate) and nothing else.

## 3. Product-quality fixes

| Item | What was wrong | What changed | Status |
|---|---|---|---|
| Needless `/api/v1/search` request | Every search first called a backend route that does not exist (always 404) and only then went to OpenAlex. | Removed. Test asserts the file does not mention it. | verified (test); latency gain expected, not measured |
| `searchRanker.ts` | A file called a ranker that no screen used; it implied ranking that did not happen. | Deleted; test asserts it is gone and nothing imports it. | verified |
| Fake year and fake sources | Unknown year displayed as 2026; seven source chips all queried OpenAlex. | Unknown stays unknown; one honest source line; unsupported filters reported in `ignoredFilters`. | verified (tests) |
| Removed OpenAlex fields | `host_venue`, `concepts` read after OpenAlex removed/deprecated them. | `primary_location.source`, `primary_topic`. | verified against docs; not against the live API (no network) |
| `offlineResearchService.ts` | Marked papers "cached" with no file; default licence invented; no way to know what was really saved. | Rewritten (schema v2). Saves brief + citations + metadata only. A PDF is `NOT_DOWNLOADED` unless bytes are verified (size bounds, `%PDF` header, `%%EOF` tail, SHA-256). Licence/open-access stay `null` unless known. Legacy records are discarded, not trusted. No downloader exists, so nothing is ever marked as a cached PDF today. | verified (11 tests, mutation-checked) |
| Device brief vs backend analysis | The paper screen's on-device brief looked like an AI analysis. | Labelled "built on this device by fixed rules, not an AI analysis, not checked claim by claim". | verified (test) |
| Decimal-splitting bug | The sentence splitter cut "p = 0.05" and "3.14" in the middle, producing fragments in briefs. | New `services/sentenceSplit.ts` (decimals, abbreviations, initials, "et al."), used by `paperIntelligenceService.ts`, `papersStore.ts`. Known under-split: "p < 0.05. n = 12" stays joined. | verified (2 deviceBrief tests, mutation-checked) |
| Sentence-level evidence traceability | Statements pointed to a chunk, not a sentence; the reader could not see where. | Results carry `evidenceSpans`. New `GET /api/v1/papers/*/evidence/*?start&end` returns the passage only if the paper's licence allows redistributing text (`redistributeText === "yes"`), otherwise `available:false` with a link to the paper. Span length capped at 1500 characters. Chunk ids are validated against the paper (DOI-based ids contain "/"). | verified (5 integration tests against real Postgres+Redis); **no UI yet** shows the passage; frontend work pending |

## 4. Feed, search, discovery

See `docs/ops/DISCOVERY_AUDIT_2026-11-04.md`. Done: one OpenAlex client (timeout, one retry for 5xx/network/timeout, no retry for 429, 10-minute cache, in-flight de-duplication, error classes) shared by search and feed. Findings, not fixes: the feed score has no relevance signal (constant 0.8), "user interest" is two hard-coded topics, citation counted twice; no fake explanation or score was added. Semantic Scholar not integrated (licence question open). Metrics defined. Backend search proxy with a server-side key recommended, not built.

## 5. Mobile and frontend performance

Verified by tests and inspection: 44 files import `Ionicons` directly (`@expo/vector-icons/Ionicons`) instead of the barrel, so the other icon-font families are not pulled into the bundle (only the Ionicons family is imported anywhere; test enforces). `components/Logo.tsx` now loads a 512 px asset of 91,114 bytes instead of the 1,440,271-byte original (original kept for app icon/website). Reel list is windowed (`getItemLayout`, `initialNumToRender 2`, `maxToRenderPerBatch 2`, `windowSize 5`, `removeClippedSubviews`); desktop list tuned. **Expected, not measured**: smaller first load, less memory while scrolling.

**Not measured, and why:** I could not produce a production web build of the latest code (Expo Metro never finished on the mounted `D:\shords\node_modules`, 443 packages over a slow mount; the cloud has no `node_modules` and cannot reach the npm registry), so there is no new bundle size, no Lighthouse score and no mobile-device measurement. September numbers are not used. To get them: on your PC run `npm run build:web`, then Lighthouse (mobile preset) against the served `dist`, and compare with the September figure.

## 6. Infrastructure and operations

| Item | Result |
|---|---|
| What can be verified without production | `/ready` semantics read from code and covered by tests: 503 if database, Redis or auth is down (or the AI provider unreachable only when `REQUIRE_AI_PROVIDER=true`); otherwise 200 with READY or DEGRADED. |
| Free uptime monitor | `docs/ops/UPTIME_MONITOR_SETUP.md`: exact steps and what to alert on. **Not set up** (needs an account in your name). |
| CI | `.github/workflows/ci.yml` (inactive until placed): Node 20 and 22 matrix, `npm ci --legacy-peer-deps --ignore-scripts`, unit and integration (Postgres and Redis service containers). Not run on GitHub. `.github` is write-protected for my device tools; the file exists in the cloud copy. |
| Firebase rules | `docs/ops/FIREBASE_RULES_REVIEW.md` plus `firestore.rules.PROPOSED` / `storage.rules.PROPOSED`. The live rules are not in the repository and I did not open the console, so **I have not reviewed what is actually deployed.** Nothing deployed. |
| Railway plan/usage | Not checked: no authorised access was provided. No change proposed to billing. |
| Purchases | See `TOOLING_PURCHASING_REGISTER.md`. Nothing bought. |

## 7. Verification

See `docs/ops/PHASE2_TEST_AND_REGRESSION_REPORT_2026-11-04.md`.
