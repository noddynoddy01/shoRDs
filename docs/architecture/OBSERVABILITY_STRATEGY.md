# Observability strategy

Status: design, 2026-10-06. Part A is verified against the code; Parts B and C are proposals. **Every signal is marked as COLLECTED TODAY or TO BE ADDED. No metric in this document is claimed to exist unless it is marked collected and has a named source.** Decision record: ADR-013.

## Principles

1. **Alert on what a human can act on.** Each alert names who does what within what time. Anything that does not is a dashboard panel, not an alert.
2. **Reuse data that already exists before adding tools.** The AI ledger and the job table already answer most reliability and cost questions with plain SQL.
3. **Every important request and job is traceable by id, never by content.** Ids and hashes yes; tokens, keys, prompts, answers, paper text and raw user identifiers never.
4. **Telemetry is a contract.** A fixed event schema (Part B) with an allow-list of fields, enforced by a test, so a careless log line cannot leak.
5. **Observe the system the way users and money experience it**: availability, correctness labels (`UNVERIFIED`, `FALLBACK`), latency, and spend.

## Part A. What is collected today (verified in code)

| Source | Content | Scope | Readable by |
|---|---|---|---|
| **Request log line** (`app.js`, one JSON line per request) | `t`, `evt:"http"`, `id` (request id), `route` (named route), `status`, `ms`, `rid` (replica id), `uid` (10 hex chars of SHA-256 of the user id, or null) | every request | platform logs (retention not verified) |
| **`ai_usage` ledger** (Postgres, one row per AI-path request including cache hits and requests that never reached the model) | `created_at`, `request_id` (the AI request id), `job_id`, `tenant_id`, `project_id`, `user_hash` (16 hex, unsalted), `paper_id`, `mode`, `coverage`, `provider`, `model`, `ai_called`, `cache_hit`, `fallback`, `fallback_reason`, `input_tokens`, `output_tokens`, `total_tokens`, `cost_usd` (estimate; null if no verified price), `cost_status`, `duration_ms`, `replica_id`, `outcome` | all replicas, durable | SQL |
| **`analysis_jobs` table** | status, `attempts`, `error_code`, `created_at`, `started_at`, `finished_at`, `lease_expires_at`, `worker_id`, `cancel_requested`, replicas | durable | SQL (queue wait = `started_at - created_at`; processing time = `finished_at - started_at`; backlog = count of `QUEUED`) |
| **`/ready`** | database, Redis, auth keys, AI provider reachability (not billing), schema version vs expected, worker state | one replica per call | public HTTP |
| **`/health`** | liveness only | one replica | public HTTP |
| **LLM telemetry** (`telemetry.snapshot()`) | counts of real, fallback and cache-served answers; fallback reasons; provider error categories; tokens and estimated cost; cache hits, misses, stores, dedup waits, errors; last success and last error | **per replica, in memory, reset on restart** | `/api/v1/llm/metrics`, admin only (`ADMIN_UIDS` is unset in production, so nobody can read it) |
| **Free-text warnings and errors** | for example `[AIGateway] Anthropic call failed (category=..., http=..., attempts=..., providerRequestId=...)`, `[Usage] could not write ai_usage row`, `[Papers] extraction failed ...` | per replica | platform logs |

The log line carries no token, email, prompt, answer or paper text. This is now enforced by `backend/tests/node/logSafety.integration.test.js`, which drives the real handler with logging on and fails if a bearer token, the model key, question text, project name, raw user id, email or paper text appears in any log level (a mutation check confirmed it detects a leaked raw uid).

**Not collected today** (so nothing below may depend on it until added): latency percentiles (they can be computed offline from log lines, nothing aggregates them), event-loop lag, CPU and memory, database pool use, Redis latency or memory, queue depth as a time series, paper-retrieval timings and provider HTTP statuses, cache errors cluster-wide, provider response status codes as data (only a category and, in a free-text warning, the HTTP status), retry count of provider calls in the ledger, the link between the HTTP request id and the AI request id, error tracking for the backend or the web client, any uptime monitor, any alert.

