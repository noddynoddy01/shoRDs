# shoRDs long-term architecture: hundreds of users to 1M+

Status: proposal for owner review, 2026-10-06. Nothing in this document is implemented. Decisions are recorded as ADRs in [`adr/`](adr/README.md).
Evidence base: the code at commit `800cd96`, the production verification of 2026-10-05, and the audits in this folder.

## 1. Principles that decide every choice below

1. **One deployable, one database, until a measured trigger says otherwise.** Every extra moving part costs operations time that a small team does not have.
2. **Postgres is the system of record. Redis is an accelerator that may be lost.** Anything that must survive a Redis flush lives in Postgres.
3. **AI spend, not request volume, is the first scaling limit.** Observed real cost is $0.05 to $0.10 per analysis (28,783 input and 4,704 output tokens cost $0.104606; section 4). At 10K users the AI bill, not the server bill, is the number that decides whether the company survives.
4. **Reversible beats optimal.** Each evolution below is behind an interface that exists today or is added first, and has a stated way back.
5. **No capacity claim without a measurement.** There is no load test in the repository. Numbers in sections 3 and 4 are *modelled* from stated assumptions and from the measured per-call figures, and are marked as such. The first scaling task is to measure (roadmap Phase 7).

## 2. What exists today (the baseline all triggers are measured against)

One Node process per replica (API and in-process job worker), `PG_POOL_MAX` 8 connections per replica, worker concurrency 2 per replica, 120 s job lease. Railway Postgres 16 and Redis 7, one instance each. Vercel serves the Expo web build. Claude Sonnet 5.5 is the only AI provider. Scholarly sources: arXiv, OpenAlex, Europe PMC, reached through one shared budget of 240 provider calls per minute (`RETRIEVAL_PROVIDERS`). No object storage (only extracted text is stored). No search engine (search goes browser-to-OpenAlex). Tests: 219 unit and 146 integration passing, 8 documented `todo` gaps (this audit).

Not measured today: request latency percentiles, event-loop lag, Postgres connection use, Redis memory, queue wait time, container size. These are Phase 4 items; until they exist most triggers below cannot fire automatically.

## 3. Load model (assumptions, not measurements)

These assumptions exist so that triggers can be expressed in numbers. Replace them with real data as soon as there is any.

| Assumption | Value | Why |
|---|---|---|
| Daily active users | 15% of registered users | typical for a niche professional tool; unverified for shoRDs |
| AI analyses or questions per active user per day | 3 | one reading session |
| Peak to average ratio | 10x | work-hours clustering |
| Average AI call duration | 20 s | measured: 25.8 s and 18.3 s |
| Average cost per uncached call | $0.08 | measured: $0.1046 and $0.0518 |
| Share of calls served from cache or deduplicated | 0% / 30% / 50% | 0% is today's behaviour; the others need the shared paper-level cache of ADR-007 |

Little's law gives the number of AI calls in flight: concurrency = peak arrival rate x duration.

| Registered users | Active/day | AI calls/day | Peak calls/s | Calls in flight at peak | Uncached AI cost per day | Per month |
|---|---|---|---|---|---|---|
| 10,000 | 1,500 | 4,500 | 0.5 | ~10 | ~$360 | ~$10.8K |
| 100,000 | 15,000 | 45,000 | 5 | ~100 | ~$3,600 | ~$108K |
| 1,000,000 | 150,000 | 450,000 | 50 | ~1,000 | ~$36,000 | ~$1.08M |

Reading the table: at every stage the AI bill is far larger than any infrastructure bill, so **cost control and per-user economics (Phase 6, 9) must be solved before infrastructure is scaled.** A free tier with unmetered analyses is not viable beyond a few hundred users at these prices. The largest lever is sharing public-paper results across tenants (ADR-007): thousands of users analyse the same popular papers, and an analysis of a public paper contains no private data. With a 50% shared hit rate the 1M row falls to about $18K/day; the real rate is unknown until measured.

## 4. Evolution plan by component

