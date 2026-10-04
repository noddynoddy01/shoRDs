# AI Runtime, Authentication and Security Audit

Dates: Phase 1-5 audit 2026-10-01; Phase 6 (authentication and security) 2026-10-02.
Scope: the code that actually serves production traffic (`node backend/start_local_server.js`, started by both the Dockerfile and `railway.json`).
Method: read the code, ran it, and ran adversarial tests against it. Statements here are about this commit, not about earlier reports.
Anything that was not run is listed under "Not verified".

## 1. What actually runs

`backend/start_local_server.js` is a thin listener. Everything else is plain CommonJS in `backend/` (no build step, no npm dependencies):

| Module | Role |
| --- | --- |
| `runtime.js` | Assembles the runtime from environment variables |
| `app.js` | HTTP routing and the request pipeline |
| `security/auth.js` | Firebase ID-token verification (RS256, JWKS) |
| `security/projects.js` | Project / role authorization (PostgreSQL) |
| `security/cors.js` | Environment-driven origin allow-list |
| `security/rateLimit.js` | Redis rate limiting (ip / user / tenant scopes) |
| `data/pgClient.js`, `data/redisClient.js` | PostgreSQL wire-protocol client (SCRAM-SHA-256) and RESP2 client (AUTH). No silent fallback. |
| `data/migrations.js` | Schema, advisory-lock serialised across replicas |
| `jobs/jobStore.js`, `jobs/worker.js`, `jobs/analysisProcessor.js` | Persistent analysis jobs |
| `papers/*` (`identity`, `providers`, `extract`, `chunker`, `paperService`) | Paper retrieval, coverage and chunk storage (added in Phase 7) |
| `llm/aiPipeline.js` -> `llm/evidence.js`, `llm/resultCache.js`, `llm/copilotService.js`, `llm/anthropicClient.js`, `llm/intelligence.js`, `llm/usageLedger.js` | The single AI execution path, shared by the routes and the worker |
| `readiness.js` | Honest `/ready` |

The TypeScript AI gateway, cache, deduplicator and adapters under `services/` are **not** on this path (decision in section 9).

## 2. Authentication audit (answers to the ten questions)

Method: repository-wide search for JWT, tokens, bearer, session, `SESSION_SECRET`, `JWT_SECRET`, signing/verification libraries, login endpoints and auth tests; reading `services/firebase.ts`, `app/auth.tsx`, `config/productionConfig.ts`, `backend/server.ts`, `backend/start_local_server.js` (before Phase 6), the Python stack and `environment.json`.

1. **What token does the frontend obtain?** None that the backend can use. `services/firebase.ts` wraps the Firebase client SDK (it would yield Firebase ID tokens), but the login screen (`app/auth.tsx`) does not use it for the session: it checks a hardcoded admin credential and local profiles and writes a profile object to AsyncStorage. No `Authorization` header is sent to the backend anywhere in the app.
2. **Where is it generated?** Nowhere. There is no JWT-signing code in the repository (no `jsonwebtoken`/`jose`/`PyJWT`, no `jwt.sign`, no HS256/RS256). `environment.json` said `"authProvider": "jwt_token_session_context"`; that was a label describing no implementation (corrected).
3. **Where is it stored?** AsyncStorage key `shords.currentUser` holds a profile, not a token.
4. **What signs it?** Nothing. `SESSION_SECRET` is loaded and validated in `config/productionConfig.ts` but never used to sign or verify anything (docs that report "SESSION_SECRET verified" describe a secret that protects nothing).
5. **What verifies it?** Nothing. The runtime route checked only that an `Authorization` header existed; `backend/server.ts` replaced it with a hardcoded identity (`usr_session_verified`, role OWNER of `tenant_primary`) for any header value.
6. **What claims does it contain?** There was no token, so none.
7. **How was the user identified?** Client side: the local profile. Server side: not at all.
8. **How was project/tenant identity determined?** It was not. The request body's `projectId` was trusted, apart from a hardcoded hook that returned 403 for the literal string `unauthorized_project_B` (a test fixture in production code).
9. **How was authorization enforced?** Not enforced on the runtime path. A role hierarchy (VIEWER < COMMENTER < EDITOR < OWNER) exists in `services/researchWorkspaceEngineService.ts` and `types/researchWorkspace.ts`, but it is in-memory TypeScript that production never loaded. The Python stack (`backend/shords_server.py`, `celery_worker.py`) is not what Railway runs.
10. **Was the existing implementation production-safe?** No: it was a presence check, and anything in the `Authorization` header authenticated. There was no existing implementation to extend.

