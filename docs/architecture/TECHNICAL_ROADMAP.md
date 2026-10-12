# shoRDs technical roadmap

Status: 2026-10-06. Based on the audits in this folder, `../security/SECURITY_AUDIT_2026-10.md` and the ADRs in `adr/`. Principle: **keep shoRDs simple today; make sure no decision made today blocks a company ten times larger.** Nothing is on this list because it is industry-standard. Every item names the problem it solves and the condition that makes it necessary.

Column key. **Difficulty** S (hours), M (days), L (weeks). **Op cost** is the recurring cost in money or attention (none, low, medium, high). **Risk** is migration or rollout risk. Prices and vendor limits were not verified and are stated only as relative. Items needing an **approval** touch authentication, billing, Claude calls, caching, evidence grounding or production infrastructure, so they wait for an explicit yes.

## Section 0. The final distinction first

### MUST DO NOW (before any public growth; mostly owner actions or small fixes)

1. **Set a monthly spend limit and alert in the AI provider Console.** The only ceiling that exists today is the account's balance. (Owner; no code.)
2. **Verify database backups on the hosting platform** (enabled? retention? how to restore) and **do one restore into a scratch database.** Unverified so far. (Owner plus runbook.)
3. **Uptime monitor on `/ready` with phone alerts**, and the platform health check pointed at it. (No code.)
4. **Fix the migration runner** (rollback on failure, always release lock; V-12). A failed migration today poisons the pool and hangs shutdown. Needs approval because it is production infrastructure; fix is small and test exists (`todo` becomes enforced).
5. **CI that runs unit and integration tests without skipping** (Postgres and both Redis modes provided as services). Today integration tests skip silently without environment variables, so a green local run can hide a gap.
6. **Fix V-1, V-2, V-10 together** (numeric substring grounding check, delimiter look-alikes, quadratic `neutralizeTags`). Three tests exist as `todo`. This touches evidence grounding, so approval first.
7. **Reject idempotency-key reuse with a different body** (V-3). Touches job creation and AI calls; approval first.
8. **Kill switch and observe-mode budgets** (AI_COST_CONTROL_DESIGN.md steps 1 to 3). Required before public sign-up. Approval first.
9. **Check Firebase security rules and authorised domains**, and rotate any credential that was ever reused or pasted somewhere unsafe. Not verifiable from here. (Owner.)
10. **Owner decisions pending**: whether to set `ADMIN_UIDS`; what to do with the user interface sections that show unimplemented features (fabricated-looking UI must either work or be removed or labelled).

### SHOULD DO SOON (next one to two months, or before the first paying or external users)

- Event schema, request-id linking, SQL alerts, error tracking (OBSERVABILITY_STRATEGY.md Part D 2 to 4).
- `analysis_runs` provenance and evidence versioning (ADR-006), and cache identity v2 (ADR-007), as part of the gateway migration steps 1 to 4.
- Off-platform encrypted backups and the monthly restore drill (ADR-012).
- `ROLE=api|worker` split of the same image (ADR-003) and `statement_timeout` / `lock_timeout`.
- Soft delete for user research objects and the missing foreign-key rule on `analysis_jobs` (ADR-010).
- Staging environment with its own database and a production-like seed; runbooks for the five likely incidents.
- Dependency vulnerability scan in CI (not run so far; result unknown).

### DO WHEN SCALE REQUIRES IT (each has a measured trigger in the phase tables)

Transaction-mode pooler; second API replica; separate worker service; read replica; table partitioning; point-in-time recovery; shared public-paper analysis cache; second AI provider adapter; Postgres search tuning then a search service; object storage (with uploads); CDN rules for API-cached public content; billing; SSO; audit log export; regional standby.

### DO NOT BUILD YET

Kubernetes; microservices; Kafka or any streaming platform; a second database technology; a service mesh; sharding; active/active multi-region; a custom model-serving or fine-tuning stack; a data warehouse; a vector database (before Postgres vector search fails a measured target); a feature-flag vendor (environment flags suffice); GraphQL federation; building our own auth (stay on the identity provider); an OpenTelemetry collector fleet (ids and events suffice for one service).

## Load and spend reference (assumptions, not measurements)

