# shoRDs — Master Handoff & Architecture Context Prompt
## For Claude 3.5 Sonnet / Claude 3.7 Sonnet (Pro / API / Coding Assistant)

---

```markdown
You are taking over lead engineering on **shoRDs** (Research Intelligence Operating System).
Your mission is to continue development, maintenance, and production scaling smoothly without rewriting existing functionality, breaking working architecture, or hallucinating state.

---

### 1. PROJECT IDENTITY & CORE CONCEPT
- **Product Name**: shoRDs
- **Value Proposition**: TikTok-style reel feed meets Bloomberg Terminal for scientific research. Transforms dense academic papers into digestible, verified, multi-perspective intelligence cards with grounded AI copilot synthesis, citation tracing, methodology validation, and audio/presentation synthesis.
- **Repository**: https://github.com/noddynoddy01/shoRDs
- **Local Working Directory**: `D:\shords`
- **Current Git Branch**: `main` (clean, fully synchronized with `origin/main`)

---

### 2. LIVE CLOUD ARCHITECTURE & URLS
The application is publicly deployed and live in production:

1. **Frontend (Web SPA)**:
   - **Hosting**: Vercel
   - **Live Production URL**: https://shords.vercel.app
   - **Tech Stack**: React Native Web / Expo (SDK 52), TypeScript, Lucide Icons, Reanimated
   - **Form Factors**:
     - **Desktop** ($\ge 1024\text{px}$): Responsive 3-column scientific workstation layout (Left: Navigation sidebar; Center: Paper stream card feed; Right: Live AI Copilot & Research Intelligence Panel).
     - **Mobile / Tablet** ($< 1024\text{px}$): TikTok/Instagram-style vertical reel snap feed with swipe gestures, compact bottom tabs, and expandable modals.

2. **Backend (API Gateway & Microservices)**:
   - **Hosting**: Railway (`disciplined-dream` project)
   - **Live Production URL**: https://shords-backend-production.up.railway.app
   - **Project ID**: `3e6365dc-784f-42dd-a0da-997d2e8efe48`
   - **Service ID**: `09302972-999a-4304-b95b-f465b04ee804` (`shords-backend`)
   - **Environment ID**: `187d0c2d-859d-4a42-8056-c4ef8ded5302` (`production`)
   - **Runtime**: Docker (Multi-stage Node.js 20 Alpine container)
   - **Replicas**: Scaled to **2 instances** (`numReplicas: 2`) with `/health` HTTP probe.

3. **Managed Database**:
   - **Hosting**: Railway (`shords-postgres`)
   - **Engine**: PostgreSQL 16 Alpine
   - **Internal URL**: `postgresql://postgres:***@shords-postgres.railway.internal:5432/shords`
   - **Storage Mount**: Persistent volume mounted at `/var/lib/postgresql/data/pgdata`.

4. **Managed Distributed Cache & Locks**:
   - **Hosting**: Railway (`shords-redis`)
   - **Engine**: Redis 7 Alpine
   - **Internal URL**: `redis://shords-redis.railway.internal:6379`
   - **Features Handled**: Shared LLM semantic cache, distributed rate limiting sliding counters (`INCR`), multi-replica request deduplication locks (`SET ... NX EX 30`).

---

### 3. LIVE VERIFIED ENDPOINTS
All of the following endpoints are operational and tested against the live Railway backend:
- `GET /health` → Returns HTTP 200 `{ "status": "UP", "timestamp": "..." }`.
- `GET /ready` → Returns HTTP 200 `{ "ready": true, "database": true, "redis": true, "aiGateway": true }` verified via active TCP socket handshakes.
- `GET /api/v1/replica` → Returns replica ID, uptime, memory, and cluster metadata.
- `POST /api/v1/analysis` → Background asynchronous queue for heavy paper processing (`{ jobId, status: "QUEUED" }`).
- `GET /api/v1/analysis/:jobId` → Status & result polling for asynchronous analysis jobs.
- `GET /api/v1/llm/health` → Provider status (`anthropic`, `openai`, `gemini`, `local_deterministic`).
- `GET /api/v1/llm/metrics` → Active model, token counts, cost tracking, and cache hit metrics.
- `POST /api/v1/copilot/query` → Grounded synthesis pipeline with claim verification, evidence chunks, and token cost telemetry.

---

### 4. KEY SOURCE CODE DIRECTORIES
- `app/` — Expo Router tabs and modal screens (`app/(tabs)/index.tsx`, `library.tsx`, `insights.tsx`, `profile.tsx`).
- `components/` — UI components:
  - `DesktopNavSidebar.tsx`: Left navigation column for desktop.
  - `DesktopPaperCard.tsx`: Center paper card view with abstract tabs, claims, and methodology metrics.
  - `DesktopIntelligencePanel.tsx`: Right copilot chat and claim verification pane.
  - `PaperCard.tsx`: Mobile reel snap paper card with gesture animations.
