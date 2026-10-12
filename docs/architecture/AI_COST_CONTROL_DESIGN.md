# AI cost control: audit and design

Status: design, 2026-10-06. **Nothing here is implemented.** It touches Claude calls, caching and rate limiting, which need explicit approval before any change (see the end). No paid call was made while writing this. Decision record: ADR-009. Ceilings below are arithmetic from the code's limits and the price table in the code (`claude-sonnet-5-5`, $2 per million input tokens, $10 per million output tokens). They are not measurements. The only measured cost is one real call: 28,783 input and 4,704 output tokens, $0.104606.

## 1. What exists today (verified in code)

| Control | State |
|---|---|
| Per-user and per-tenant request rate limits (Redis, fail closed) | Yes: copilot 20/min and 400/day per user, 120/min and 2000/day per tenant; analysis 10/min and 100/day per user, 60/min and 1000/day per tenant |
| Result cache with single-flight lock (120 s) | Yes, proven by `cacheIdentityAudit.test.js` |
| Idempotency key on analysis jobs | Yes (unique per user and key); **reuse with a different body is not rejected** (V-3) |
| Context size cap | Yes: `AI_MAX_CONTEXT_CHARS`, default 120000 characters |
| Output cap | Yes: `max_tokens` per analysis profile |
| Per-call timeout | Yes: 60 s, 180 s, 300 s by profile |
| Retries | `maxRetries` 2 in the SDK client, so up to 3 attempts, with no budget awareness |
| Cost recorded after the call | Yes, `ai_usage.cost_usd` (estimate; null when the model has no price entry) |
| **Spend ceiling (per user, project, day, global)** | **No** |
| **Pre-call cost estimate or reservation** | **No** |
| **Kill switch** | **No.** The only way to stop paid calls today is to remove the key or the provider credits |
| **Circuit breaker or provider cooldown** | **No** (a provider error category is recorded; nothing stops further calls) |
| **Global concurrency limit on provider calls** | Indirect only (`WORKER_CONCURRENCY` per replica; copilot requests are not queued) |
| **Spend alert** | **No** |

`LLM_*` variables in the compose file are not read by code, and `docs/ai/LLM_COST_CONTROL.md` describes caps that do not exist (a correction banner has been added to that file).

Maximum exposure today: request rate limits are the only brake. A single user could legitimately spend roughly 100 analyses x about $0.30 to $0.56 (per-attempt ceilings, below) = $30 to $56 a day on the analysis path plus 400 copilot calls, and a tenant 10 times that. Many accounts multiply it. There is no global ceiling. This is the real risk and the first thing to close with a provider-side limit (section 9, step 0).

## 2. Per-call maximum cost, computed before execution

For a call with model price `p_in`, `p_out` per token, input estimate `I`, output cap `O`:

`max_cost = I * p_in + O * p_out`

- `O` is known: it is the profile's `max_tokens` (QUICK 6000, STANDARD 16000, DEEP 32000).
- `I` is bounded by the context cap. Counting tokens exactly needs the provider's counter (a network call, itself possibly billed); use the conservative bound of **one token per character** of the assembled prompt (system prompt, evidence, question). With the 120000 character cap this is at most about 120k tokens, $0.24. Real prose is nearer 4 characters per token, so the bound is deliberately 3 to 4 times too high for reservation purposes. The ledger settles to the true figure after the call.
- Output ceilings at the stated price: QUICK $0.06, STANDARD $0.16, DEEP $0.32.
- **Per attempt ceiling**: about $0.30 (QUICK), $0.40 (STANDARD), $0.56 (DEEP).
- **Per request ceiling with retries**: attempts multiply it unless a failed attempt is known not to be billed. That is not guaranteed (a timeout after generation may be billed), so the reservation is `attempts x per-attempt ceiling` in the worst case, and the budget layer must release the unused part on settlement. Today up to 3 attempts, so up to about $0.90, $1.20, $1.68.
- **If cost cannot be bounded** (model absent from the price table, input not measurable, price unknown): `cost_status = UNKNOWN`. Policy: unknown-cost models are **denied by default** for automatic use and allowed only through an explicit per-model allowance with a manual daily cap. Unknown is never treated as zero, and spend totals report "N calls with unknown cost" next to the sum.
- A price table is data with a version and an effective date (see the gateway design). Prices change; the table carries `verified_on` and the monthly review compares the ledger with the provider invoice.

## 3. Budget model

Budgets are checked and **reserved before** the provider call and **settled after** it.