15% daily active users, 3 AI calls per active user per day, 10x peak factor, $0.08 per uncached call: 10K users about 4,500 calls and $360 a day uncached; 100K users $3.6K a day; 1M users $36K a day. **AI spend dominates every other cost at every stage**, which is why phase 6 (cost control, shared cache) precedes phase 7 (infrastructure scale). Infrastructure for the 10K stage is modest: one or two API replicas, one worker, one Postgres instance with a pooler, one Redis.

## PHASE 1. Reliability

| Item | Why it matters and problem solved | Necessary when | Depends on | Difficulty / op cost / risk | Success criteria |
|---|---|---|---|---|---|
| 1.1 Migration runner rollback and lock release (ADR-011) | A failed migration leaves an aborted transaction and a hung process; deploys can wedge | Now | none | S / none / low | the `migrationSafety` todo test passes enforced; failed migration leaves schema unchanged and process exits cleanly |
| 1.2 CI with non-skipping integration tests | Silent skips hide regressions | Now | none | S-M / low / none | CI fails if integration tests skip; every PR runs both suites |
| 1.3 External uptime monitor + platform health check on `/ready` | Outages found by users | Now | none | S / low / none | alert within 5 min of an induced outage in a drill |
| 1.4 `statement_timeout`, `lock_timeout`, idle-in-transaction timeout | A stuck query or lock can exhaust the pool | Soon | none | S / none / low | an injected long query is cancelled within its limit |
| 1.5 Graceful shutdown and lease recovery verified under test | Deploys must not lose or double-run jobs | Soon (verify what exists first) | 1.2 | M / none / low | kill -TERM during a job: job finishes or is re-queued once; no duplicate result |
| 1.6 `ROLE=api|worker` process split (ADR-003) | A long job or crash must not take the API down | When API p95 degrades during jobs, or worker crash affects API, or workers need more capacity than API | 1.5 | M / low (one more service, small) / low | API p95 unaffected by a worker saturation test; independent deploys |
| 1.7 Runbooks for: service down, DB down, Redis down, provider outage, queue backlog | Incidents handled from memory | Soon | observability | S / none / none | each runbook exercised once in a drill |
| 1.8 Deploy rollback drill | Reversibility must be proven | Soon | none | S / none / none | rollback to previous release in under 10 minutes, documented |

## PHASE 2. Security

| Item | Why and problem solved | Necessary when | Depends on | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 2.1 Fix V-1, V-2, V-10 (grounding check and tag neutralisation) | Evidence grounding can be fooled; a 144 KB title ties the CPU for seconds | Now (approval) | tests exist | M / none / low (changes verification labels; re-run cache version bump) | three todo tests become enforced; 900 KB title processed under 100 ms |
| 2.2 Idempotency body check (V-3) | One key can be reused to return a different job's result | Now (approval) | none | S / none / low | `todo` enforced |
| 2.3 Dependency scan in CI; pin and review | Known-vulnerable packages | Soon | 1.2 | S / low / none | scan runs every PR; findings triaged within a week |
| 2.4 Firebase rules/domain review; credential rotation checklist | Misconfigured identity provider breaks isolation | Now (owner) | none | S / none / none | checklist signed off |
| 2.5 Per-route BOLA regression matrix as a gate for any new route | New endpoints are the usual source of leaks | Always | exists | S / none / none | CI fails if a route lacks matrix entry |
| 2.6 Security headers and CORS review documented | Browser-side hardening; exact current headers not verified here | Soon | none | S / none / low | headers listed and tested |
| 2.7 Row-level security (ADR-017) | A forgotten check becomes a breach | Second engineer, enterprise customers, or after any isolation bug | repository layer | L / low / medium | cross-tenant read returns zero rows even with a deliberately missing app check |
| 2.8 Untrusted-document sandbox | Parser bugs on hostile uploads | With the first upload feature | 8.1 | M-L / low-medium / low | parser runs with no network or secrets, memory and time caps |
| 2.9 Abuse controls: email verification before paid AI, new-account budgets | Free accounts used to drain AI budget | Before public sign-up | 6.2 | M / none / low | an abuse simulation cannot exceed the new-account budget |
| 2.10 Secrets handling: server-only keys, rotation runbook, periodic rotation | Key leak response | Soon | none | S / none / none | rotation completed in a drill without downtime |

