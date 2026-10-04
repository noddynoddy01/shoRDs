# Phase 7 verification report

Date of run: 2026-10-04. Environment: cloud sandbox, real PostgreSQL 16.13 and real Redis 7 on localhost (one open, one password-protected, one TLS instance with a throw-away CA). Every number below was observed in that run. Anything not measured is marked **NOT VERIFIED**.

## 1. What Phase 7 delivered

| Area | What exists now |
|---|---|
| Frontend authentication | Firebase sign-in (email/password; Google popup on web) -> `AuthProvider` -> ID token -> `api` client -> `Authorization: Bearer` -> backend verifier -> project authorization. Route guard, project picker / onboarding, logout, inline error states. |
| Credential | The hardcoded admin credential in `app/auth.tsx` and its offline/mentor login paths are **removed**. Production identity is Firebase only. See section 5. |
| Paper retrieval | Paper reference -> canonical id -> OpenAlex / Europe PMC / arXiv metadata -> open-access full text -> extraction -> sections -> semantic chunks -> PostgreSQL. Explicit coverage `FULL_TEXT` / `ABSTRACT_ONLY` / `METADATA_ONLY` / `CONTENT_UNAVAILABLE`. |
| Grounding | The server builds the evidence from stored chunks. Client-supplied evidence is refused (`EVIDENCE_NOT_ACCEPTED`); only `chunkIds` are accepted and each must belong to the requested paper. |
| AI path | One path (`llm/aiPipeline.js`) used by the HTTP routes and the worker. Unavailable content never reaches the model. |
| Output | Structured research intelligence (tl;dr, findings, contributions, keywords) with mechanical citation validation. Status is `UNVERIFIED` or `FALLBACK`; **`VERIFIED` is never produced.** |
| Cache | Key = SHA-256 over schema version, tenant, project, paper, content hash, model, mode, prompt version, query. |
| Telemetry | Per-request ledger row: provider, model, tokens, cost (`NOT_MEASURED` unless a verified price exists), cache hit, fallback, request id, paper id, duration. |
| Redis TLS | `rediss://` supported with verified TLS (system CAs or `REDIS_TLS_CA`), TLS 1.2+, no skip-verify option. |

## 2. Test results

| Check | Result |
|---|---|
| Node unit tests (`npm run test:node`) | **174 / 174 pass** (anthropicClient 37, auth 12, cacheKey 5, copilotService 18, cors 10, evidence 5, frontendAuth 26, intelligence 9, papers 23, rateLimitConfig 5, readiness 13, redisTls 8, usageLedger 3) |
| Node integration tests (`npm run test:integration`, `--test-concurrency=1`, real Postgres + Redis) | **116 / 116 pass** (data clients, API, rate limiting, `/ready`, jobs, cache, multi-process, paper service, frontend client against the real runtime) |
| Python tests (`python3 -m unittest discover -s backend/tests`) | **1070 / 1070 OK** (unchanged baseline) |
| Pure frontend modules under `tsc --strict` | 0 errors (`services/auth/*`, `services/copilotMapping.ts`) |
| Gateway typecheck baseline | 3 errors, all environment-only (missing `@types/node`): `cacheManager.ts`, `requestDeduplicator.ts`, `redisCacheAdapter.ts`; none in Phase 7 files and none on the production path |
| Production entrypoint smoke test | `NODE_ENV=production node backend/start_local_server.js` with real Postgres/Redis: schema at v2, `/health` 200, protected routes 401 without a token, malformed token 401, allowed Origin gets CORS headers, disallowed Origin 403, token text absent from the log. `/ready` was **503** with `auth: KEYS_UNAVAILABLE` because Google's key endpoint is unreachable from this sandbox; database and Redis reported OK and `aiProvider` reported `NOT_CONFIGURED` (`NO_API_KEY`). |
| Secrets scan of every modified/new file | No private keys, API keys, service-account JSON or `.env` files. The only match is a fake connection string used as a redaction fixture in `readiness.test.js`. |

One regression was found and fixed during this run: the `parseRedisUrl` expectation in `dataClients.integration.test.js` lacked the new `tls` field.

