# File-by-file change inventory: `p0-fixes` working tree vs HEAD (Phase 3)

Generated 2026-11-04 from `git status --porcelain -uall` and `git diff --numstat`. Nothing is committed. Status: M modified, ?? new (untracked), D deleted. +/- are line counts (new files show total lines). Separately, the 11 commits already on `p0-fixes` ahead of `main` change 102 files (+6,079/-4,137); see the P0 code review. Phase 3 changes are marked *(P3)* in the purpose column only where noted; otherwise purpose reflects the work as a whole.


## backend (22)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| M | `backend/app.js` | 45 | 2 | Evidence endpoint (licence checked before span length); NO_PROJECT_ID constant |
| M | `backend/data/migrations.js` | 13 | 0 | Migration 3: ai_usage project/user indexes |
| ?? | `backend/eval/agreement.js` | 49 | 0 | Offline evaluation/benchmark code (no model calls) |
| ?? | `backend/eval/benchmark.js` | 42 | 0 | Offline evaluation/benchmark code (no model calls) |
| ?? | `backend/eval/benchmarkScoring.js` | 66 | 0 | Offline evaluation/benchmark code (no model calls) |
| ?? | `backend/eval/faithfulness.js` | 192 | 0 | Offline evaluation/benchmark code (no model calls) |
| ?? | `backend/eval/guardReview.js` | 164 | 0 | Phase 3: review sheet/key builder and scorer for F1 |
| ?? | `backend/eval/summaryBenchmark.js` | 324 | 0 | Offline evaluation/benchmark code (no model calls) |
| ?? | `backend/eval/summaryMetrics.js` | 105 | 0 | Offline evaluation/benchmark code (no model calls) |
| M | `backend/llm/aiBudget.js` | 18 | 4 | Spend gate: Lua amount formatting fix for very large amounts; project scope not charged for NO_PROJECT_ID |
| M | `backend/llm/aiPipeline.js` | 32 | 3 | Refresh paper header/coverage on cache hits; cache key includes prompt version |
| M | `backend/llm/anthropicClient.js` | 70 | 13 | Pinned price table, profiles, fail-closed pricing, retired-model handling |
| ?? | `backend/llm/claimGuard.js` | 236 | 0 | F1: claim guard (numbers, overclaim, direction, negation, qualifiers, evidence spans) |
| M | `backend/llm/copilotService.js` | 6 | 1 | PROMPT_VERSION 2026.3 (cache invalidation) |
| M | `backend/llm/intelligence.js` | 42 | 5 | INTEL_PROMPT_VERSION 2026.3-intel; per-statement guard; evidenceSpans |
| M | `backend/llm/promptSafety.js` | 10 | 2 | Export LIMITS so the fingerprint guard pins their values |
| M | `backend/llm/resultCache.js` | 5 | 18 | Removed unused cachedCopilotQuery (it bypassed the spend gate); comment updated |
| D | `backend/llm/runCopilot.js` | 0 | 35 | DELETED: dead module that could reach the provider without the spend gate |
| ?? | `backend/papers/licensePolicy.js` | 156 | 0 | Per-licence permission policy (redistributeText, evalCorpus) |
| M | `backend/papers/paperService.js` | 8 | 1 | loadChunk for the evidence endpoint |
| M | `backend/security/cors.js` | 5 | 1 | Allowed methods match routed methods (GET, POST, PUT, OPTIONS) |
| M | `backend/security/projects.js` | 7 | 1 | NO_PROJECT_ID constant |

## tests (28)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| ?? | `backend/tests/fixtures/evidence_limits_register.json` | 451 | 0 | Fictional test fixture (no real paper text) |
| ?? | `backend/tests/fixtures/evidence_regression.json` | 549 | 0 | Fictional test fixture (no real paper text) |
| M | `backend/tests/node/aiBudget.integration.test.js` | 29 | 0 | Test (extended) |
| M | `backend/tests/node/aiBudget.test.js` | 222 | 2 | Test (extended) |
| ?? | `backend/tests/node/aiBudgetLargeAmount.integration.test.js` | 33 | 0 | Test (new) |
| M | `backend/tests/node/anthropicClient.test.js` | 148 | 0 | Test (extended) |
| M | `backend/tests/node/api.integration.test.js` | 5 | 0 | Test (extended) |
| ?? | `backend/tests/node/benchmarkScoring.test.js` | 63 | 0 | Test (new) |
| ?? | `backend/tests/node/benchmarkWorkflow.test.js` | 77 | 0 | Test (new) |
| M | `backend/tests/node/cacheIdentityAudit.test.js` | 561 | 36 | Test (extended) |
| M | `backend/tests/node/cors.test.js` | 28 | 1 | Test (extended) |
| ?? | `backend/tests/node/deviceBrief.test.js` | 62 | 0 | Test (new) |
| ?? | `backend/tests/node/evalAndLicense.test.js` | 165 | 0 | Test (new) |
| ?? | `backend/tests/node/evidenceEndpoint.integration.test.js` | 84 | 0 | Test (new) |
| ?? | `backend/tests/node/evidenceGaps.test.js` | 38 | 0 | Test (new) |
| ?? | `backend/tests/node/evidenceLimits.test.js` | 58 | 0 | Test (new) |
| ?? | `backend/tests/node/evidenceRegression.test.js` | 55 | 0 | Test (new) |
| ?? | `backend/tests/node/evidenceUi.test.js` | 168 | 0 | Test (new) |
| ?? | `backend/tests/node/faithfulness.test.js` | 138 | 0 | Test (new) |
| ?? | `backend/tests/node/fingerprintProbes.js` | 342 | 0 | Test (new) |
| M | `backend/tests/node/frontendAudit.test.js` | 25 | 4 | Test (extended) |
| ?? | `backend/tests/node/frontendSearchOffline.test.js` | 281 | 0 | Test (new) |
| ?? | `backend/tests/node/guardReview.test.js` | 124 | 0 | Test (new) |
| ?? | `backend/tests/node/migrationUpgrade.integration.test.js` | 88 | 0 | Test (new) |
| M | `backend/tests/node/papers.test.js` | 1 | 1 | Test (extended) |
| ?? | `backend/tests/node/registerTs.js` | 45 | 0 | Test (new) |
| ?? | `backend/tests/node/spendGateWiring.test.js` | 59 | 0 | Test (new) |
| ?? | `backend/tests/node/summaryBenchmark.test.js` | 150 | 0 | Test (new) |