Each cell states the *shape* at that stage. The **trigger** column is the measurable condition that justifies moving to the next shape. "Signal exists today" says whether shoRDs can already observe that trigger.

### 4.1 API and compute

| Stage | Shape | Trigger to move on | Signal exists today? |
|---|---|---|---|
| Today to ~10K | Modular monolith: API and worker in one process, 1 to 2 replicas on Railway. | Any of: event-loop lag p95 above 100 ms for 10 minutes; CPU above 60% sustained; a hostile or slow document stalls other requests; deploys interrupt in-flight jobs (ADR-003). | No (add event-loop lag and CPU). |
| ~10K to ~100K | **Separate worker service** (same codebase, `WORKER_ENABLED=true` only on the worker, `false` on API). API replicas 2 to 4, workers scale on queue depth. | Queue wait p95 above 60 s while API latency is fine; or AI call concurrency needs to scale independently of API replicas; or PDF/HTML parsing must be isolated from request handling. | Partly (job timestamps exist in `analysis_jobs`; no metric). |
| ~100K to ~1M | Several worker pools by job class (fast: retrieval and parsing; slow: model calls), API behind the platform load balancer, still one codebase. Consider a managed container platform only if Railway cannot give autoscaling or the reliability needed. | Railway limits reached (replica count, regional placement, SLA), or a reliability objective the platform cannot meet. | No. |

Not recommended at any stage listed here: Kubernetes, a service mesh, microservices per domain. A service is split out only when it has a different scaling shape, a different failure domain, or a different team (Section 7).

### 4.2 Database

| Stage | Shape | Trigger | Notes |
|---|---|---|---|
| Today to ~10K | One managed Postgres, verified backups with point-in-time recovery (ADR-012), 2 replicas x 8 connections. | Connections in use above 60% of `max_connections`; or p95 query time above 100 ms; or storage growth above 70% of plan in 60 days. | Verify the plan's `max_connections` (unknown today). |
| ~10K to ~100K | Same primary, **connection pooler** (PgBouncer in transaction mode) between app and DB; larger instance; `ai_usage` rolled up and old rows archived; indexes reviewed from `pg_stat_statements`. | Replicas x pool size exceeds 60% of `max_connections`; CPU above 60% sustained; vacuum or bloat problems. | The client uses unnamed statements, so transaction pooling is compatible. Migrations use a session advisory lock and must connect directly, not through the pooler. |
| ~100K to ~1M | **One streaming read replica** for read-heavy endpoints (project lists, job polling, dashboards) with an explicit "may be a few seconds stale" contract; time partitioning of `ai_usage` and `analysis_jobs` by month; heavy analytics moved off the primary. | Read load above 50% of primary CPU, or reporting queries affect interactive latency. | Replica lag must be a metric before any read is routed to it. |
| Beyond | Tenant-aware sharding or a second database engine only if one primary cannot hold the write load. | Sustained primary write saturation after the steps above. | Not expected before several million users. |

Jobs are claimed with conditional updates on Postgres rows today. At about 50 claims per second a `FOR UPDATE SKIP LOCKED` claim query is the next optimisation (ADR-003); it does not need a new system.

### 4.3 Redis

| Stage | Shape | Trigger |
|---|---|---|
| Today to ~10K | One instance; separate logical roles in code (rate limit, cache, locks, queue wake-up) with separate connections (audit P1-5); a volatile eviction policy; Redis loss is survivable by design. | Memory above 70%; command latency p99 above 20 ms; evictions of rate-limit or lock keys. |
| ~10K to ~100K | Two instances: one for **rate limiting and locks** (must not be evicted, small), one for **cache** (may evict). | Evictions in the cache instance start hurting rate-limit or lock keys, or an outage of the cache must not stop rate limiting. |
| ~100K and up | Managed Redis with replication and automatic failover; clustering only if a single node's memory or throughput is exceeded. | Node memory or ops/s limit; failover time unacceptable. |