### How the tests are seeded (read this before trusting them)
- Provider hosts are unreachable here, so retrieval is tested against **fictional provider-shaped fixtures** (fake OpenAlex / Europe PMC / JATS responses). They prove the pipeline logic, not the real providers' behaviour.
- The model is a test stub (`modelStub`) injected by dependency injection. Tests assert the production code never imports the stubs. **No Claude request was made in this phase.**
- Firebase tokens in tests are RS256 tokens signed with a locally generated key and served from an injected JWKS.

## 3. Exit-criteria checklist

| Criterion | Status | Evidence |
|---|---|---|
| Firebase frontend auth works and the token reaches protected requests | **Partly verified.** The client/session/route logic and the real client against the real backend pass; the real Firebase SDK, the sign-in UI and the Expo build were not run. | frontendAuth 26 unit + 9 integration |
| Backend validates real tokens | **Verified with locally signed tokens only.** Google's live JWKS is not reachable here. | auth tests; smoke test `KEYS_UNAVAILABLE` |
| Credential removed or rotated | Removed from code and docs. Rotation: it never authenticated against the server (see section 5). | repo-wide scan in frontendAuth tests |
| Project authorization from real frontend requests | Verified (auto-select, picker, 403, 404 separation). | frontendAuth.integration |
| Retrieval, coverage, evidence | Verified on fixtures; **live providers NOT VERIFIED** (run `scripts/verify_retrieval_live.js`). | papers, paperService.integration |
| `CONTENT_UNAVAILABLE` prevents Claude calls | Verified: zero model calls recorded for unavailable or metadata-only papers, in the API and the worker. | api + jobs integration |
| Chunking; the AI receives actual evidence | Verified: the stub parses the `<excerpt>` blocks it was sent and answers only from them. | papers, evidence, api integration |
| Structured intelligence | Verified (validation: citation existence, verbatim numbers, lexical overlap). | intelligence tests |
| Cache identity | Verified: separate entries for tenant, project, paper, content, model, mode, query; concurrent identical requests = 1 model call. | cache.integration (12) |
| Telemetry honest; no fake VERIFIED | Verified: cost is `NOT_MEASURED` without a verified price, fallback invents no tokens, VERIFIED is downgraded. | usageLedger, copilotMapping tests |
| Node and Python tests pass | Yes (section 2). | |
| Docker/build verification | **NOT VERIFIED** (no Docker daemon; npm install blocked). | |
| No secrets committed | Yes (scan above). | |
| Anthropic key stays OFF | Yes: not requested, not configured, not set anywhere. | |

## 4. Not verified here (environment limits, not passes)