## frontend (58)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| M | `app/(tabs)/_layout.tsx` | 1 | 1 | Ionicons import change only |
| M | `app/(tabs)/contact.tsx` | 1 | 1 | Ionicons import change only |
| M | `app/(tabs)/explore.tsx` | 1 | 1 | Ionicons import change only |
| M | `app/(tabs)/index.tsx` | 15 | 2 | Stable viewability config; list windowing (Phase 2, performance UNMEASURED) |
| M | `app/(tabs)/profile.tsx` | 1 | 1 | Ionicons import change only |
| M | `app/(tabs)/upload.tsx` | 1 | 1 | Ionicons import change only |
| M | `app/paper/[id].tsx` | 72 | 1 | Honest brief label; save-for-offline button (Phase 2) |
| M | `app/search.tsx` | 23 | 69 | Search screen uses federated search (Phase 2) |
| M | `components/AIActionMenu.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/AudioBriefPlayer.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/BibtexExportModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ComparePapersModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ContactContent.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/DesktopIntelligencePanel.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/DesktopNavSidebar.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/DesktopPaperCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/DomainCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ErrorBoundary.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/EvidenceExplorerModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/EvidenceInspectorDrawer.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ExpandableFigure.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/FeatureUnavailable.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/FigureViewerModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/GlassButton.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/HeroPaperHeader.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/Logo.tsx` | 1 | 1 | Uses the small logo |
| M | `components/MathRenderer.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/OriginalFigureCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/PaperDebateModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/PerplexitySearchGraph.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/PrerequisiteModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ProfileHeader.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ProvenanceBadge.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ReelCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ResearchCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ResearchGraphModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ResearchIllustration.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ResearchRoadmapModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/ResearchTutorModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/SearchBar.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/SettingsTray.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/SourceQualityCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/SubscriptionModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/TrustIndicatorsCard.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/VideoExplainerModal.tsx` | 1 | 1 | Ionicons import changed to the per-icon import (bundle size); no behaviour change |
| M | `components/research/CopilotResponse.tsx` | 1 | 1 | Phase 3: passes claim count to SourcePanel |
| ?? | `components/research/EvidenceStatementCard.tsx` | 136 | 0 | Phase 3: statement card with on-demand source sentence (not wired) |
| ?? | `components/research/EvidenceSummaryNote.tsx` | 34 | 0 | Phase 3: removed-statement count and caution note (not wired) |
| M | `components/research/SourcePanel.tsx` | 3 | 3 | Phase 3: replaced green 'Verified: N claims' with neutral count and 'not verified' wording |
| ?? | `services/evidenceModel.ts` | 249 | 0 | Phase 3: pure evidence display model and copy (tested) |
| M | `services/federatedSearch.ts` | 222 | 123 | Federated search with offline/ranking fixes (Phase 2) |
| M | `services/feedEngine.ts` | 5 | 40 | Feed ranking simplification (Phase 2) |
| M | `services/llm/aiGateway.ts` | 2 | 2 | Comment corrected: production AI path is aiPipeline -> spend gate (runCopilot.js no longer exists) |
| M | `services/offlineResearchService.ts` | 226 | 66 | Offline brief storage (brief only, no PDF claim) (Phase 2) |
| M | `services/paperIntelligenceService.ts` | 5 | 4 | Uses the shared sentence splitter instead of regexes that split on decimals and abbreviations (Phase 2) |
| M | `services/papersStore.ts` | 3 | 2 | Sentence splitter for result/limitation extraction (Phase 2) |
| D | `services/searchRanker.ts` | 0 | 33 | DELETED: no importers |
| ?? | `services/sentenceSplit.ts` | 68 | 0 | Sentence splitter used by the device brief (Phase 2) |