## PHASE 3. Data durability

| Item | Why and problem solved | Necessary when | Depends on | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 3.1 Verify platform backups; first restore drill | Unknown recoverability | Now | none | S / none / none | restored scratch DB passes row counts and constraint checks; time recorded |
| 3.2 Off-platform encrypted versioned backups (ADR-012) | Platform or account loss | Soon | 3.1 | M / low / none | newest backup age under RPO; restore from this copy tested |
| 3.3 Monthly restore drill with recorded RTO | Prove the RTO | After 3.2 | 3.2 | S / low (attention) / none | drill logged monthly |
| 3.4 Foreign key rule on `analysis_jobs`, soft delete (ADR-010) | Project deletion fails or orphans; no undo | Soon | migration policy 1.1 | M / none / medium (expand then contract) | delete then undo works; purge removes after window; no orphans in a scan |
| 3.5 `analysis_runs` and evidence versioning (ADR-006) | No permanent provenance; chunks overwritten | With gateway migration | 6.3 | M-L / low (storage) / low (additive) | every new analysis has a run row; old rows marked UNKNOWN |
| 3.6 Ledger retention and rollups | Unbounded growth, personal data kept forever | When `ai_usage` passes about 10 GB or at 12 months | 3.5 | M / none / low | monthly rollup job; raw rows older than 13 months removed with approval |
| 3.7 Point-in-time recovery (ADR-012) | RPO of 24 h too coarse | At 100K stage, or earlier if paying customers need it | 3.2 | M / medium / low | restore to an arbitrary minute in a drill |
| 3.8 Timestamps and constraints cleanup (checks, NOT NULLs, `timestamptz` consistency) | Latent integrity gaps listed in DATA_DURABILITY.md | Soon | 1.1 | M / none / low-medium | each constraint added `NOT VALID` then validated |

## PHASE 4. Observability (details in OBSERVABILITY_STRATEGY.md)

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 4.1 SQL alerts: provider failures, credits, backlog, stuck jobs, spend | Failure and cost spikes unseen | Now | none | S-M / low / none | each alert fired once in a test |
| 4.2 Event schema, allow-list, request-id link | Cannot trace one request across stores | Soon | none | M / none / low | one id finds the log, ledger and job row; schema test blocks unknown fields |
| 4.3 Error tracking, scrubbed | Unhandled errors invisible | Soon | none | S / low / low (privacy config) | a thrown test error appears without any body or header |
| 4.4 Log aggregation and latency percentiles | Cannot compute p95 or 5xx share | Soon to 10K | 4.2 | M / medium / none | A2, A9, A10 alerts live |
| 4.5 Runtime events (event-loop lag, memory, pool use) | Capacity unknown | Before adding replicas | 4.2 | S / low / none | panels show real numbers |
| 4.6 SLOs and monthly review | No shared definition of healthy | At 10K | 4.1, 4.4 | S / none / none | SLO report each month |
| 4.7 Distributed tracing (OpenTelemetry) | Multi-service debugging | Only when more than one service exists and ids no longer suffice | 1.6 | M / medium / none | traces link API to worker |

## PHASE 5. Developer velocity

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 5.1 One-command local environment (the test infra script made official) | Slow onboarding | Soon | none | S / none / none | new machine to green tests under 30 minutes |
| 5.2 CI pipeline with caching, required checks | Slow or skipped verification | Now | 1.2 | S / low / none | PR feedback under 10 minutes |
| 5.3 Staging environment with seed data | Testing against production only | Soon, before paying users | 5.1 | M / low-medium / none | each release deployed to staging first |
| 5.4 Preview deploys for the web client | Slow UI review | When more than one contributor | 5.3 | S / low / none | per-PR URL |
| 5.5 Contract tests for the API (OpenAPI or schema snapshot) | Silent API contract changes (a standing rule) | Soon | 5.2 | M / none / none | a contract diff fails CI unless versioned |
| 5.6 Realistic-data migration test (nightly) | Locks and runtime surprises | With 1.1 | 5.1 | M / low / none | timing report; threshold fails build |
| 5.7 Feature flags via environment | Safe rollouts, reversible | Soon | none | S / none / none | flags documented, default off |
| 5.8 Type checking or JSDoc types on the boundary modules | Refactor safety for the gateway | During gateway migration | none | M / none / low | boundary contracts checked in CI |