1. Expo web/native build and a real browser run of the sign-in UI (`npm ci` is blocked, so there is no `node_modules`).
2. The real Firebase SDK sign-in, Google popup, and verification of a real ID token against Google's live JWKS.
3. Live scholarly providers: `node scripts/verify_retrieval_live.js` here exits 2 with every provider `NOT_VERIFIED` (the sandbox proxy rejects those hosts). Run it from a machine with outbound HTTPS and set `CONTACT_EMAIL`.
4. Docker image build and container start.
5. The live Railway deployment (untouched), its real proxy hop count, and managed Postgres/Redis behaviour.
6. A real `ANTHROPIC_API_KEY` (not set, by instruction).
7. Load and latency: nothing was measured, so no figures are claimed.
8. `git push` (the sandbox's git proxy denies this repository); the work is delivered as a commit plus a bundle and patch.

## 5. Security audit

| Surface | Finding | Status |
|---|---|---|
| AuthN | RS256 via JWKS; `aud`, `iss`, `exp`, `iat`, `sub` checked; forged, wrong-audience, expired and `alg:none` tokens rejected; custom `admin` claims ignored (admin = `ADMIN_UIDS` allow-list of Firebase uids). | Verified |
| AuthN limit | **Token revocation is not checked** (a disabled user's token stays valid until it expires, at most one hour). | Known limit |
| AuthZ | Project roles VIEWER < COMMENTER < EDITOR < OWNER from PostgreSQL; non-members get 404 not 403 for foreign resources; last-owner protection; the frontend never trusts a local role. | Verified |
| Tokens in the wild | The ID token is only ever sent in the `Authorization` header (never URL, query string, logs, telemetry, analytics, AI provider requests or database rows). Enforced by repo-wide scans in `frontendAuth.test.js`; the request log carries a 10-hex hash of the uid, never the token. | Verified (static scans + smoke log) |
| CORS | Exact-origin allow-list from `CORS_ORIGINS`, never `*`; disallowed origin 403; preflight handled. | Verified |
| Rate limiting | Redis fixed-window limits per ip / user / tenant, shared across replicas, fail-closed. IP depends on `TRUST_PROXY` and `TRUST_PROXY_HOPS`. **The right hop count for Railway must be checked on the live deployment.** | Verified locally; hop count NOT VERIFIED |
| Body limits | `MAX_REQUEST_BODY_BYTES` (default 512 KiB): declared and chunked oversize bodies get 413. Unauthenticated requests are refused before the body is read. | Verified |
| Tenant isolation | Results, jobs and cache entries are scoped by tenant and project; papers are public shared content. | Verified |
| Errors | 5xx text from upstream is replaced client-side; server errors carry a code and request id, not stack traces; DB/Redis URLs are redacted in errors. | Verified |
| Secrets | None committed; Anthropic key is server-side only and unset. Firebase web config (`EXPO_PUBLIC_*`) is public by design. | Verified |
| Redis transport | Plain `redis://` on Railway's private network and TCP proxy; `rediss://` only for external providers, with verified TLS. | Verified vs a real TLS Redis |

### Credential classification
The credential that was hardcoded in `app/auth.tsx` (and quoted in two defence guides) **must be treated as compromised**: it was in a public-facing client bundle and in git history. It never authenticated against the backend (backend admin is the Firebase uid allow-list), so rotation of a server secret is not needed, but if the same string was ever used as a password anywhere else, change it there. It remains in git history; this work does not rewrite history. Use `ADMIN_UIDS` for administrators.

### Findings outside Phase 7 (not fixed; recommend a follow-up phase)
1. `services/subscriptionService.ts` "verifies" payments client-side (`txn_` prefix check). It must not gate anything of value until payments are verified server-side.
2. Browser-side calls to AI providers with user-stored keys (`app/chat/[id].tsx`, `services/llm/providers/*`) bypass the server's auth, limits and ledger.
3. `services/paperNormalizer.ts` fabricates venue/publisher and `isPeerReviewed: true` for papers whose provider did not say so.
4. `federatedSearch` is unauthenticated.
5. Older simulated frontend retrieval services still exist and are not on the new path.
6. Firebase token revocation is not checked (above).

## 6. Railway variables

Set by the owner in the Railway dashboard:

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | the Firebase project id (the token audience) |
| `CORS_ORIGINS` | exact Vercel origin(s), comma separated, e.g. `https://<your-app>.vercel.app` |
| `ADMIN_UIDS` | comma-separated Firebase uids allowed to read `/api/v1/llm/health` and `/metrics` (may stay empty) |
| `TRUST_PROXY` | `true` |
| `TRUST_PROXY_HOPS` | `1` to start; verify against the live `X-Forwarded-For` |
| `DATABASE_URL`, `REDIS_URL` | the Railway-supplied references (plain `postgresql://` / `redis://` private-network URLs); do not rewrite to `rediss://` |
| `CONTACT_EMAIL` | a monitored mailbox for the scholarly APIs (recommended) |
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | **last, and only by the owner**, after the checks in section 7 |

Vercel (frontend build): `EXPO_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, and `EXPO_PUBLIC_API_URL` (the Railway backend origin). The Firebase project must list the Vercel domain under Authentication -> Authorized domains.

## 7. First checks after deploying (before the Anthropic key)

1. `GET /health` is 200 and `GET /ready` shows database OK, redis OK, `auth: OK` (this proves Google's JWKS loads from Railway), `aiProvider: NOT_CONFIGURED`.
2. Sign in from the Vercel site; the Network tab shows `Authorization: Bearer` on `/api/v1/projects` and a 200.
3. `node scripts/verify_retrieval_live.js` from a networked machine: expect `PASS` on the open-access cases and `CONTENT_UNAVAILABLE` for the invented DOI.
4. Check the real client IP the limiter sees (hop count) with a few requests and the request log.
5. Only then set `ANTHROPIC_API_KEY` on Railway, redeploy, and confirm `/ready` reports `aiProvider` reachable, then run one analysis and read the ledger row.