**Decision (no parallel system):** Firebase Authentication is the only identity system in the project (`services/firebase.ts`), so the missing server half was built for it: the backend verifies Firebase ID tokens. Nothing else issues tokens. The verifier sits behind a small interface (`verify(token) -> principal`), so the provider can be swapped without touching routes. This is the one product decision worth confirming (section 12).

Related finding for the owner (not changed here): `app/auth.tsx` contains a hardcoded admin username/password in public source. It only sets a client-side "admin" profile in AsyncStorage and grants nothing on the server, but it should be removed or rotated, and the "admin" role must never be trusted by the backend. Server administrators are the Firebase uids in `ADMIN_UIDS`.

## 3. Production request pipeline

```
Origin check -> per-IP limit -> authenticate (verify Bearer token) -> per-user limit -> read body (size cap, JSON)
  -> validate input -> authorize resource (project role) -> per-tenant / daily limits -> handler -> safe response
```

Authentication and authorization are separate steps. `Authorization: something`, `Bearer test_token_usr_A`, a malformed JWT, `alg: none`, an HS256 token signed with the public key, a token signed by another key, an expired token, a wrong audience/issuer and an empty subject are all rejected (401) in tests.

### Authentication (`security/auth.js`)
- Verifies Firebase ID tokens: `alg == RS256`, `kid` present and published by Google's securetoken JWKS, RSA-SHA256 signature, `exp`/`iat`/`auth_time` (60 s skew), `aud == FIREBASE_PROJECT_ID`, `iss == https://securetoken.google.com/<project>`, non-empty `sub` (<=128 chars), optionally `email_verified` (`AUTH_REQUIRE_VERIFIED_EMAIL=true`).
- JWKS is cached by `Cache-Control`; unknown-`kid` refetches are throttled to one per 30 s; stale keys keep serving if a refresh fails.
- **Fails closed:** with no `FIREBASE_PROJECT_ID` every protected route answers 503 `AUTH_NOT_CONFIGURED`.
- Known limit: token revocation is not checked (needs the Firebase Admin API). A revoked token works until it expires (<= 1 h).
- Repeated credential failures from one IP are refused (`AUTH_FAIL_IP`, default 20/min). There are no backend login endpoints; Firebase handles sign-in.