Rate limiting that fails closed on Redis loss is a deliberate safety choice today (it protects spend). At larger scale it needs a local degraded mode (per-process token bucket with a conservative limit) so a Redis blip does not become a total outage. That is a design item in Phase 7, not a today item.

### 4.4 Queue and background processing

| Stage | Shape | Trigger |
|---|---|---|
| Today to ~100K | Postgres table is the queue, Redis list is only a wake-up, in-process worker. Keep. | Queue wait p95 above 60 s with workers idle-limited; claim query shows up in `pg_stat_statements`; jobs per second above ~50. |
| ~100K to ~1M | Same table, `SKIP LOCKED` claim, priority and per-tenant fairness columns, separate worker pools per job class, dead-letter state, `run_after` backoff. | Fairness incidents (one tenant starves others), or multi-class jobs need different concurrency. |
| Only if proven necessary | A managed queue (for example SQS) or a workflow engine (for example Temporal) | Multi-step workflows with long waits and human steps, or a measured Postgres queue ceiling after all optimisations. Not Kafka: there is no event-streaming requirement. |

Asynchronous workflow rule: every long operation is a **job with an id, a state machine, and an idempotent handler**; HTTP returns `202` and a poll URL; the UI polls (server-sent events later if polling cost matters). Today only `POST /analysis` follows this; the synchronous copilot path holds an HTTP request open for up to 180 to 300 s and should move to it (audit P1-14).

### 4.4a Consistency model

- Writes go to the primary and are strongly consistent. Reads of own writes (create project then list) must use the primary.
- A read replica (stage 3 only) serves dashboards and lists with documented staleness; job status polling after creation reads the primary for the first N seconds.
- The cache is **eventually consistent by design** and always safe to lose. Cache keys include every input that changes the answer (proved by `cacheIdentityAudit.test.js`, `AI_SUBSYSTEM_AUDIT.md`), so staleness means "an older but correct answer for the same inputs", never "an answer to different inputs".
- Provider data (papers) is eventually consistent with the provider: `papers.retrieved_at` and a refresh policy; a transient provider error never downgrades stored content (audit P1-11).
- Cross-region (stage 3) replication is asynchronous; see 4.9.

### 4.5 Connection pooling

Pool today: 8 per replica, acquire timeout 5 s, query timeout 10 s, client-side only (audit P1-13 adds server-side timeouts). Rule of thumb for the trigger: `replicas x PG_POOL_MAX + workers x pool` must stay below 60% of the database's `max_connections`. Introduce a pooler (4.2) when that is crossed, not before. Redis connections: one per role per replica plus one blocking connection per worker loop; no pooler needed.

### 4.6 File and document storage

Today shoRDs stores **extracted text and metadata only** (`papers`, `paper_chunks`), never the PDF or HTML bytes. That keeps storage small and avoids hosting copyrighted files. Keep this until one of these happens, then add S3-compatible object storage (Cloudflare R2, AWS S3 or Backblaze B2: all speak the S3 API, so the choice is reversible; prices not verified):

- users can **upload** their own PDFs (the upload screen is currently a stub; see audit P0-2), or
- reproducibility requires keeping the **exact source bytes** a result was computed from (ADR-006: an immutable content store), or
- the licence policy requires showing a user the original figure.

Design when needed: bucket per environment, keys `sha256/<hash>` (content addressed, so duplicates cost nothing), private only, short-lived signed URLs, virus and size limits at upload, parsing in an isolated worker, lifecycle rule to expire unreferenced objects, and per-tenant encryption keys only if an enterprise customer requires them.

Postgres size guidance: `paper_chunks.text` is the largest table. A 95-chunk paper is roughly 120 KB of text. One million distinct papers is on the order of 100 GB (modelled). That fits one Postgres comfortably; plan a move of chunk text to object storage only if the table passes ~500 GB or backup times exceed the recovery objective.

### 4.7 Search

Today search is browser to OpenAlex, with no server involvement. Evolution:

