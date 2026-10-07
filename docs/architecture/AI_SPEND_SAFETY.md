# AI spend safety (P0.1)

Every paid Anthropic call goes through one gate, `backend/llm/aiBudget.js`, wired in `backend/runtime.js`. Postgres (`ai_usage`)
is the authoritative ledger; Redis is the fast coordinator (counters, reservations, kill switch, breaker). Nothing here
calls Claude: all behaviour is covered by tests that use a stub provider.

## What the gate does, in order
1. **Kill switch.** `AI_ENABLED` (env) or the Redis key `shords:ai:kill:v1`. Env `false` cannot be re-opened from Redis.
   An unrecognised `AI_ENABLED` value disables paid calls (fail closed). If Redis cannot be read the switch is treated as engaged.
2. **Price known?** A model with no known price is refused (fail closed): spend cannot be bounded for it.
3. **Per-request ceiling** (`AI_BUDGET_REQUEST_MAX_USD`) computed from the input bound and `max_tokens`.
4. **Circuit breaker**: after `AI_BREAKER_FAILURES` consecutive provider failures the provider is not called for `AI_BREAKER_COOLDOWN_SEC`
   (credential errors: `AI_BREAKER_CREDENTIAL_COOLDOWN_SEC`); one probe at a time recovers it.
5. **Duplicate lock**: an identical in-flight request is not paid twice.
6. **Reservation** (a concurrency-only refusal waits up to `AI_CONCURRENCY_WAIT_MS` for a slot; found when two workers for one user exceeded the per-user cap of 2 and a job finished with a fallback answer instead of waiting) against global, tenant, project and user daily budgets (UTC day) and concurrency caps, atomically in Redis (Lua).
   Day counters are seeded from the Postgres ledger, so a Redis flush or a new replica does not reset the day.
7. **Settle** with provider-reported usage, or **release** the reservation when no call was made / the call failed before the provider billed.
8. Provider retries are capped by `AI_MAX_PROVIDER_RETRIES` (default 1; was 2).

When the gate refuses, the request falls through to the existing labelled local fallback (`AI_POLICY_<CATEGORY>`); the user is never shown fabricated model output.

## Environment variables
Defaults below are **engineering placeholders chosen to be safe, not business decisions. The owner must review them before relying on them.**

| Variable | Default | Meaning |
|---|---|---|
| `AI_ENABLED` | enabled | `true/1/yes/on` or `false/0/no/off`; anything else disables |
| `AI_BUDGET_MODE` | `enforce` | `observe` records but does not block (use only to measure) |
| `AI_BUDGET_GLOBAL_DAILY_USD` | 25 | whole-service daily ceiling |
| `AI_BUDGET_TENANT_DAILY_USD` | 5 | per tenant per UTC day |
| `AI_BUDGET_PROJECT_DAILY_USD` | 2 | per project per UTC day |
| `AI_BUDGET_USER_DAILY_USD` | 2 | per user per UTC day |
| `AI_BUDGET_REQUEST_MAX_USD` | 1.25 | worst-case cost of one request |
| `AI_BUDGET_{GLOBAL,TENANT,PROJECT,USER}_DAILY_CALLS` | unset (no cap) | optional call-count caps |
| `AI_BUDGET_{GLOBAL,TENANT,USER,PROJECT}_MAX_CONCURRENT` | 16 / 6 / 2 / unset | concurrent paid calls |
| `AI_CONCURRENCY_WAIT_MS` | 10000 | how long a call waits for a free concurrency slot before it is refused (`0` = refuse at once). Budget and call-count refusals never wait |
| `AI_REQUEST_MAX_OUTPUT_TOKENS` | 32000 | upper bound used in the worst-case estimate |
| `AI_REQUEST_MAX_INPUT_TOKENS_BOUND` | 600000 | upper bound used in the worst-case estimate |
| `AI_MAX_PROVIDER_RETRIES` | 1 | integer 0-3 |
| `AI_BREAKER_FAILURES` / `AI_BREAKER_COOLDOWN_SEC` / `AI_BREAKER_CREDENTIAL_COOLDOWN_SEC` | 5 / 30 / 300 | breaker |
| `ADMIN_UIDS` | unset | comma-separated Firebase UIDs allowed to use the admin endpoints |

A malformed budget value makes the server refuse to start rather than silently run unbounded. A USD budget may be set to `unlimited` explicitly (not recommended).

## Kill switch runbook
- The admin endpoints are inert (403) until `ADMIN_UIDS` is set; that is an owner decision (see manual steps).
- **Env (needs a Railway variable change and redeploy/restart):** set `AI_ENABLED=false`.
- **Admin API (once `ADMIN_UIDS` is set):** `PUT /api/v1/admin/ai/kill-switch` with `{"engaged": true, "reason": "<why>"}`; release with `{"engaged": false}`.
  `GET /api/v1/admin/ai/budget` shows today's measured spend (or `null` when it could not be measured; never a guess).
- A request already past the gate finishes; new paid calls stop immediately on every replica (state is in Redis).

## Settlement policy and honest limits
- Settled cost is the provider-reported usage times the price table in the code. **The price table is a snapshot and must be reviewed against
  current Anthropic pricing by the owner.** An unknown model is refused rather than guessed.
- The gate bounds spend **at this service**. It is not a substitute for a spend limit configured in the Anthropic Console, which is the only
  control that protects against a leaked key or another client using the same key (manual step below).
- If Redis is down, paid calls are refused (fail closed); cached answers and the local fallback still work.
- Estimates are worst-case; settled spend is usually lower, so a day can end below the ceiling.

## Manual steps (cannot be done from the repository)
1. Set a **monthly spend limit and alert** in the Anthropic Console for the key used by Railway.
2. Decide `ADMIN_UIDS` (your Firebase UID) if you want the admin endpoints active.
3. Review and set the budget variables above in Railway; confirm the price table matches current pricing.
4. After deploy, confirm `GET /ready` is 200 and (admin) `GET /api/v1/admin/ai/budget` reports `dayUtc` and `globalSeeded: true`.

## Tests
`backend/tests/node/aiBudget.test.js` (pure), `aiBudget.integration.test.js` (real Postgres + Redis, stub provider), plus the
cache/jobs integration suites that run the gate end to end. No test calls Anthropic.