## Part B. Telemetry schema (TO BE ADDED, additive, no behaviour change)

One JSON line per event, schema version `v: 1`, emitted through a single `emit(event)` function that **accepts only the allow-listed fields below** (an unknown field is dropped and counted; a test fails the build if a new field is added without a schema change and a privacy note).

Common fields on every event: `t`, `v`, `evt`, `level`, `svc` (`api`|`worker`), `env`, `rid` (replica), `req` (request id; accepted from a validated `X-Request-Id` or generated; returned in the response; the **same id** is written to the ledger and job rows so one id follows a request through all stores).

| Requirement | Field | Event(s) | Source today |
|---|---|---|---|
| request ID | `req` | all | log line has `id`; ledger has a different id: **link needed** |
| user context | `user` = HMAC-SHA-256(server secret, uid) truncated, never the uid; `tenant` (hashed) | http, ai.call, job.* | log: yes (unkeyed hash); ledger: yes (unkeyed hash) |
| project context | `project` (opaque id, not the name) | ai.call, job.* | ledger: yes |
| job ID | `job` | job.*, ai.call | ledger and table: yes |
| paper ID | `paper` (a public identifier such as `doi:...`; titles and text never) | paper.retrieve, ai.call, job.* | ledger: yes |
| provider | `provider` | ai.call | ledger: yes |
| model | `model_requested`, `model_served` | ai.call | ledger: one `model` field |
| latency | `ms` (total), `ms_provider`, `ms_queue`, `ms_process` | http, ai.call, job.finish | `ms` for http: yes; `duration_ms` for AI: yes; others derivable from job timestamps |
| cache hit/miss | `cache` = `HIT`\|`MISS`\|`DEDUP`\|`BYPASS`\|`ERROR` | ai.call | ledger `cache_hit`: partial (no BYPASS/ERROR) |
| queue latency | `ms_queue` | job.start | derivable from `analysis_jobs` |
| processing latency | `ms_process` | job.finish | derivable |
| token usage | `tok_in`, `tok_out`, `tok_reasoning`, `tok_source` | ai.call | ledger: in/out only |
| cost | `cost_micro_usd`, `cost_status` (`COMPUTED`\|`UNKNOWN`\|`NONE`), `price_table` | ai.call | ledger: `cost_usd` float + status |
| error category | `err` (normalised category from the gateway design) | http (5xx/4xx), ai.call, job.fail, paper.retrieve | ledger `outcome`/`fallback_reason` |
| retry count | `attempt`, `attempts` | ai.call, job.* | `analysis_jobs.attempts`: job level only; provider attempts not stored |
| fallback | `fallback` (`NONE`\|`SAME`\|`DIFFERENT`\|`LOCAL`), `fallback_reason` | ai.call | ledger: boolean + reason |
| provider response status | `provider_status` (HTTP status or null), `provider_req` (the provider's request id) | ai.call, paper.retrieve | free-text warning only |

Event types: `http`, `ai.call`, `job.enqueue`, `job.start`, `job.finish`, `job.fail`, `job.requeue`, `paper.retrieve` (`provider`, `ms`, `provider_status`, `coverage`, `bytes`), `cache.error`, `provider.circuit` (open/close), `budget` (reserve/settle/deny/kill-switch), `auth.fail` (category only: `NO_TOKEN`, `BAD_SIGNATURE`, `EXPIRED`, `WRONG_AUDIENCE`; never the token), `ratelimit.hit` (policy name, scope; hashed subject), `migration`, `shutdown`.

**Never logged, enforced by schema and test**: Authorization headers and tokens, API keys, passwords, cookies, request or response bodies, question text, answer text, evidence or paper text, titles and abstracts, project and tenant names, email addresses, raw user ids, IP addresses (a keyed hash of the IP may be added for abuse analysis after a privacy review), stack traces from provider responses.

Request tracing: `req` is returned as `X-Request-Id` on every response (the CORS configuration must expose it), written to every event of that request, to the ledger row and to the job row. Jobs: `job` is the trace root (`job.enqueue` -> `job.start` -> `ai.call` -> `job.finish`, retries share the job id and increment `attempt`). OpenTelemetry distributed tracing is deferred until there is more than one service (ADR-013); until then an id on every event gives the same debugging power at no cost.

## Part C. Signals and alerts

Severity: **PAGE** = a human is interrupted now (small team: one person; budget at most 2 pages a week before the thresholds are retuned); **TICKET** = fix within a working day; **DASH** = panel only.

"Source" says whether the signal can be built from data collected today. Thresholds are starting points based on stated reasoning and must be tuned after two weeks of real data; none was measured.

| # | Signal | Source today? | Threshold (start) | Severity | Action |
|---|---|---|---|---|---|
| A1 | Service not ready | **Yes**: external monitor on `/ready` (new tool, existing endpoint) | non-200 for 3 consecutive checks at 1 min | PAGE | open runbook "service down": check Railway deploy, dependency named in the `/ready` body |
| A2 | Elevated 5xx | Needs log aggregation of the existing `http` line | 5xx share above 2% over 10 min and at least 50 requests | PAGE | find the failing `route` and `err`; roll back if a deploy preceded it |
| A3 | AI provider failing | **Yes**: SQL on `ai_usage` | fallback rows with `fallback_reason LIKE 'PROVIDER_%'` above 30% of AI attempts in 15 min, at least 10 attempts | PAGE | check provider status page, credits, key; consider kill switch |
| A3b | Credits exhausted or key invalid | **Yes**: SQL (`fallback_reason IN ('PROVIDER_INSUFFICIENT_CREDITS','PROVIDER_INVALID_CREDENTIAL')`) | one row | PAGE | add credits / fix key (owner action); every user is currently getting fallbacks |
| A4 | Queue backlog | **Yes**: SQL on `analysis_jobs` | oldest `QUEUED` job older than 5 min, or more than 50 queued | PAGE if provider is healthy, else TICKET | check workers alive (`/ready` worker block), Redis, concurrency |
| A4b | Jobs failing | **Yes**: SQL | FAILED above 10% of jobs finished in 30 min, at least 10 jobs | TICKET | group by `error_code` |
| A4c | Stuck jobs | **Yes**: SQL (`PROCESSING` with expired lease for more than 3 min) | any | TICKET | reaper should requeue; investigate if repeated |
| A5 | Redis failure | **Yes** via `/ready` (Redis check) | covered by A1; plus `cache.error` count above 0 for 5 min once the event exists | PAGE (A1) / TICKET | rate limiting fails closed so users see 503: restart or replace Redis |
| A6 | Database failure | **Yes** via `/ready` | covered by A1 | PAGE | see disaster scenarios in the data durability document |
| A7 | Cache failure or ineffective | Partly: hit ratio from `ai_usage.cache_hit` | cache hit share falls to under half of its 7-day median, with the same traffic | DASH, TICKET if sustained 24 h | check key changes (prompt version bumps), Redis eviction |
| A8 | Unusual AI spend | **Yes**: SQL on `cost_usd` | last hour above 3x the same hour's 7-day median, or day total above 80% of the daily budget once a budget exists | PAGE | find top `tenant_id`/`user_hash`; consider kill switch or block |
| A8b | Spend not measured | **Yes**: SQL (`ai_called` with `cost_usd IS NULL`) | any | TICKET | a model without a price table entry is being used: spend is invisible |
| A9 | Authentication failures | Needs log aggregation (`status 401` by route) or the `auth.fail` event | 401 count above 10x the 7-day median over 10 min, with at least 100 | TICKET | usually a client bug or a scan; PAGE only if combined with A2 |
| A10 | Rate-limit abuse | Log aggregation (`429`) or `ratelimit.hit` | one hashed subject above 50 hits in 10 min, or 429s above 5% of requests | TICKET | decide whether to block; check for a retry loop in the client |
| A11 | Slow paper retrieval | **No**: needs `paper.retrieve` | p95 above 20 s over 30 min, at least 10 retrievals | TICKET | provider slowness or parser stall |
| A12 | Ledger write failures | Log aggregation of `[Usage] could not write` | any 3 in 10 min | TICKET | spend is going unrecorded |
| A13 | Ledger vs invoice drift | Manual weekly: compare `sum(cost_usd)` with the Anthropic Console | differs by more than 5% | TICKET | wrong price table, unrecorded calls, retries |
| A14 | Backup freshness / restore test | External (new) | newest backup older than the RPO, or the monthly restore test failed | PAGE / TICKET | see data durability |
| A15 | Pending migration | `/ready` schema block | schema not at expected for 5 min after deploy | PAGE | stop rollout; migration runner |
| A16 | Certificate or domain expiry | External | 21 days | TICKET | renew |

Hygiene rules: every alert has an owner and a runbook link (even if the runbook is five lines); an alert that fires without needing action is changed or deleted at the next review; a **dead-man switch** pages if the alert checker itself has not run for 15 minutes; alerts are reviewed monthly; no alert is created for a metric that does not exist.

## Part D. First implementation order (all additive, none changes behaviour)

1. **Zero code**: an uptime monitor on `/ready` with phone alerts (A1, A15); the Anthropic Console spend limit and alert; set `ADMIN_UIDS` only if the owner decides to (ask first).
2. **SQL checks** (A3, A3b, A4, A4b, A4c, A8, A8b): a small scheduled job (a GitHub Actions cron or a Railway cron service; either costs little; availability and cost not verified) runs read-only queries against the database and sends an alert to e-mail or chat. Uses existing tables only.
3. **Error tracking** for backend and web (an off-the-shelf service with a free tier; not verified) configured to strip request bodies and headers.
4. **Event schema and `emit()`** (Part B), the request-id link, and the missing fields (provider attempts, provider status, `paper.retrieve`, `cache.error`). Add event-loop lag, process memory and pool counts as periodic `runtime` events.
5. **Log aggregation** (a drain to a log service with search; retention and pricing not verified) to enable A2, A9, A10, A12 and latency percentiles.
6. Cluster-wide metrics endpoint for admin (sum of the ledger and the periodic events) replacing the per-replica in-memory snapshot as the source of truth.

Success criteria: time to detect an outage under 5 minutes; time to find the failing component under 10 minutes using only ids; every page was actionable in the monthly review; ledger and invoice agree within 5%.

## Part E. Service level objectives (proposed, not measured)

| SLO | Target | Measured by |
|---|---|---|
| API availability (`/ready` OK) | 99.5% monthly (about 3.6 h of downtime) | external monitor |
| Analysis job completes (any non-failed status) within 5 minutes of enqueue, when the provider is up | 95% | `analysis_jobs` timestamps |
| Interactive request success (non-5xx) | 99% | logs |
| Spend within budget | 100% of days | ledger |

Error budget policy: when the monthly availability budget is spent, new feature releases pause until the cause of the burn is fixed. These numbers are a starting contract with yourself; change them with evidence.

## Part F. Dashboards (after Part D steps 2 to 5)

1. **Health**: `/ready` status, request rate, 5xx share, latency percentiles, queue depth and oldest age, restarts.
2. **AI**: calls, cache hit share, fallback share by reason, estimated cost per day and per tenant (top 10), tokens, p95 `duration_ms`, models in use, calls with unknown cost.
3. **Data**: database size, connections used versus limit, slowest queries, backup age, last restore-test time.

## Part G. Privacy and retention of telemetry

Telemetry follows the same data classes as the rest of the system (data durability document, section 3): log retention 14 to 30 days (platform dependent, to be set), ledger 13 months then rollups, error-tracker events scrubbed of bodies and headers, no telemetry vendor receives content. A vendor that cannot meet these gets no data.