1. **Now**: keep. It costs nothing and has no operational burden. Fix the dead `/api/v1/search` path.
2. When shoRDs needs search across **its own corpus** (projects, saved papers, extracted text, annotations): Postgres full-text search (`tsvector` + GIN, `pg_trgm` for typo tolerance). Trigger: users ask to search their own library.
3. A dedicated engine (OpenSearch, Typesense, Meilisearch) only when Postgres search latency p95 exceeds 300 ms on a real index, or semantic/vector search becomes a product requirement. `pgvector` comes before a separate vector database. Reason: one database to back up, secure and migrate.

### 4.8 Scholarly provider limits

The shared budget today is 240 provider calls per minute across everyone, counted per paper though a paper uses 2 to 4 HTTP calls, with no per-host limit and no `Retry-After` handling (audit P1-11). Provider terms vary and **were not verified in this pass**; treat the following as design, not as quoted terms:

- Count and throttle **per host** (token bucket), honour `Retry-After`, back off exponentially, and open a circuit breaker per provider so one failing source does not stall retrieval.
- Identify the service (contact email in the User-Agent, required in production).
- Cache aggressively: papers are public and slow-changing; a paper is fetched once per refresh window for all tenants (already true: one canonical row per paper).
- At scale: apply for higher-rate access where providers offer it (for example OpenAlex API keys or premium plans, Europe PMC bulk downloads, arXiv bulk data), and prefer **bulk datasets** over per-request calls for popular content. Trigger: provider budget at 60% sustained, or any provider throttling shoRDs.
- Licence policy before scale: record and enforce what may be stored, shown and sent to an AI provider (ADR-018).

### 4.9 AI provider throughput

Provider limits (requests, tokens per minute, concurrency) depend on the account tier and **are not known from the repository**; they must be read from the Anthropic Console. Design for them instead of assuming them:

- A **global concurrency limiter and token-per-minute budget** in front of the gateway (ADR-009), sized from the console limits, with queueing instead of failing.
- Backpressure: when the limiter is full, jobs wait in the queue; interactive requests get a clear "busy, retry" or are converted to jobs.
- **Multiple providers** behind the normalised gateway (ADR-005) to survive outages and to spread rate limits, with the no-silent-meaning-change rule (ADR-008).
- Request a higher tier and committed-spend discounts when monthly spend justifies the conversation (verify availability with the vendor).
- Batch or deferred processing for non-interactive work (for example bulk library import) at lower priority, using the provider's batch interface if one exists (not verified here).

### 4.10 Caching

| Layer | Today | Evolution |
|---|---|---|
| Model result cache | Redis, 24 h, key includes tenant and project | Add a **shared, paper-level cache of structured analyses** in Postgres (durable) keyed by content and analysis identity, tenant-independent for public papers (ADR-007). User questions stay tenant-scoped. |
| Paper store | Postgres, one canonical row per paper | Add refresh policy and stale-if-error. |
| HTTP/CDN | none for the API; Vercel for static assets | Immutable caching for hashed assets; never cache authenticated API responses at the CDN. |
| Provider responses | none | Optional short-lived cache per URL to survive provider blips. |

### 4.11 CDN and web delivery

Vercel already provides a CDN for the web build. Needed: long-lived immutable cache headers for hashed assets, correct 404 for missing assets (today every path rewrites to `index.html`, so a stale tab can receive HTML for a script URL), security headers, and a version-skew prompt (audit P1-14, P2-12). A CDN or WAF in front of the **API** is a trigger-based addition: add it when there is a measured abuse pattern the application cannot absorb, or when DDoS protection is a customer requirement. If added, `TRUST_PROXY_HOPS` must be re-measured (the production value 2 was measured for the current chain).

### 4.12 Multi-region

Single region until a trigger fires. Today the DB, Redis, API, and worker are in one Railway region; users far from it pay latency, which is acceptable for a research tool whose dominant latency is a 20 s model call.