## PHASE 6. AI quality and cost

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 6.1 Kill switch (ADR-009) | No way to stop paid calls quickly | Before public sign-up (approval) | none | S-M / none / low | zero provider calls when engaged (stub-counted); clients cannot override |
| 6.2 Budgets in observe then enforce mode | No ceilings per user, tenant, global | Before public sign-up | 4.1 | M / low / low | worst-case daily spend bounded by configuration, proven by concurrency test |
| 6.3 Gateway strangler migration steps 1 to 8 (ADR-005) | Provider details in seven modules | Soon; must precede a second provider | 5.8 | L / none / low (stepwise) | boundary test enforced; one adapter file knows Anthropic |
| 6.4 Cache identity v2 (ADR-007) | Title missing from key, stale header | With 6.3 | none | M / none / low (version bump) | the two `todo` cache-gap tests pass |
| 6.5 Evaluation harness: fixed paper set, scored outputs, no paid calls in CI (recorded responses) plus occasional manual paid run authorised by the owner | Cannot tell if a model change is better | Before any model change or second provider | 6.3 | M / low per run / none | a model swap produces a report before it is allowed |
| 6.6 Model upgrade process and price-table review (monthly) | Deprecations and price changes | Soon | 6.3 | S / none / none | recorded decision per change |
| 6.7 Shared public-paper analysis cache (ADR-007) | Pays N times per paper | When monthly AI spend justifies it (owner threshold) and licence check passes (ADR-018) | 6.4, 6.5 | M / low / medium (cross-tenant risk) | measured hit share; cross-tenant leak test; cost drop recorded |
| 6.8 Second provider adapter | Outage or price protection | A sustained outage, price gap or contract need | 6.3, 6.5 | M / medium / low | failover drill; fallback class recorded |
| 6.9 Circuit breakers and cooldowns | Retry storms against a failing provider | With 6.2 | 6.1 | M / none / low | breaker test; no calls while open |

## PHASE 7. Scalability

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 7.1 Connection budget and pooler (ADR-004) | Connection exhaustion with replicas | Connections above 60% of max at peak, or second API replica | 4.5 | S-M / low-medium / low (migrations use direct URL) | headroom above 40% at peak |
| 7.2 Second API replica | Availability and capacity | CPU above 60% sustained at peak, or availability target needs redundancy | 7.1 | S / medium / low | rolling deploy with no 5xx |
| 7.3 Separate, autoscaled worker count | AI throughput | Queue wait above SLO with provider healthy | 1.6 | S / medium (cost per worker) / low | queue wait within SLO at 10x peak test |
| 7.4 Read replica with read-your-writes routing | Primary CPU from reads | Primary CPU above 60% sustained and reads dominate | 7.1 | M / medium / medium (lag semantics) | lag-aware routing tests |
| 7.5 Partition `ai_usage` and finished jobs by month | Maintenance windows and size | Table above roughly 50 to 100 GB | 3.6 | M / low / medium | old partitions detach and archive without locks |
| 7.6 Redis sizing, eviction policy review, replica for failover | Cache loss or memory pressure | Memory above 70% or availability need | 4.5 | S-M / medium / low | no eviction of lock or limiter keys; failover tested |
| 7.7 CDN for static assets (exists via the web host) and cacheable public API responses | Latency and origin load | Public paper metadata read volume high | 4.4 | S / low / low | cache hit share measured |
| 7.8 Provider rate-limit management (token buckets, partner access) | Provider throttling at volume | Provider 429s above 1% of calls | 4.2 | M / low / low | no sustained 429s |
| 7.9 Regional standby (ADR-016) | Regional outage | Customer or contract demands, or measured user latency | 3.7 | L / high / medium | failover drill meets RTO |
| 7.10 Search service (ADR-015) | Postgres search too slow | Measured p95 above target after tuning | 8.3 | L / medium / medium | target met on a copy of production data |