### Authorization (`security/projects.js`, PostgreSQL)
- `projects(project_id, tenant_id, ...)` and `project_members(project_id, user_id, role)`. A project belongs to a tenant (today: the creator's personal tenant).
- Roles: VIEWER (read, copilot query) < COMMENTER < EDITOR (create/cancel analysis jobs) < OWNER (manage members). A non-member and an under-privileged member both get the same 403, so project ids cannot be probed. Jobs return 404 to non-members.
- A project always keeps at least one OWNER (`409 LAST_OWNER`).
- `unauthorized_project_B` is gone from production code (a test asserts no non-test source contains it). Authorization is data, not a magic string.

### Routes
| Route | Auth | Authorization | Limits (default) |
| --- | --- | --- | --- |
| `GET /`, `/health`, `/ready`, `/api/v1/replica` | public | - | global IP (not on health/ready) |
| `POST/GET /api/v1/projects`, `GET /api/v1/projects/:id` | token | member (VIEWER for get) | write/read user |
| `PUT /api/v1/projects/:id/members/:uid` | token | OWNER | write user |
| `POST /api/v1/copilot/query` | token | VIEWER of `projectId` (optional; none = personal scope) | user 20/min, tenant 120/min, user 400/day, tenant 2000/day |
| `POST /api/v1/analysis` | token | EDITOR | user 10/min, tenant 60/min, user 100/day, tenant 1000/day |
| `GET /api/v1/analysis/:id` | token | VIEWER of the job's project | read user |
| `POST /api/v1/analysis/:id/cancel` | token | EDITOR | write user |
| `GET /api/v1/llm/health`, `/api/v1/llm/metrics` | token | admin (`ADMIN_UIDS`) | read user |

Body cap (`MAX_REQUEST_BODY_BYTES`, default 524288) is enforced up front from `Content-Length` and while streaming. Errors are `{error, message, requestId}` with no stack traces, hostnames or connection strings; dependency outages are 503, unexpected faults 500 with a request id.

### CORS (`security/cors.js`)
`CORS_ORIGINS` is an exact-origin allow-list; `*` is ignored and reported. Production with no list allows no browser origin. Development (`NODE_ENV != production`, list unset) allows localhost/127.0.0.1 on any port. A request with a disallowed `Origin` is refused (403), including preflights; requests with no `Origin` are not CORS-blocked (they still must authenticate). Adding the custom domain later is a configuration change only.

### Rate limiting (`security/rateLimit.js`)
Redis fixed-window counters via one Lua script (atomic INCR+EXPIRE), shared by all replicas, scoped by ip / user / tenant, identifiers hashed in keys. `RATE_LIMIT_<NAME>="<limit>/<windowSeconds>"`; an invalid value stops startup. **Fail closed:** if Redis cannot answer, protected routes answer 503 (open sign-up means "no limiter" would be unbounded model spend); `RATE_LIMIT_FAIL_MODE=open` is an explicit opt-out and every bypass is counted. IP comes from `X-Forwarded-For` only when `TRUST_PROXY=true`, taking the entry `TRUST_PROXY_HOPS` from the right; **the hop count for Railway must be verified on the live deployment** (not verifiable here).
Open sign-up means per-user limits alone do not bound spend (accounts are free to create): the tenant and daily caps, plus optional `AUTH_REQUIRE_VERIFIED_EMAIL`, are the spend controls. The daily caps are estimates of reasonable use, not measured; tune them from real usage.

## 4. Readiness (`readiness.js`)

`/health` is liveness only (no dependency touched). `/ready` runs real checks, each bounded to 2.5 s, and never returns credentials, hosts or connection strings (category codes only):

| Check | OK means | Fails readiness |
| --- | --- | --- |
| database | `DATABASE_URL` set, `SELECT 1` answered, schema at the expected migration | yes (`NOT_CONFIGURED`, `DOWN`, `SCHEMA_NOT_READY`) |
| redis | `REDIS_URL` set, `PING` answered | yes |
| auth | `FIREBASE_PROJECT_ID` set and signing keys loadable | yes |
| aiProvider | key set and a token-free `GET /v1/models/{model}` succeeds (cached 60 s). Other states: `NOT_CONFIGURED` (no key), `UNREACHABLE` (network/timeout/5xx), `REJECTED` (401/403/404: key or model unusable) | only when `REQUIRE_AI_PROVIDER=true`; otherwise the replica is `DEGRADED` (ready, serving the labelled local fallback) |

The old `/ready` reported `aiGateway: true` unconditionally and reported database/Redis alive when their URLs were unset.

## 5. Analysis jobs

`POST /api/v1/analysis` inserts a `QUEUED` row in PostgreSQL, pushes the job id on a Redis list, and returns 202. A worker (inside every replica unless `WORKER_ENABLED=false`) pops an id, claims it atomically (`UPDATE .. WHERE status='QUEUED' RETURNING`), heart-beats a lease, runs the shared grounded pipeline, and writes `COMPLETED`/`FAILED`. Any replica can create, poll, cancel or process any job; state is only in PostgreSQL.

- States: `QUEUED -> PROCESSING -> COMPLETED | FAILED`, `QUEUED|PROCESSING -> CANCELLED`; `createdAt`, `startedAt`, `finishedAt`, `attempts`, `error {code,message}`, `createdByReplica`, `processedByReplica`.
- A worker that dies mid-job leaves an expired lease: the job is re-queued, or `FAILED` (`WORKER_LEASE_EXPIRED`) after `max_attempts` (3). Redis queue loss is repaired from PostgreSQL (stale `QUEUED` rows are re-pushed). Duplicate queue entries are harmless (the claim is atomic).
- `Idempotency-Key` header makes retries safe (per user).
- Cancelling a `PROCESSING` job is cooperative: the in-flight model call is not aborted; its result is discarded and the job ends `CANCELLED`.
- A result is never `VERIFIED`: model output is `UNVERIFIED`, local output `FALLBACK`. A guard rejects a `VERIFIED` result from the processor.
- Until paper retrieval exists, a job needs `evidenceChunks` in the request (422 `NO_PAPER_CONTENT` otherwise). With no `ANTHROPIC_API_KEY` the job still completes, honestly labelled `FALLBACK`.
- The in-memory `Map`, the `setTimeout` simulation and the templated "VERIFIED" result are removed (a test asserts this).

## 6. Cache and de-duplication (wired, not claimed)

`runCopilot` (used by the copilot route and the worker) goes through `llm/resultCache.js`: Redis cache plus single-flight lock, shared by replicas. Key = SHA-256 over schema version, tenant, project, paper id, content hash of the evidence, model, analysis depth, prompt version and the question. Only real, complete provider answers are cached (never fallbacks, content-unavailable results, truncated answers or errors); a cache hit reports `tokens.source = CACHE` with no spent tokens. `AI_CACHE_ENABLED=false` disables it and telemetry then says `DISABLED`, not `WIRED`. Regression tests cover isolation by tenant, project, personal scope, paper, content, question, depth and model, cross-replica hits and concurrent de-duplication (8 identical concurrent requests = 1 model call).

## 7. Fake / synthetic fixture classification

| Occurrence | Class | Action |
| --- | --- | --- |
| `services/researchCopilotService.ts` (hardcoded claims "VERIFIED", confidence 0.96, 0.924 AUROC, `chunk_1842`, `openalex-W123`, two invented papers) | **Production**: `app/research/copilot.tsx` (a live Expo route) called it in the browser for any query | Removed; returns an explicit `INSUFFICIENT_EVIDENCE` response with no claims/sources/evidence |
| `services/researchMapService.ts` (fixed tree with the 0.924 finding) | Production (same screen) | Removed; only the user's question is the root node |
| `services/researchQueryEngine.ts#compareMethods` (two invented rows) | Dead code in the app, demo data | Returns `[]` |
| `app/research/copilot.tsx` default context (`proj_medical_fl`, paper/chunk ids, `usr_101` / `tenant_default` identity) | Production demo state / fake identity | Emptied; identity is no longer sent by the client |
| `services/copilotExecutionPipelineService.ts` (every excerpt labelled VERIFIED) | Non-production harness (only `backend/server.ts`) | Claims `NEEDS_REVIEW`, response `UNVERIFIED` |
| `backend/server.ts` (identity `usr_session_verified`, OWNER, any header) | Non-production TS skeleton | Fails closed; header says it is not the production server |
| `backend/tests/test_phase2x.py`, `test_ai_gateway.py`, `verify_claims_adversarial.py` (dict literals with 0.924/chunk_1842) | Test-only fixtures | Left in place (they do not touch production code) |
| `backend/tests/reproduce_summary_bug.py`, `docs/phases/*` | Documentation of past findings | Left |
| `backend/tests/verification/test_live_tcp_endpoints.py` | Test script that printed PASS without checking, used the fake token and the hook, and printed a fixed "0.0% error rate" | Rewritten: real assertions, real measurements, skips what it cannot check |

## 8. Telemetry principle (unchanged)

Unmeasured values are `null`, `NOT_MEASURED`, `NOT_WIRED` or `DISABLED`, never a plausible number. `/api/v1/llm/metrics` (admin) reports per-replica counters, cache hit/miss/dedup counts (real), rate-limiter allowed/limited/backend-error/failed-open counts, per-route HTTP status classes, and job counts across all replicas from PostgreSQL. Counters other than job counts are per replica and reset on restart.

## 9. AI gateway convergence decision

**One canonical path: the CommonJS runtime** (`runCopilot` -> `anthropicClient`). The TypeScript gateway is *not* made the Anthropic provider behind it, because: (a) the production image runs plain Node with no TS build, and the gateway would need one; (b) the gateway's cache, deduplicator and rate limiter sit on `services/redisCacheAdapter.ts` and `postgresDatabaseAdapter.ts`, which are stubs (no AUTH, silent per-process fallback, constant health), so routing through them would re-create the false "distributed" claims this phase removes; (c) the useful gateway behaviours (cache keys, single-flight, per-tenant limits, retries, cost estimates, model routing) now exist once, wired to real Redis, in the runtime. The TS gateway files carry a header saying they are not on the production path. If a TS gateway is wanted later, the correct move is to port it onto the real clients and delete this duplicate, not to run both.

## 10. Sonnet 5.5 request rules (kept intact; from the current docs)

- Non-default `temperature`, `top_p`, `top_k` return 400 (never sent). `thinking` is never sent (adaptive by default; `disabled`/`budget_tokens` return 400).
- Effort is `output_config.effort` (`low|medium|high|xhigh|max`).
- Thinking counts toward `max_tokens`; the first content block can be a `thinking` block, so the answer is read from `text` blocks. `stop_reason` can be `refusal` / `model_context_window_exceeded`.
- Retired models (`claude-3-5-sonnet-20241022`, `claude-3-7-sonnet-20250219`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`) are overridden and flagged. Model is `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`. Price used for estimates: $2 / $10 per million input/output tokens; the Console invoice is the source of truth.
- Not yet confirmed against the live API with a real key (none is configured). The request body is checked against the docs and mocked tests; a deliberately invalid key was used to confirm the HTTPS path and 401 mapping, and the token-free model probe used by `/ready` was exercised the same way.

## 11. Verification results

Run on 2026-10-02 against real PostgreSQL 16.13 and real Redis 7 (one open, one password-protected) on localhost. Every number below was observed in that run.

| Check | Result |
|---|---|
| Node unit tests (`npm run test:node`) | **100 / 100 pass** (55 pre-existing Sonnet 5.5 / copilot tests + auth 12, CORS 10, rate-limit config 5, cache key 5, readiness 13) |
| Node integration tests (`npm run test:integration`, `--test-concurrency=1`) | **87 / 87 pass**: data clients 18, API 14, rate limiting 13, `/ready` 11, jobs 15, cache 12, multi-process 4 |
| Python tests (`python3 -m unittest discover -s backend/tests`) | **1070 / 1070 OK** |
| TypeScript | Full `tsc` is **blocked** (`npm ci` returns 403 for a package). Targeted `tsc --strict` on the gateway set and on the edited files: **3 errors, identical on both sets, all environment-only** (missing `@types/node` in `cacheManager.ts`, `requestDeduplicator.ts`, `redisCacheAdapter.ts`, files not on the production path); **0 errors in any file edited in Phase 6** |
| Docker build / typecheck | **NOT RUN**: no Docker daemon and Docker Hub is unreachable here |
| Production startup (`node backend/start_local_server.js`, `NODE_ENV=production`) | Boots, migrates schema to v1. `/health` 200; `/ready` **503 NOT_READY** (database OK, redis OK, auth NOT_CONFIGURED, aiProvider NOT_CONFIGURED); copilot call without a token 401; disallowed Origin 403; SIGTERM exits 0 (also asserted by an automated test) |
| Authentication / authorization | Covered by auth unit tests (12) and API integration tests (14), including 401/403/404 separation, last-owner protection and no production `unauthorized_project_B` hook |
| CORS | 10 unit tests + API integration |
| Rate limiting | 13 integration tests against real Redis, including a limit shared by two replicas and fail-closed / explicit fail-open |
| Readiness | 13 unit + 11 integration tests covering the seven required scenarios |
| Job persistence | 15 in-process multi-replica tests + 3 multi-process tests: job created by process A, polled via process B, completed by process C's worker; SIGKILL of a worker mid-job, lease expiry, takeover with `attempts=2` |
| Multi-replica | In-process replicas sharing one database and Redis, and separate OS processes (above) |
| Mutation testing | 17 deliberate defects injected into auth, CORS, rate limiting, authorization, jobs, cache isolation and body-size handling; **all 17 caught** by at least one failing test. Four first survived (truncated answer cached, limiter `hit` failing open, fallback answer cached, declared Content-Length check removed); each exposed a test gap that was fixed and re-run (failing-test counts after the fix: 2, 3, 2, 2) |
| Provider HTTPS path | A deliberately invalid key against the real API returned 401, reported as `REJECTED` / `INVALID_CREDENTIAL` |

### Not verified

- Docker image build and container start.
- A full-project TypeScript check and the Expo/web build.
- The live Railway deployment (untouched), its real proxy hop count for `TRUST_PROXY_HOPS`, and managed Postgres/Redis behaviour.
- Verification of a real Firebase ID token against Google's live JWKS (tests sign tokens with a locally generated key; the JWKS fetch is only exercised with an injected fetcher).
- Behaviour with a real `ANTHROPIC_API_KEY` (none configured, by instruction).
- Load or latency figures: none were measured, so none are claimed.


## 12. Open items and decisions for the owner

- **Confirm Firebase ID tokens as the identity provider** (assumed; swappable behind the verifier interface).
- **Set on Railway** (nothing was changed on the live deployment): see `docs/PHASE7_VERIFICATION.md` section 6 for the full list. Railway's Postgres/Redis URLs are plain `postgresql://` / `redis://`; the in-repo Redis client also speaks `rediss://` (verified TLS) for external providers.
- **Phase 7 status:** the frontend now signs in through Firebase and sends `Authorization: Bearer <ID token>`; the hardcoded credential is removed; paper retrieval, grounding and structured intelligence exist. What could not be run here is listed in `docs/PHASE7_VERIFICATION.md` section 4.
- Revocation checks and refresh-token handling are out of scope of the verifier (section 3).
- Daily caps and limits are starting points to tune from real usage.
