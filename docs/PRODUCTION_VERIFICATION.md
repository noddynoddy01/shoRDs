# Production verification: evidence matrix

Deployed commit: `40989e1` (GitHub `main`). Verified 2026-10-04 and 2026-10-05 against the live Vercel and Railway deployments.
**Final state: PRODUCTION VERIFIED, with the items in section 4 explicitly NOT VERIFIED.** Nothing in this document is claimed
unless it was run against the live deployment (or is marked "local tests").

## 1. Real Claude verification (2026-10-05)

Two different papers were analysed through the production API (`POST /api/v1/analysis`, depth `STANDARD`, one Idempotency-Key per run).
An earlier attempt, made while the Anthropic account had no credits, returned the labelled local fallback
`PROVIDER_INSUFFICIENT_CREDITS` and billed nothing; the runs below were made after credits were added.

| | Paper A, first run | Paper A, repeat | Paper B, first run |
|---|---|---|---|
| Paper | `arxiv:2312.00752` | same | `doi:10.1371/journal.pmed.0020124` |
| Provider / model | `anthropic` / `claude-sonnet-5-5` (effort `high`) | served from cache | `anthropic` / `claude-sonnet-5-5` |
| Real Anthropic call (not fallback) | **yes** (`aiCalled: true`, `fallbackUsed: false`) | no new call | **yes** (`aiCalled: true`, `fallbackUsed: false`) |
| Anthropic request id | `req_011CfiZRoA4sXWtqH13gzxfS` | same as first run | `req_011CfiZWoiSVMQX8rYHiTPAf` |
| Stop reason | `end_turn` | n/a | `end_turn` |
| Cache | MISS | **HIT** (references the first run's request id) | MISS |
| Tokens in / out | 28,783 / 4,704 (`REAL_PROVIDER`) | none (source `CACHE`) | 9,330 / 3,316 (`REAL_PROVIDER`) |
| Estimated cost | $0.104606 | **$0 additional** (`NO_NEW_SPEND`) | $0.05182 |
| Latency (server) | 25.8 s | 2 ms | 18.3 s |
| `verificationStatus` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |
| Coverage / chunks sent | `FULL_TEXT`, 95, none omitted | same | `FULL_TEXT`, 27 |
| Evidence | 38 items, all `arxiv:2312.00752_chunk_*` | 38 | 23 items, all `doi:10.1371/journal.pmed.0020124_chunk_*` |

- **Model:** `claude-sonnet-5-5`. Price used for the estimate: $2 / $10 per million input / output tokens.
- **Total demonstrated Claude usage: approximately $0.156** ($0.104606 + $0.05182 = $0.156426). The repeat added $0.
- Cost arithmetic checked independently: 28,783 x $2/M + 4,704 x $10/M = $0.104606; 9,330 x $2/M + 3,316 x $10/M = $0.05182.
- **Evidence isolation passed:** every evidence id on a result belongs to that result's own paper; no Paper A id appears on Paper B,
  there was no cross-paper cache hit, and the two papers have different content hashes.
- **Both fresh runs came from real Anthropic, not the fallback.**
- **Results stayed `UNVERIFIED`.** The system never reports `VERIFIED`, because nothing in the pipeline proves entailment of a claim
  by its evidence.
- The cost is a server-side **estimate** from provider-reported token counts. The Anthropic Console is the source of truth, and the
  comparison has not been done (section 4).

## 2. Release matrix

| Gate | Result | Evidence |
|---|---|---|
| GitHub `main` = `40989e1` | PASS | `git ls-remote` |
| Railway runs `40989e1` | PASS | active from `main`; Dockerfile build including `tsc --noEmit`; healthcheck passed |
| Vercel serves the new build | PASS | entry bundle with the Firebase web config embedded |
| `/health`, `/ready` | PASS | database OK (schema 2/2), redis OK, auth OK, aiProvider `REACHABLE` (`claude-sonnet-5-5`) |
| No header, fake bearer, garbage JWT, Basic scheme | PASS | all 401 |
| Real Firebase sign-in (Google) and valid token | PASS | RS256; `GET /api/v1/projects` 200 |
| Forged payload/admin claim, wrong aud/iss, expired claim, `alg:none`, truncated signature | PASS | all 401 `AUTH_INVALID_SIGNATURE` |
| `/api/v1/llm/health` | PASS | 401 without a token, 403 for a non-admin |
| CORS exact allowlist | PASS | allowed from the Vercel origin, blocked from another origin, no wildcard |
| Proxy / client IP | PASS | client at position 2 from the right; `TRUST_PROXY=true`, `TRUST_PROXY_HOPS=2` |
| Redis rate limiting | PASS | `AUTH_FAIL_IP` 20/60: 429 on request 21 |
| Shared-IP (NAT) invariant | PASS | a valid user still got 200 while the IP was being refused for bad tokens |
| Live scholarly providers | PASS | arXiv HTML, OpenAlex, Europe PMC |
| Two real papers isolated | PASS | different ids, hashes and evidence ids |
| Production bundle scan | PASS | no provider keys, provider hosts or DB URLs; the one Google key is the public Firebase web key |
| Payment / privilege | PASS | the client is FREE-only; the backend ignores plan/premium/admin claims (local integration tests) |
| Real Claude run, cache HIT, second paper | PASS | section 1 |

## 3. Notes on what a status means

- **`/ready` `aiProvider: REACHABLE`** means the provider endpoint answered a token-free `GET /v1/models/{model}` with the configured
  credential. It does **not** show that the account has credits. Billing and credit problems appear only on an actual request
  (for example `PROVIDER_INSUFFICIENT_CREDITS` on the labelled fallback). The probe was left unchanged on purpose.
- **`ADMIN_UIDS` is unset.** Setting it would let the listed Firebase uids call `GET /api/v1/llm/metrics` (aggregate request, token,
  cost and cache figures) and see the detailed `GET /api/v1/llm/health`. It is not needed for any user-facing feature, so it was not
  set. It would be needed to reconcile the server ledger with the Anthropic Console from the API (the same figures are also in the
  Postgres `ai_usage` table).

## 4. NOT VERIFIED (not tested live; do not describe as verified)

| Item | Why | What exists instead |
|---|---|---|
| A genuinely expired live token | needs a real token older than about 60 minutes used against production | local tests with signed tokens; the revocation limitation is documented in `PHASE8_CLOUD_VERIFICATION.md` section 6 |
| Forged `X-Forwarded-For` prefixes | browsers cannot send the header cross-origin | local tests (`rateLimit.integration`); the live hop count was measured |
| 240/min `READ_USER` limit, live | the limit could not be reached from the browser | the live 429 for `AUTH_FAIL_IP` and local rate-limit tests |
| Native Expo builds | not attempted (only the web build was deployed) | none |
| Server usage ledger vs Anthropic Console | `/api/v1/llm/metrics` is admin-only and `ADMIN_UIDS` is unset; the Console comparison has not been done | per-request rows in `ai_usage`; the totals in section 1 to compare with the Console |

## 5. Follow-ups

- Sidebar banner text corrected to "Research Analysis / Claude Sonnet 5.5" (it no longer says "PRO RESEARCH PASS" or "Claude 3.5 Sonnet").
  The banner still opens the subscription sheet, which still carries Pro wording and an upgrade button that does nothing (there is
  no payment provider). That screen was not changed.
- The `Production smoke test` project and its jobs are still in the owner's account. They are not read by any application feature
  and no test uses them. The API has no delete route, so removing them needs direct SQL; this has not been done. The `ai_usage`
  ledger rows do not depend on them.
- Duplicate failed or pending Vercel projects (`sho-r-ds`, `sho-r-ds-gp81`, `sho-r-ds-1`) can be removed.
- Optionally restrict the Firebase web API key by HTTP referrer.
- Railway runs on trial credit; check the remaining balance.