## PHASE 8. Product infrastructure

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 8.1 File uploads with object storage (ADR-014) | Users bring their own papers | Product decision to support uploads | 2.8 | L / low-medium / medium | size caps, scanning, signed URLs, tested |
| 8.2 Transactional e-mail (verification, sharing, alerts) | Verification and notifications | Before paid AI sign-up (verification) | none | M / low / low | deliverability checked; unsubscribe |
| 8.3 Postgres full-text search over the user's library | Find papers and notes | When libraries exceed what simple filtering handles | none | M / none / low | p95 under target on large library |
| 8.4 Export and import (user data portability) | Trust, legal | Soon after launch | 3.4 | M / none / low | export round trip tested |
| 8.5 Audit log of sensitive actions (membership, deletion, admin) | Accountability | Teams or enterprise | 2.5 | M / low / low | append-only table; tested |
| 8.6 Collaboration (shared projects, comments) | Product value | Product decision | 2.5 | L / low / medium | role matrix extended and tested |
| 8.7 Background scheduled tasks (digests, re-checks) | Recurring features | Product decision | 1.6 | M / low / low | scheduler uses the same job table |

## PHASE 9. Business and billing infrastructure

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 9.1 Plans and entitlements (limits per plan feeding budgets and rate limits) | Free versus paid behaviour | Before charging | 6.2 | M / none / medium (touches limits; approval) | one table drives limits; tested |
| 9.2 Payment provider integration (hosted checkout, webhooks verified, idempotent) | Charging safely without handling card data | When pricing is decided | 9.1, 4.1 | M-L / per-transaction fees (not verified) / medium (billing; approval) | test-mode flow end to end; webhook replay safe |
| 9.3 Usage metering from the ledger | Usage-based pricing and margin tracking | When usage-based plans exist | 3.5 | M / none / low | metered usage reconciles with provider invoice within 5% |
| 9.4 Invoices, tax handling, refunds, dunning | Legal and revenue | At first paying customers | 9.2 | M / medium / medium | process documented; tested in provider test mode |
| 9.5 Cost per user and margin dashboard | Predictable unit economics | At 10K stage | 9.3 | S / none / none | margin by plan visible weekly |

## PHASE 10. Enterprise readiness

| Item | Why and problem solved | Necessary when | Depends | Difficulty / cost / risk | Success criteria |
|---|---|---|---|---|---|
| 10.1 SSO (SAML/OIDC) and SCIM | Enterprise sign-on | First enterprise deal requires it | identity provider support (not verified) | M-L / medium / medium (auth; approval) | tested with a customer IdP |
| 10.2 Fine-grained roles, org admin console | Larger teams | Teams above a handful | 2.5, 8.5 | L / low / medium | role matrix tests |
| 10.3 Audit log export, retention controls | Compliance | Enterprise contract | 8.5, 3.6 | M / low / low | customer can export their log |
| 10.4 Data residency options | Legal requirement | A contract requires it | 7.9 | L / high / high | tenant pinned to region; verified |
| 10.5 Security attestations (for example SOC 2) | Procurement | Several enterprise deals blocked on it | all of phase 2, 3, 4 | L / high (audit fees, process) | report obtained |
| 10.6 SLA and status page, support process | Contracts | Enterprise contract | 4.6 | M / low / none | SLA measured against SLOs |
| 10.7 Customer-managed keys, private deployment | Rare high-end demand | Only on explicit, paid demand | much | L / high / high | decided case by case; not planned |

## Stage map

| Stage | Users | What changes | What stays |
|---|---|---|---|
| Now | hundreds | MUST DO NOW list; one API+worker process; single Postgres and Redis | everything else |
| 10K | | observability events, ROLE split, backups off-platform with drills, soft delete, provenance, gateway, budgets enforced, staging, pooler | single region, one provider |
| 100K | | 2+ API replicas, scaled workers, read replica if triggered, PITR, partitioning, shared cache, second provider, billing | modular monolith |
| 1M+ | | regional standby, search service if measured, RLS, enterprise features, dedicated platform engineering | still no Kafka or microservices unless a criterion in ADR-001 is actually met |

## How this list is kept honest

Each item is removed from SHOULD or WHEN lists only when its success criterion is demonstrated, not when code is merged. Triggers are reviewed monthly against measured data (OBSERVABILITY_STRATEGY.md); a trigger with no measurement behind it is a reason to add the measurement, not to build the item.