- `services/` — Core services:
  - `redisCacheAdapter.ts`: Live TCP RESP socket adapter for Redis (supports `get`, `set`, `setNx`, `incr`, `checkHealth`).
  - `postgresDatabaseAdapter.ts`: Database adapter and TCP health checks.
  - `copilotExecutionPipelineService.ts`: Pipeline coordinating claim verification, retrieval, and prompt synthesis.
  - `llm/`: AI Gateway modules:
    - `aiGateway.ts`: Multi-provider router.
    - `cacheManager.ts`: Shared semantic Redis cache layer.
    - `rateLimiter.ts`: Sliding window rate limiter with Redis atomic counters.
    - `requestDeduplicator.ts`: In-flight deduplication and distributed Redis locks.
- `backend/` — Server implementations:
  - `start_local_server.js`: Production Node.js TCP HTTP server entrypoint run inside Docker container (`CMD ["node", "backend/start_local_server.js"]`).
  - `server.ts`: TypeScript Express server definition.
  - `tests/`: 1,070 unit tests (all passing: `python -m unittest discover -s backend/tests`).
- `docs/` — Architecture specifications, deployment timelines, DNS configuration (`CUSTOM_DOMAIN.md`), and phase documentation.

---

### 5. PRIOR WORK COMPLETED (PHASES 1–41)
1. **Paper Ingestion & Summarization Integrity**:
   - Fixed prior bug where different papers showed generic or duplicated summaries.
   - Summaries now strictly derive from unique paper IDs, DOI metadata, and grounded chunk extractions (`verify_fixed_summaries.py` passing 4/4 tests).
2. **Desktop-First Optimization**:
   - Implemented a true 3-column workstation layout on desktop displays ($\ge 1024\text{px}$) while preserving the vertical snap reel on mobile.
3. **Multi-Replica Stateless Hardening**:
   - Eliminated process-local bottleneck single points of failure.
   - Distributed rate limiter via Redis `INCR` per minute bucket.
   - Distributed in-flight deduplicator via Redis `setNx`.
   - Redis shared response and embedding cache.
   - Scaled Railway `shords-backend` to 2 replicas with zero downtime.
4. **Cloud Infrastructure Deployment**:
   - Deployed Frontend to Vercel CDN.
   - Deployed Backend, PostgreSQL, and Redis to Railway with private networking and persistent storage volumes.
   - Live TCP socket readiness probes established for `/ready`.
5. **Codebase Hygiene**:
   - TypeScript compilation passes with 0 errors (`npx tsc --noEmit`).
   - Python unit test suite passes with 1,070 successful tests.

---

### 6. CURRENT STATUS & IMMEDIATE PRIORITIES

#### A. Anthropic Claude API Key Activation
- **Current State**: The backend code in `backend/start_local_server.js` contains the complete Anthropic Claude integration (`https://api.anthropic.com/v1/messages` using `claude-3-5-sonnet-20241022`).
- **Pending Action**: `ANTHROPIC_API_KEY` is not yet set in the Railway environment variables. The backend currently falls back gracefully to `LOCAL_DETERMINISTIC_VERIFIED` mode.
- **Action Required**: The user needs to add `ANTHROPIC_API_KEY` in the Railway dashboard (`https://railway.app/project/3e6365dc-784f-42dd-a0da-997d2e8efe48/service/09302972-999a-4304-b95b-f465b04ee804/variables`). Once set, test a live query to verify real token consumption.

#### B. Custom Domain Setup
- **Documentation**: [docs/CUSTOM_DOMAIN.md](file:///D:/shords/docs/CUSTOM_DOMAIN.md) has complete DNS mapping instructions.
- **Apex / WWW**: Points to Vercel (`76.76.21.21` / `cname.vercel-dns.com`).
- **API**: Points to Railway (`api.shords.com` → `shords-backend-production.up.railway.app`).
- **Action Required**: Await user purchase/selection of custom domain, then configure DNS records.

#### C. Mobile App Store Packaging (Future Phase)
- DO NOT submit to iOS App Store or Google Play Store yet.
- Prerequisites are: Claude synthesis verification, custom domain connection, and final end-to-end user testing.

---

### 7. RULES OF ENGAGEMENT
1. **Never Rebuild From Scratch**: shoRDs is an advanced, highly refined production system. Preserve existing patterns, types, and logic.
2. **Never Commit Secrets**: Do not write `.env` files with plain text API keys or commit secrets to Git.
3. **No Force Pushes / History Rewriting**: Standard Git workflow only (`git add`, `git commit -m "..."`, `git push origin main`).
4. **Always Verify**: Verify changes with `npx tsc --noEmit` and `python -m unittest discover -s backend/tests`. Do not declare something "working" without empirical proof.
5. **Preserve Responsive Layouts**: Ensure both desktop 3-column view and mobile swipe views remain functional.
```
