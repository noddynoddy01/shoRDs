# Phase 8: from "locally verified" to "cloud verified"

Date: 2026-10-04. **Status: NOT READY FOR THE ANTHROPIC KEY.** Everything that can be proven without your cloud accounts has been
proven; the remaining gates need your Railway, Vercel, Docker and an internet connection. They are scripted below so each one ends
in a PASS / FAIL / NOT_VERIFIED line rather than an opinion.

## 1. Why the cloud gates have not run

| Blocker | Effect |
|---|---|
| `git push` is refused (the sandbox's git proxy does not have `noddynoddy01/shoRDs` authorised). Phase 6 (`4a113d7`), Phase 7 (`16a1784`) and this phase's commit exist only locally, plus the delivered bundle/patch files. | Vercel and Railway are still running the **old** code, so no production sign-in, `/ready`, hop-count or retrieval check can describe Phase 7/8. |
| No access to your Railway or Vercel projects from this session. | Railway variables could not be read (Step 2): they must be listed by you, not assumed. |
| The sandbox cannot reach the scholarly providers, Google's key endpoint, npm or Docker Hub; the linked computer has no folder shared and runs commands in a Linux VM, not on your Windows host. | Live retrieval, Docker build and the Expo web build did not run (Steps 5-9). |

## 1b. Observed production state (read-only, 2026-10-04, via the desktop app's built-in browser)

The sandbox cannot reach `*.up.railway.app` or `*.vercel.app` (egress allowlist), so these were plain GET requests made from the
person's own desktop browser. Nothing was submitted, no sign-in was attempted, and no token or secret was read.

| Observation | Result |
|---|---|
| Railway `GET /health` | 200 `{"status":"UP"}` |
| Railway `GET /ready` | 200, **old shape**: `{ready, database, redis, aiGateway, details}`. No `auth` or `aiProvider` fields. |
| Railway `GET /api/v1/projects`, `GET /api/v1/replica` | **404 NOT_FOUND**. These routes exist in Phase 6+, so the backend is running pre-Phase-6 code. |
| Vercel entry bundle (`/_expo/static/js/web/entry-*.js`, 3.7 MB) | No Anthropic/OpenAI/Google key pattern, no `postgres://` or `redis://` URL, no private key. **But** it still contains the browser-side Gemini call (`generativelanguage.googleapis.com` with a key read from `shords.geminiKey`), the fake payment flow (`txn_demo_verification_token`), the local entitlement key `shords_user_subscription_state`, a call to a non-existent `/api/v1/search`, and no `purgeLegacyBrowserAiKeys` and no Firebase `apiKey` configuration. This is the pre-Phase-7/8 frontend. |
| Railway dashboard | Browser is not signed in. Deployed commit and variables could not be read. |

Conclusion: the live site still has the problems Phase 8 removed (client-side Pro grant and browser-side Gemini). Pushing the six
commits and redeploying both services is the single action that closes them. The Vercel and Railway deployed *commits* themselves
are `NOT_VERIFIED` (no dashboard access); the statements above are inferred from observed behaviour.

Push diagnosis: `git push` -> 403 (repository not in the session's authorised set); `gh api repos/noddynoddy01/shoRDs` -> "not
enabled for this session"; `add_repo(access: push)` -> `permission_denied: link your GitHub account`; `list_repos` -> "no GitHub
account linked". The only fix is linking GitHub to this session (or applying `shords-all-unpushed.bundle` yourself). No other
credential path exists and none was retried.

Re-run this session (working tree unchanged, commit `78352b1`): `npm run test:node` 191/191, `npm run test:integration` 131/131
(real PostgreSQL 16 + Redis 7), Python 1070 OK, gateway `tsc` 3 errors (all `@types/node` missing in the sandbox, identical to
baseline), no tracked `.env`, no key/private-key patterns in tracked source. Docker: client present but no daemon and Docker Hub
unreachable -> `NOT_VERIFIED`. Expo web build: npm registry 403 -> `NOT_VERIFIED`.

## 2. What this phase changed (code, all tested)

| Area | Change | Proof |
|---|---|---|
| Browser-side AI (Step 10) | The mentor chat no longer calls Gemini (or a user-set "self-hosted" URL) from the browser; it gives labelled rule-based tips only. Keys stored by older builds (`shords.geminiKey`, `shords.aiSource`, `shords.serverUrl`, ...) are deleted at start-up. The TypeScript provider adapters refuse to run in a browser / React Native runtime. | `frontendAudit.test.js` (9): nothing reachable from `app/` mentions a provider host or key; the gateway is not reachable from the bundle; mutation-checked (re-adding a provider URL or an always-Pro return makes it fail). |
| Frontend API audit (Step 10) | Every research call in the app goes through the token-bearing client: `GET/POST /api/v1/projects` and `POST /api/v1/copilot/query`. The only other browser network calls are **public OpenAlex metadata searches** (`federatedSearch.ts`, `feedEngine.ts`: no key, no AI). | A test pins the set of files allowed to use the network. |
| Payments / privilege (Step 11) | `purchaseSubscription` used to submit a hard-coded fake transaction id and grant Pro. The client is now always `FREE`, nothing in device storage or the local profile is read as an entitlement, and there is no way to upgrade (no payment provider exists). Fabricated usage numbers were removed. The backend ignores any `isPro` / `premium` / `plan` / `paymentVerified` / `admin` claim in tokens, headers or bodies. | `frontendAudit.test.js`; `frontendAuth.integration.test.js` (claims buy no extra quota, no admin access). |
| Rate limiter (Step 8) | A shared IP (campus / office NAT) can no longer lock out real users: a **valid token is always accepted**; forged-token floods from an IP are still refused (429). Expired tokens and missing headers no longer count as guessing. Per-user, per-tenant and per-IP-global limits are unchanged. New opt-in `NETWORK_DIAGNOSTICS=true` shows hashed tags of the caller's own `X-Forwarded-For` chain so the hop count is measured, not guessed. | `api.integration` (2), `rateLimit.integration` (3 new: shared-IP users, hop handling, diagnostics). |
| Claude client (Step 13) | `stop_reason: model_context_window_exceeded` was treated as a finished answer; it is now incomplete output (never cached as complete). | `anthropicClient.test.js` (38). |
| Scripts (Steps 3-9, 14) | `scripts/verify_cloud.js`, `scripts/verify_retrieval_live.js` (rewritten: per-provider verdicts + two-paper isolation), `scripts/check_web_bundle.js`, `scripts/smoke_claude.js`. | Each is exercised against a real local runtime / fixture web (`cloudScripts.integration.test.js`, `liveScripts.test.js`), including their failure verdicts. |

## 3. Step-by-step status

| Step | Status | Detail |
|---|---|---|
| 1 Git | **BLOCKED** | Push refused; no force push, no history rewrite, working tree clean. Provide `shords-phase8.bundle`/`.patch` (delivered) or authorise the repo. |
| 2 Railway variables | **OWNER** | See section 4. Nothing was read or changed on Railway. Redis stays `redis://`. |
| 3 Firebase sign-in on Vercel | **OWNER** (after push + deploy) | Section 5, check 3. Client + backend are proven with locally signed tokens only. |
| 4 `/ready` | **OWNER** | `verify_cloud.js` reports database / redis / auth / aiProvider separately. A Google-keys failure is reported with the diagnosis, never weakened. |
| 5 Live retrieval | **OWNER** | `verify_retrieval_live.js`; here it exits 2 with every provider `NOT_VERIFIED`. |
| 6 One real paper | **OWNER** | Same script, `pipeline` lines: coverage, sections, chunks. No model call occurs. |
| 7 Paper isolation | **Logic verified here; real papers OWNER** | The script's `isolation` lines run the server's own hash / cache-key / evidence-validation code on the two real papers. |
| 8 Rate limiter / client IP | **Logic verified here; Railway hop count OWNER** | `verify_cloud.js` with `NETWORK_DIAGNOSTICS=true`. |
| 9 Production build | **OWNER** | Section 5, builds. `check_web_bundle.js` scans the output for secrets. |
| 10 Frontend API audit | **DONE** | Section 2. Not wired in the UI (no screen calls them): paper resolve, analysis jobs and job polling. Their routes and the real client are tested end to end; a screen for them is a feature, not a fix. |
| 11 Payment audit | **DONE** | Section 2. |
| 12 Token revocation | **DONE (documented)** | Section 6. |
| 13 Claude request construction | **DONE** | Section 7. |
| 14 Smoke test procedure | **DONE (script ready, not run)** | Section 8. |
| 15 READY FOR ANTHROPIC KEY | **NOT YET** | The checklist in section 9 is unticked where it needs you. |

## 4. Railway variables to read back (Step 2)

Send me (or check yourself) **names and non-secret values only** from Railway -> backend service -> Variables:

| Variable | Expected |
|---|---|
| `FIREBASE_PROJECT_ID` | the Firebase project id (equals `EXPO_PUBLIC_FIREBASE_PROJECT_ID` on Vercel) |
| `CORS_ORIGINS` | exactly the Vercel origin(s), e.g. `https://<site>.vercel.app`, no trailing slash, never `*` |
| `ADMIN_UIDS` | your Firebase uid(s), or empty |
| `TRUST_PROXY` / `TRUST_PROXY_HOPS` | `true` / measured by `verify_cloud.js` (start with 1) |
| `DATABASE_URL` / `REDIS_URL` | **as Railway supplies them** (Railway references). `redis://` stays `redis://` (private network or TCP proxy); do not add `rediss://`. Do not paste the values anywhere: only confirm the scheme and host (`*.railway.internal` is correct for the private network). |
| `CONTACT_EMAIL` | a monitored mailbox |
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | **not set yet** |
| `NETWORK_DIAGNOSTICS` | `true` only while running the hop check, then deleted |

## 5. Owner-run verification, in order

Set once (PowerShell shown; use `export` on bash):
```
$env:SHORDS_API_URL = "https://<railway-backend>"
$env:SHORDS_ORIGIN  = "https://<vercel-site>"
$env:CONTACT_EMAIL  = "you@example.org"
```
1. **Push**, let Vercel and Railway deploy the new commit.
2. **Infrastructure and auth plumbing** (no token needed): `node scripts/verify_cloud.js` - expect `ready.database`, `ready.redis`, `ready.auth` PASS, `ready.aiProvider` = `NOT_CONFIGURED` (PASS before the key), CORS PASS, 401s PASS. If `ready.auth` is `KEYS_UNAVAILABLE` the line names the Google endpoint Railway could not reach; fix egress, do not relax the check.
3. **Firebase on production**: open the Vercel site, sign in with email/password. In DevTools -> Network, `/api/v1/projects` must show `Authorization: Bearer ...` and **200**. Put that token (never into chat) in `$env:SHORDS_ID_TOKEN` and run `node scripts/verify_cloud.js` again: `auth.projects_with_token` PASS, `auth.token_not_echoed` PASS. In Railway logs search for `eyJ` and `Bearer`: there must be no match (the server never logs tokens; the request log carries a 10-hex hash of the uid).
4. **Client IP / hops**: set `NETWORK_DIAGNOSTICS=true` on Railway, redeploy, run `node scripts/verify_cloud.js --probe-rate-limit`. `proxy.hops` must PASS (otherwise it prints the `TRUST_PROXY_HOPS` to set) and `proxy.spoofed_prefix_ignored` must PASS. Then **delete** `NETWORK_DIAGNOSTICS`.
5. **Live retrieval + isolation** (from any machine with internet): `node scripts/verify_retrieval_live.js`. Every provider line should be PASS (arXiv HTML may say `htmlAvailable:false` for a paper without an HTML rendering), both `pipeline` lines should show coverage `FULL_TEXT` (or honestly `ABSTRACT_ONLY`), and all `isolation` lines PASS. Unreachable = NOT_VERIFIED, never PASS.
6. **Builds** (on your machine): `docker build -t shords-backend .` then run the container with real Railway-shaped variables and call `/health`; `npx expo export --platform web` (the Vercel build command) then `node scripts/check_web_bundle.js dist --public-firebase-key <EXPO_PUBLIC_FIREBASE_API_KEY>` (must print `PASS`: no provider key / host / connection string / server variable in the bundle). If `npm ci` fails, report the exact error; do not change dependencies to get past it.

## 6. Token verification and revocation (Step 12)

The backend verifies: **RS256 signature** against Google's published keys (by `kid`, cached with the response's max-age), **issuer** `https://securetoken.google.com/<project>`, **audience** = `FIREBASE_PROJECT_ID`, **expiry** (`exp`, 60 s clock skew), `iat` and `auth_time` not in the future, a non-empty `sub`, and optionally `email_verified` (`AUTH_REQUIRE_VERIFIED_EMAIL`, **off by default**: sign-up with an unverified address works). `alg: none` and HS256 key-confusion tokens are rejected.

It does **not** check revocation. A disabled or deleted user, or a user whose refresh tokens were revoked, keeps working until their ID token expires: Firebase ID tokens live **one hour**, so the window is at most about 61 minutes. Do not describe a revoked token as immediately invalid. If that window matters later, the standard fix is the Admin SDK's `verifyIdToken(token, true)` (a network call per check) or a short deny-list keyed by uid in Redis.

## 7. Claude request construction (Step 13), re-checked against the live docs today

| Item | Implementation | Source / test |
|---|---|---|
| Model | `claude-sonnet-5-5` (`ANTHROPIC_MODEL`; retired ids are ignored and flagged) | models overview + migration guide, 2026-10-04 |
| Price | $2 input / $10 output per million tokens (used only to estimate cost; `ANTHROPIC_PRICE_*` can override). One summariser read of the migration guide said $3/$15; the pricing page and models overview both say $2/$10, so $2/$10 is kept. **Compare the first reported cost with the Console invoice.** | pricing page |
| Body | exactly `model`, `max_tokens`, `messages` (last turn is the user's: no prefill), `system`, `output_config.effort`; no `temperature` / `top_p` / `top_k` / `thinking` / `tool_choice` / `tools` | `anthropicClient.test.js` |
| Effort | `output_config.effort` in `low | medium | high | xhigh | max`; QUICK=low, **STANDARD=high**, DEEP=xhigh | profiles test |
| `max_tokens` | 6000 / **16000** / 32000 (thinking counts toward it) | profiles test |
| Parsing | reads every `text` block; ignores `thinking` blocks (first and possibly empty); never assumes `content[0]` is text | tests 9, 34, 37 |
| Stop reasons | `refusal` -> REFUSAL; `max_tokens` and `model_context_window_exceeded` -> truncated (not cached as complete); no text + budget used -> TRUNCATED_NO_TEXT | tests |
| Usage | `input_tokens` + `output_tokens` from the provider; `null` if absent, never estimated | tests 10-12 |
| Timeouts | 60 s / **180 s** / 300 s by depth; a timeout is not retried (it would double spend) | test 31 |
| Retries | 429 / 5xx / network: 2 retries, honouring `retry-after` (capped at 10 s) with jitter; 4xx other than 429 never retried | tests 15-30 |
| Fallback | never silent: the result says `fallbackUsed`, `fallbackReason`, `provider: local_deterministic`, status `FALLBACK`, tokens `null`; `/ready` says `aiProvider: NOT_CONFIGURED` | tests, smoke script FAIL case |

## 8. Claude smoke test (Step 14) - run only after the key is set, by you

Precondition: section 9 boxes 1-9 ticked. You set `ANTHROPIC_API_KEY` in the Railway dashboard and redeploy; you paste nothing into chat.

```
node scripts/verify_cloud.js --expect-ai          # ready.aiProvider must be REACHABLE (a token-free probe of the model id)
$env:SMOKE_PAPER = "arxiv:2312.00752"             # or any open-access paper whose coverage was FULL_TEXT in step 5
node scripts/smoke_claude.js
```
It makes **one** paid call (STANDARD analysis of one paper through a job) and one free cache check, and prints: request id (and the provider's request id), job id, paper id, content hash, provider, model, effort, stop reason, input / output / total tokens, cost (`null` + `NOT_AVAILABLE` if the server has no verified price), latency (server and wall clock), cache status, fallback status, verification status, coverage, evidence count. It never prints the key, your token or paper text. It stops before any spend if the provider is not REACHABLE or the paper is not FULL_TEXT. Exit 0 only if all checks PASS.

Expected: provider `anthropic`, model `claude-sonnet-5-5`, `fallbackUsed:false`, `verificationStatus:UNVERIFIED` (**never VERIFIED**: no step proves entailment), cache `MISS`; then the repeat is `HIT` with `tokenSource: CACHE` and zero new spend. Afterwards, in Railway Postgres: `SELECT request_id, provider, model, ai_called, cache_hit, fallback, input_tokens, output_tokens, total_tokens, cost_usd, cost_status, duration_ms FROM ai_usage ORDER BY created_at DESC LIMIT 5;` - two rows, one real and one cache hit, no key and no token stored.

## 9. Gate checklist (all must be ticked before the key)

- [ ] 1 Phase 6-8 commits pushed and deployed (Vercel + Railway)
- [ ] 2 Firebase sign-in works on the production Vercel site
- [ ] 3 `/api/v1/projects` returns 200 with the Bearer token; no token in Railway logs
- [ ] 4 `/ready`: database OK, redis OK, auth OK (AI provider `NOT_CONFIGURED`)
- [ ] 5 Live retrieval: providers PASS, two real papers retrieved
- [ ] 6 Real-paper isolation lines all PASS
- [ ] 7 Rate limiter sees the real client IP (`proxy.hops` PASS, spoofed prefix ignored); `NETWORK_DIAGNOSTICS` removed
- [ ] 8 Docker build passes
- [ ] 9 Expo web build passes; `check_web_bundle.js` PASS
- [x] 10 Browser-side AI paths removed (this phase)
- [x] 11 Client privilege / payment claims cannot grant anything (this phase)
- [x] 12 Claude request construction verified (this phase, against the docs and tests)
- [x] 13 Cache isolation verified (Phase 7 integration tests; real-paper check is box 6)

## 10. Findings still open (unchanged, outside this phase)

1. Token revocation is not checked (section 6).
2. `AUTH_REQUIRE_VERIFIED_EMAIL` is off: anyone with any email can sign up and spend the per-user limits; decide before launch.
3. `federatedSearch` / `feedEngine` call OpenAlex straight from the browser (public data, no key) and `federatedSearch` first tries a `/api/v1/search` route that the Node backend does not have (it 404s, then falls back). `paperNormalizer.ts` still fabricates venue / publisher / `isPeerReviewed`; some search-result cards show placeholder authors, tags and counts.
4. No screen yet calls the paper-resolve, analysis-job or job-polling routes (the backend and client support them).
5. The old hard-coded credential remains in git history (it never authenticated against the server).
6. The Python backend (`backend/shords_server.py`) is a separate legacy server and is not on the Railway path.
