# shoRDs Production Implementation Scorecard (Phase 33)

## 1. Database (PostgreSQL)
- **Adapter**: `PostgresDatabaseAdapter` (`services/postgresDatabaseAdapter.ts`) - IMPLEMENTED
- **Migration System**: 5-stage migration pipeline (Projects, Papers, Graph, Reviews, Audits) - IMPLEMENTED
- **Connection Pooling**: Bounded pool with maxConnections, idleTimeout, connectionTimeout - IMPLEMENTED
- **Transaction Rollback**: Atomic transaction boundaries with ACID rollbacks - IMPLEMENTED
- **Health & Readiness**: `/health` (process check) & `/ready` (dependency check) - IMPLEMENTED

## 2. Cache (Redis)
- **Adapter**: `RedisCacheAdapter` (`services/redisCacheAdapter.ts`) - IMPLEMENTED
- **Key Namespaces**: `shords:v1:{tenantId}:{projectId}:{key}` - IMPLEMENTED
- **TTL Support**: Default 3600s with per-key custom TTL - IMPLEMENTED
- **Versioned Invalidation**: Targeted pattern invalidation on graph and evidence updates - IMPLEMENTED
- **Fallback Graceful**: Direct database lookup upon cache failure without data loss - IMPLEMENTED

## 3. External LLM Provider
- **Adapter**: `LLMProvider` interface + `ExternalLLMModelProvider` (`services/llmAdapterService.ts`) - IMPLEMENTED
- **Authentication**: Server-side only API key resolution (`LLM_API_KEY`) - IMPLEMENTED
- **Token Telemetry**: Input & output token accounting in `LLMProviderResult` - IMPLEMENTED
- **Cost Telemetry**: Estimated cost schema active - IMPLEMENTED
- **Retry with Jitter**: Exponential backoff on HTTP 429 - IMPLEMENTED
- **Async Timeout**: 30-second circuit-break timeout - IMPLEMENTED

## 4. HTTP Server & Transport
- **Production Server**: `ProductionServer` (`backend/server.ts`) - IMPLEMENTED
- **Authentication**: Bearer token session validation with server-derived scope - IMPLEMENTED
- **Rate Limiting**: Configurable token bucket (default: 300 RPM) - IMPLEMENTED
- **Request Body Limits**: 5MB maximum payload - IMPLEMENTED
- **Health Endpoint**: `handleHealth()` returning `status: "UP"` - IMPLEMENTED
- **Readiness Endpoint**: `handleReady()` returning database & Redis statuses - IMPLEMENTED

## 5. Deployment & Automation
- **Multi-Stage Dockerfile**: Node 20 alpine multi-stage build - IMPLEMENTED
- **Docker Compose**: Full stack with PostgreSQL 16, Redis 7.2, and App - IMPLEMENTED
- **Environment Template**: `.env.example` with strict separation of server secrets - IMPLEMENTED
- **Graceful Shutdown**: SIGINT / SIGTERM closing database pool and cache - IMPLEMENTED

## 6. Security & Invariants
- **Secret Isolation**: 0 secrets exposed to Expo / React Native / client bundles - IMPLEMENTED
- **IDOR Protection**: Server-enforced tenancy and project boundaries - IMPLEMENTED
- **Prompt Injection**: Untrusted paper and evidence texts sanitized to `[REDACTED]` - IMPLEMENTED
- **Claim-First Generation**: Zero unsupported candidate claims allowed into output prose - IMPLEMENTED