| Scope | Purpose | Initial values (to be set by the owner; these are proposals) |
|---|---|---|
| Global daily | hard stop for the company | `GLOBAL_DAILY_BUDGET_USD` = a number the owner is comfortable losing in one day |
| Global monthly | matches the provider monthly limit | set in the provider Console as the outer wall |
| Per model daily | stops an expensive model draining the budget | each enabled model has `daily_budget_usd` |
| Per tenant daily | one customer or abuser cannot take everyone's budget | for example 5% of global daily, raised per plan |
| Per user daily | single account abuse | for example $2 on free plans |
| Per project daily | runaway automation on one project | for example $1 |
| Per request | max cost computed in section 2 must be under `PER_REQUEST_MAX_USD` | a bit above the DEEP ceiling, so the cap rejects only misconfiguration |
| Concurrency | simultaneous provider calls | global semaphore plus per-user (1 to 2) and per-tenant caps |

**Reservation protocol** (Redis for speed, Postgres ledger as the truth):

1. Compute `max_cost`. Reject with `BUDGET_EXCEEDED` (a clear 429-class answer naming which budget) if any scope's `spent + reserved + max_cost` exceeds its limit.
2. Atomically (one Lua script, same pattern as the rate limiter) add `max_cost` to `reserved` in each scope, keyed by UTC day, with a TTL. Fail closed: if Redis is unavailable, paid calls are denied, and non-AI features keep working.
3. Call the provider (through the gateway).
4. Settle: add the true cost (or the ceiling when unknown, flagged) to `spent`, subtract the reservation. A crash between 2 and 4 leaves a reservation that expires with its TTL (a few minutes beyond the call timeout), so leaks self-heal and err on the safe side.
5. The Postgres `ai_usage` row remains the durable record. A nightly reconciliation rebuilds the Redis day counters from the ledger, so Redis loss cannot erase the day's spending (after a Redis restart, counters are rebuilt from Postgres before paid calls resume).

Cache hits cost nothing and do not reserve. A request that is served from cache or from a single-flight wait never consumes budget.

## 4. Threats and their controls

| Threat | Controls (existing in plain text; new in bold) |
|---|---|
| Infinite loop in our own code | per-request attempt cap; **global and per-user budget and the circuit breaker stop it within the budget even if the loop bypasses the rate limiter** |
| Client retry storm or double click | idempotency key (reject reuse with a different body, V-3); in-flight dedup by cache identity (single-flight) already; **per-user concurrency cap** |
| Duplicate jobs for the same paper | cache identity + single-flight; **dedup key on enqueue: one active job per (tenant, paper, analysis version)** |
| Malicious user (many accounts) | rate limits per user and tenant; **new-account lower budgets; global daily ceiling; budget per IP-hash prefix reviewed later; email verification as a prerequisite for paid AI** |
| Huge documents | context cap (exists); **reject at ingestion with a size limit per paper and per project; count paid analyses per paper per day** |
| Expensive model selection | model is chosen server-side from an allow-list by plan; client cannot name arbitrary models; **per-model daily budget** |
| Provider outage | **circuit breaker** (open after N consecutive provider-class failures in a window; half-open probes at low rate); **cooldown on 429 using the provider's retry-after**; local deterministic fallback, labelled and never cached as verified |
| Cache bypass | cache identity is server-side only; **a request cannot disable cache; "refresh" is a rate-limited, separately budgeted action** |
| Concurrent duplicate requests | single-flight lock (exists); **if the lock holder fails, waiters get the failure, they do not all retry** |
| Prompt-injection that induces very long output | output cap by profile (exists) |
| Retry amplification across layers (SDK retries x job attempts x client retries) | **one owner of retries: the gateway.** SDK retries to 0, job attempts counted in the same budget reservation, client retries governed by idempotency |
| Price table error (a real price higher than recorded) | monthly invoice comparison alert; provider-side hard limit as the outer wall |
| Concurrent budget races | reservation is atomic in Lua; Postgres reconciliation |

## 5. Kill switch (server-side, impossible for clients to override)

Goal: disable **all paid AI** immediately and without a deployment, while everything else (login, projects, paper retrieval, reading, cached results) keeps working.

Design:

