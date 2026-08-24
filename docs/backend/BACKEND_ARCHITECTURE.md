# shoRDs Backend Architecture & Services Documentation

## Executive Overview
The **shoRDs** backend infrastructure combines a high-throughput **Node.js/Express TypeScript API gateway** with an asynchronous **Python AI & Evidence Processing Pipeline**. It provides microservice-grade scalability, robust caching, federated academic paper indexing, PDF extraction, and grounded evidence retrieval.

---

## 1. Core Architecture Layers

```
+-------------------------------------------------------------------------------+
|                            CLIENT APPLICATIONS                                |
|  - Mobile App (React Native / Expo)         - Desktop Web OS (PWA Platform)   |
+---------------------------------------+---------------------------------------+
                                        |
                                        v  (REST / WebSocket API / Port 4000)
+-------------------------------------------------------------------------------+
|                  NODE.JS / EXPRESS HTTP GATEWAY (backend/server.ts)           |
|  - Bearer Token Session Context             - Request Deduplication & Coalesce|
|  - Tenant-Isolated Rate Limiting (300 RPM)  - 5MB Max Payload Validation      |
|  - Health & Readiness Probes (/health)      - Multi-Provider LLM Gateway Router|
+-------------------+-----------------------------------+-----------------------+
                    |                                   |
                    v                                   v
+-----------------------------------+   +---------------------------------------+
|  DATA PERSISTENCE LAYER           |   |  REDIS CACHING LAYER (Port 6379)      |
|  - PostgresDatabaseAdapter        |   |  - RedisCacheAdapter                  |
|  - 5-Stage Migration Pipeline     |   |  - Namespace: shords:v1:{t}:{p}:{key} |
|  - Connection Pooling (Max 20)    |   |  - Versioned Invalidation on Mutation |
|  - Atomic ACID Transaction Safety |   |  - Graceful DB Fallback on Outage     |
+-----------------------------------+   +---------------------------------------+
                    |
                    v
+-------------------------------------------------------------------------------+
|                PYTHON RESEARCH & EVIDENCE PIPELINE (Port 8000)                |
|  - shords_server.py (FastAPI / Uvicorn)     - celery_worker.py (Task Queue)   |
|  - federated_search.py (arXiv, Semantic)    - pdf_parser.py & figure_engine.py|
|  - evidenceChunkingService.ts               - claimVerification.ts (Grounding)|
|  - audio_engine.py (TTS Audio Synthesis)    - literature_review_writer.py     |
+-------------------------------------------------------------------------------+
```

---

## 2. Key Components & Implementation Files

### A. HTTP Server & Gateway (`backend/server.ts`)
- **Transport**: Express HTTP Server listening on port `4000` (or `PORT` environment variable).
- **Authentication**: JWT-based session token verification deriving tenant and project scope.
- **Middleware**:
  - Structured request logging with request correlation IDs (`X-Request-Id`).
  - Security headers & CORS validation.
  - Body payload limiter (5MB max) to prevent memory exhaustion attacks.
  - Token-bucket rate limiter defending against brute force and denial of service.

### B. Database Persistence Layer (`services/postgresDatabaseAdapter.ts`)
- **Supported Backends**: PostgreSQL 16 (Production) with SQLite parity adapter for zero-cost offline testing.
- **Schema Migrations**: 5-stage automated migration sequence:
  1. `Projects & Tenants Table`
  2. `Papers & Metadata Registry`
  3. `Citation Knowledge Graph & Edge Indices`
  4. `Literature Reviews & Synthesis Store`
  5. `Audit Log & Telemetry Tracking`
- **ACID Safety**: Automatic rollback on unhandled transaction failures.

### C. Redis Caching & Invalidation (`services/redisCacheAdapter.ts`)
- **Key Partitioning**: Strict hierarchical namespace keys: `shords:v1:{tenantId}:{projectId}:{cacheKey}`.
- **TTL Policies**: Configurable TTL (default 3600 seconds) with sliding window refreshes for hot research papers.
- **Cache Eviction**: Targeted pattern invalidation when evidence chunks, papers, or project notes are modified.

### D. Federated Search & Open-Access Resolver
- **Engines**: `backend/federated_search.py`, `services/federatedSearch.ts`, `services/oaResolverService.ts`.
- **Sources Supported**: arXiv, Semantic Scholar, CrossRef, PubMed, DOAJ, and direct Open-Access PDF resolvers.
- **Deduplication Engine**: `backend/deduplication_engine.py` using title Levenshtein distance, DOI normalization, and SHA-256 fingerprinting.

### E. Evidence Retrieval & Grounding Pipeline
- **Chunking**: `services/evidenceChunkingService.ts` implements sliding-window paragraph segmentation with section boundary awareness.
- **Claim Verification**: `services/claimVerification.ts` validates candidate LLM assertions against verified paper text segments, rejecting ungrounded or hallucinated claims.
- **Figure & Table Extraction**: `backend/figure_engine.py` and `services/figureExtractionService.ts` extract vector diagrams, charts, and captions from scientific publications.

---

## 3. Starting the Backend Locally

```bash
# Option 1: Start using Node.js TypeScript runner
npm run backend:start # or node backend/start_local_server.js

# Option 2: Start Python Research Engine
cd backend
uvicorn shords_server:app --host 0.0.0.0 --port 8000 --reload

# Option 3: Full Stack via Docker Compose
docker compose up -d
```
