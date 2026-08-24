# Changelog

All notable changes to the **shoRDs** project are documented in this file.

---

## [1.0.0-rc.1] - 2026-08-24 (Current Release Candidate)

### Multi-Provider AI Gateway & Router
- Added `services/llm/` provider abstraction supporting **Anthropic Claude 3.5 Sonnet**, **OpenAI GPT-4o**, **Google Gemini 1.5 Pro**, and **Local Deterministic Fallback**.
- Implemented `modelRouter.ts` for dynamic tier routing based on task complexity (Lightweight, Balanced, Heavy Synthesis).
- Implemented `costManager.ts` tracking input/output token pricing with automatic budget exhaustion cutoffs.
- Added `circuitBreaker.ts` with exponential backoff and half-open state recovery on upstream provider failures.
- Added `requestDeduplicator.ts` coalescing concurrent identical research queries.

### Grounding & Adversarial Claim Verification
- Added `services/claimVerification.ts` enforcing claim-first verification against source evidence chunks.
- Implemented automatic rejection of hallucinated claims, wrong numerical metrics, or ungrounded citations.

### Production Infrastructure & Multi-Tenancy
- Implemented `services/postgresDatabaseAdapter.ts` with 5-stage automated SQL migrations.
- Implemented `services/redisCacheAdapter.ts` with strict tenant key isolation (`shords:v1:{tenantId}:{projectId}:{key}`) and versioned invalidation.
- Created multi-stage `Dockerfile` and `docker-compose.yml` orchestrating API gateway, PostgreSQL 16, and Redis 7.2.
- Added comprehensive health check (`/health`) and readiness endpoints.

### Mobile & Native Upgrades
- Redesigned `app/(tabs)/explore.tsx` with category color indicators and inline accordions.
- Enhanced `components/ReelCard.tsx` with gesture-based navigation and high-density summary views.
- Upgraded `services/audioService.ts` with natural TTS speech pacing, domain-specific phonetic pronunciations, and breathing pauses.
- Updated Android build configuration supporting Gradle 8.13 and Android 14 (API 34).

### Test Suite & Zero-Cost Regression
- Expanded automated regression suite to **1,070 test cases** across 31 milestone suites and AI gateway validation with 100% pass rate.
- Verified 100% static type safety with 0 TypeScript compiler warnings.

---

## [0.9.0] - Research Engine & Workflow Studio
- Added **Literature Review Studio** (`services/literatureReviewStudioService.ts`) for multi-agent literature synthesis.
- Implemented **Citation Knowledge Graph** (`components/ResearchGraphModal.tsx`, `services/researchGraphService.ts`) with interactive node-link relationships.
- Integrated **BibTeX / Zotero / Mendeley / RIS** export engine (`services/citationService.ts`, `components/BibtexExportModal.tsx`).
- Added figure and vector chart extraction pipeline (`backend/figure_engine.py`).

---

## [0.8.0] - Web Platform & Branding
- Launched official shoRDs showcase website (`website/index.html`, `website/style.css`, `website/script.js`).
- Configured PWA manifest (`website/manifest.json`) and service worker offline caching (`website/sw.js`).
- Created high-resolution transparent branding assets (`assets/logo.png`, `website/assets/logo.png`).

---

## [0.5.0] - Asynchronous Backend & Multimodal Features
- Implemented Celery asynchronous task worker (`backend/celery_worker.py`) with Redis message broker.
- Added native video and audio streaming player (`components/AudioBriefPlayer.tsx`).
- Implemented self-hosted private LLM parser and model fine-tuning scripts (`backend/finetune_model.py`).

---

## [0.1.0] - Initial Project Scaffolding
- Initialized React Native Expo project with Expo Router navigation (`app/_layout.tsx`, `app/(tabs)/`).
- Created base UI components (`components/ResearchCard.tsx`, `components/ReelCard.tsx`).
- Created initial sample papers dataset (`data/samplePapers.ts`).