- State lives in **server-side storage only**: a Redis key `ai:killswitch` (value `ALL` | `MODEL:<id>` | `TENANT:<id>` | `OFF`) read on every paid-call decision (one `GET`, already on a connection the request holds), with an environment variable `AI_ENABLED=false` as a second, restart-based switch that always wins (`AI_ENABLED=false` cannot be turned back on by Redis).
- Clients never send or receive any value that influences it. No request header, body field or query parameter is read. A regression test sends every plausible client signal (`X-AI-Enabled`, body flags, query flags, caller-controlled model names) and asserts that the switch still refuses.
- Fail-safe direction: if Redis cannot be read, paid calls are denied (the rate limiter already fails closed; the kill switch uses the same direction).
- Where it is checked: in the gateway, **before** the budget reservation and the provider call, and in the worker before it picks an AI job and again before each paid attempt (a job already running stops at the next attempt; cancellation uses the existing `cancel_requested`).
- Behaviour when engaged: cache hits still served (they cost nothing); uncached requests return a stable error `AI_TEMPORARILY_DISABLED` with HTTP 503 and `Retry-After`, plus the clearly labelled local deterministic fallback where the feature has one. Queued jobs wait in `QUEUED` (not failed) and resume when the switch is released, or are failed after a configured age. Nothing is marked `VERIFIED`.
- Who can engage it: an authenticated admin endpoint (`ADMIN_UIDS`, which the owner has not set, so setting it is a decision for the owner), or, with no code, the operator running one command against Redis or changing `AI_ENABLED` in Railway. The runbook documents both and the order: first the kill switch, then investigation.
- Every engagement and release writes an audit row (who, when, why, scope) and a `budget` telemetry event; the switch state appears in `/ready` as an informational field (not as a failure, so engaging it does not cause the platform to restart the service).
- Automatic engagement: the global daily budget exhausting, or the A8 spend alert crossing a hard ceiling, sets `ALL` itself and notifies the owner.

## 6. Circuit breakers and cooldowns

Per provider and per model, in Redis so all replicas agree: CLOSED, OPEN (reject paid calls to this target for a cooldown, 30 s growing to 5 min), HALF_OPEN (one probe at a time). Opens on 5 consecutive provider-class failures (`PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_5XX`) or any `PROVIDER_INSUFFICIENT_CREDITS` or `PROVIDER_INVALID_CREDENTIAL` (those open it for a long time and page the owner). Client errors from our own bad requests do not open it. A 429 sets a cooldown from the provider's retry-after instead of retrying immediately. With only one provider configured, an open breaker means the labelled local fallback or `AI_TEMPORARILY_DISABLED`; there is no provider to fail over to until a second adapter exists, and routing to a different model that could change meaning follows the fallback rules in the gateway design (never silent, always recorded).

## 7. Observe-only first

New limits are shipped in two steps to avoid breaking real users on a wrong guess:

1. **Observe mode** (`AI_BUDGET_MODE=observe`): compute reservations and would-be denials, write them to the ledger and telemetry, deny nothing. Run for one to two weeks.
2. **Enforce mode** (`enforce`): thresholds set from observed percentiles with margin; any denial is visible to the user with a clear message.

The kill switch and the provider-side hard limit are enforce-from-day-one.

## 8. Required tests (all offline with the model stub; no paid calls)

1. Cost ceiling function: known profiles produce the documented ceilings; unknown model gives `UNKNOWN`, never 0.
2. Reservation: reserve, settle, crash leaves expiring reservation, never double counts.
3. Concurrency: 100 parallel requests near the limit never exceed the budget by more than one request's ceiling.
4. Each scope denies independently (user, project, tenant, global, model).
5. Kill switch: engaged, an uncached request makes zero provider calls (counted by the stub); cache hits still work; client signals cannot disable it; Redis failure denies; `AI_ENABLED=false` beats Redis.
6. Duplicate and retry storm: 50 identical requests produce at most one provider call; reuse of an idempotency key with a different body is rejected.
7. Circuit breaker transitions and cooldown.
8. Oversized context rejected before reservation.
9. Rebuild of counters from the ledger after a simulated Redis flush.

## 9. Order of work

0. **Owner, no code, today**: set a monthly spend limit and an alert in the provider Console (the outer wall; whether the account's plan supports it was not verified). Decide the daily number you are willing to lose.
1. Add the missing ledger and telemetry fields (attempts, provider status) and the SQL spend alert (observability document, A8, A8b). Additive.
2. Observe-mode budgets and the unknown-cost deny rule.
3. Kill switch and the admin or runbook path, with tests (needs approval, touches Claude calls).
4. Enforce mode, per-user concurrency cap, dedup key on enqueue, V-3 idempotency body check.
5. Circuit breaker and cooldown; single retry owner; SDK retries to 0.

Each step is reversible by flag. Steps 3 to 5 need approval before implementation because they change Claude API calls, caching and rate limiting behaviour.

## 10. Honest limits

- Ceilings are computed, not measured, and assume the single price in the table; a price change invalidates them until the table is updated.
- Provider billing for failed or timed-out attempts is not verified; reservations assume the worst case.
- A kill switch that only the operator can reach is only as quick as the operator; the automatic global budget stop is what protects an unattended weekend.
- Redis counters are an optimisation; Postgres is the record, so a Redis failure fails closed rather than spending without a record.