| Stage | Shape | Trigger |
|---|---|---|
| Today to ~100K | One region, backups copied to a second region or provider (ADR-012). | Customer contract requires data residency, or p75 user latency to the API exceeds 400 ms for a large user segment, or a regional outage objective (RTO) cannot be met by restore. |
| ~100K to ~1M | **Warm standby** in a second region: asynchronous Postgres replica, infrastructure as code, tested failover runbook. Static assets already global. | Contractual availability above what one region offers, or RTO under 1 hour. |
| Enterprise tier | **Regional deployments by tenant** (EU, US) with data pinned per tenant. Not active-active writes. | An enterprise customer with residency needs and revenue that pays for it. |

Active-active multi-region writes are explicitly out of scope: they require conflict resolution that shoRDs' data model does not need.

### 4.13 Observability

Defined in [`OBSERVABILITY_STRATEGY.md`](OBSERVABILITY_STRATEGY.md). The scaling-relevant summary: before the first trigger in this document can be evaluated automatically, shoRDs must record request latency, event-loop lag, queue wait, DB pool use, Redis latency, provider status and spend. None of these are collected today except per-replica AI counters and the `ai_usage` ledger.

### 4.14 Disaster recovery, backups and replication

Defined in [`DATA_DURABILITY.md`](DATA_DURABILITY.md) and ADR-012: backups with point-in-time recovery, a monthly restore test, an off-platform copy, and objectives (RPO and RTO) per stage. Replication (4.2) is for **read scaling and failover speed**, never a substitute for backups: a replica faithfully copies a bad `DELETE`.

## 5. Stage summary

| | Stage 0: hundreds (today) | Stage 1: ~10K users | Stage 2: ~100K | Stage 3: 1M+ |
|---|---|---|---|---|
| Deployables | 1 (API+worker) | 1, or 2 if a trigger fired | 2 (API, worker) | 2 to 4 (API, workers by class) |
| Database | 1 Postgres | 1 Postgres + verified PITR | + pooler, rollups | + read replica, partitions |
| Redis | 1 | 1, roles separated | 2 (limits vs cache) | managed HA |
| Queue | PG table + Redis wake-up | same | same, `SKIP LOCKED` | same + fairness, classes |
| AI | 1 provider | 1 + kill switch + budgets | 2 providers, routing policy | 2 to 3 providers, shared cache |
| Storage | text in PG | text in PG | object store if uploads | object store, lifecycle |
| Search | OpenAlex from browser | PG FTS if asked | PG FTS + pgvector | dedicated engine if measured |
| Regions | 1 | 1 + off-site backups | 1 + warm standby (if triggered) | per-tenant regions (enterprise) |
| Observability | logs + ledger | error tracker, uptime, SLO alerts | tracing, dashboards | + on-call rotation |
| Cost shape | AI dominates | AI dominates | AI dominates; infra low five figures | AI dominates; negotiate |

## 6. Things deliberately not in this plan

Kubernetes; microservices; Kafka or any event stream; a second database engine (document, graph or vector) before `pgvector` and Postgres FTS are shown insufficient; GraphQL; a service mesh; active-active multi-region; fine-tuning or self-hosting models (revisit only if AI cost per user cannot be brought under the price the product can charge, and a measured quality bar can be met). Each can be reconsidered when its trigger in this document fires.

## 7. When to split a service out of the monolith

Split only when at least one holds, and record an ADR first:

1. **Different scaling shape**: it needs 10x the instances of everything else (the AI-calling worker is the first candidate).
2. **Different failure domain**: its crashes or stalls must not take the API down (document parsing is the second candidate, because hostile documents run in the API process today; see the audit's DoS finding V-5).
3. **Different security boundary**: it handles credentials or data the rest must not see (a billing webhook receiver, later).
4. **Different team or release cadence** that is blocked by the shared deploy.

"The architecture would look cleaner" is not a reason.

## 8. Reversibility notes

Every shape here is reached by configuration or by an additive code path behind an existing interface: `WORKER_ENABLED` for the worker split; the `pool` interface for a pooler; the paper store interface for object storage; the gateway adapter interface for providers (ADR-005). Going back is redeploying the previous shape; no step requires a one-way data migration except retention purges and partition moves, which are separately gated (ADR-010, ADR-011).