## tooling/CI (6)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| ?? | `.github/workflows/ci.yml` | 100 | 0 | CI: Node 20+22 matrix, Postgres 16 + Redis 7, no-silent-skips, frontend tsc. NEVER RUN; untracked |
| ?? | `scripts/estimate_analysis_cost.js` | 21 | 0 | Phase 3: offline worst-case analysis cost calculator |
| ?? | `scripts/eval_summaries.js` | 22 | 0 | CLI for the rule-based summary faithfulness evaluation (offline) |
| ?? | `scripts/f1_review.js` | 44 | 0 | Phase 3: F1 manual review kit CLI |
| ?? | `scripts/score_benchmark.js` | 18 | 0 | CLI that scores human-benchmark ratings (offline) |
| ?? | `scripts/summary_benchmark.js` | 131 | 0 | Benchmark CLI (collect, device, plan, score); collect now writes selection_record.csv |

## docs (32)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| M | `docs/AI_RUNTIME_AUDIT.md` | 2 | 2 | Reference to the removed runCopilot.js updated |
| M | `docs/architecture/AI_SPEND_SAFETY.md` | 2 | 1 | Spend-safety runbook addendum |
| M | `docs/architecture/AI_SUBSYSTEM_AUDIT.md` | 9 | 9 | Reference to the removed runCopilot.js updated |
| ?? | `docs/architecture/ROADMAP_UPDATE_2026-11-04.md` | 44 | 0 | Roadmap update (Phase 2) |
| M | `docs/architecture/adr/ADR-007-cache-identity-v2.md` | 12 | 1 | Prompt/cache fingerprint rules for the intelligence version |
| ?? | `docs/evaluation/F1_REVIEW_KIT.md` | 44 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/HUMAN_BENCHMARK.md` | 51 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/INTEGRATION_ASSESSMENT.md` | 30 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md` | 66 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/SUMMARY_BENCHMARK_RESULTS_2026-11-04.md` | 11 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/benchmark/annotation_template.csv` | 1 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/benchmark/dev_fixture.json` | 123 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/evaluation/example_cases.json` | 5 | 0 | Evaluation protocol, results or kit |
| ?? | `docs/ops/BENCHMARK_SPEND_ESTIMATE_2026-11-04.md` | 63 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/DISCOVERY_AUDIT_2026-11-04.md` | 82 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/EVIDENCE_UI_PLAN_2026-11-04.md` | 41 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/EXECUTION_REGISTER_2026-11-03.md` | 131 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/FIREBASE_RULES_REVIEW.md` | 34 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/OWNER_ACTION_CHECKLIST_2026-11-04.md` | 57 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/P0_CODE_REVIEW_2026-11-03.md` | 52 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/PHASE2_BEFORE_AFTER_QUALITY_2026-11-04.md` | 22 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/PHASE2_CHANGE_LIST_AND_LAUNCH_ASSESSMENT_2026-11-04.md` | 59 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/PHASE2_IMPLEMENTATION_REPORT_2026-11-04.md` | 63 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/PHASE2_TEST_AND_REGRESSION_REPORT_2026-11-04.md` | 45 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/PRODUCT_QUALITY_AUDIT_2026-11-03.md` | 68 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/RELEASE_VERIFICATION_CHECKLIST_2026-11-04.md` | 76 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/TOOLING_PURCHASING_REGISTER.md` | 92 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/UPTIME_MONITOR_SETUP.md` | 20 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/firebase/firestore.rules.PROPOSED` | 34 | 0 | Report or runbook for the owner |
| ?? | `docs/ops/firebase/storage.rules.PROPOSED` | 10 | 0 | Report or runbook for the owner |
| ?? | `docs/research/SIGMOBILE_RESEARCH_STRATEGY.md` | 180 | 0 | Research strategy note |
| M | `docs/security/SECURITY_AUDIT_2026-10.md` | 4 | 0 | Addendum |

## config/other (7)

| St | File | + | - | Purpose |
|---|---|---|---|---|
| M | `.dockerignore` | 2 | 0 | Keep dumps and benchmark data out of the image |
| M | `.env.example` | 47 | 2 | Document AI spend, prompt and budget variables (placeholders only) |
| M | `.gitignore` | 9 | 0 | Ignore Redis dumps, JVM crash logs and generated benchmark data (Phase 3) |
| M | `.vercelignore` | 3 | 1 | Keep dumps and benchmark data out of the Vercel upload |
| ?? | `assets/logo-ui-512.png` | 360 | 0 | Small UI logo (91 KB) replacing the 1.4 MB one in the UI |
| M | `docker-compose.yml` | 9 | 0 | Pass AI budget env vars; NOTE pre-existing default DB password remains (D-C-3) |
| M | `package.json` | 3 | 2 | Wire new test files into test:node (scripts only; no dependency change) |

Total entries: 153.
