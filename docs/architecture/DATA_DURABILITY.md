# Data durability: schema audit, migrations, retention, backup and disaster recovery

Status: audit and design, 2026-10-06. Read-only: no production data was read or changed. Schema facts come from `backend/data/migrations.js` (versions 1 and 2) and the data-access code; behaviour marked *reproduced* was run on a throwaway local PostgreSQL 16.
Decisions: ADR-002, ADR-010, ADR-011, ADR-012.

## 1. What data exists and how valuable it is

| Data | Where | Owner | Value | Rebuildable? |
|---|---|---|---|---|
| Projects, membership, roles | Postgres `projects`, `project_members` | user/tenant | **High** (user research structure) | No |
| Analysis results (structured intelligence) | Postgres `analysis_jobs.result` (JSONB) | tenant | **High** (paid for; user-visible) | Only by paying again, and not identically |
| Question answers | **not stored** (Redis cache 24 h only) | tenant | Medium | No (nothing durable exists: audit C13) |
| Papers and chunks | Postgres `papers`, `paper_chunks` | public content | Medium | Yes, from providers (cost: time and rate limit; content may change) |
| AI usage ledger | Postgres `ai_usage` | operator | **High** (cost accounting, audit) | No |
| Billing records | **none exist yet** | n/a | will be Critical | n/a |
| Authentication identities | Firebase (Google-managed) | user | High | No (outside shoRDs) |
| Rate-limit counters, locks, cache, job wake-ups | Redis | n/a | Low | Yes (all rebuildable; loss resets limits) |
| Browser data (profile, chats, saved items) | client storage | user | Medium | No (single device) |

## 2. Schema audit

Legend: OK = adequate for now; GAP = fix before the stage in the last column; RISK = can cause data loss or wrong data.

### 2.1 Keys and constraints

| Table | Primary key | Foreign keys | Other constraints | Findings |
|---|---|---|---|---|
| `projects` | `project_id` TEXT | none | `tenant_id`, `name` NOT NULL | OK. **GAP**: no `updated_at`, `deleted_at`, `created_by` is a raw uid with no users table |
| `project_members` | (`project_id`, `user_id`) | `project_id` -> projects ON DELETE CASCADE | role CHECK in 4 values | OK. **GAP**: a role change overwrites the row (`ON CONFLICT DO UPDATE`), so there is no history of who held which role when; no removal path |
| `analysis_jobs` | `job_id` | `project_id` -> projects (**no ON DELETE action**) | status CHECK; unique (`user_id`, `idempotency_key`) where key not null | OK that a project with jobs cannot be hard-deleted by accident. **GAP**: no way to delete a project at all (no delete route); idempotency key not bound to request body (security audit V-3); no unique protection against two active jobs for the same paper/depth |
| `papers` | `paper_id` | none | coverage CHECK | OK. **GAP**: refresh overwrites in place (C14); no `licence_policy`, no `taken_down` flag |
| `paper_chunks` | (`paper_id`, `ordinal`) + UNIQUE (`paper_id`, `chunk_id`) | `paper_id` -> papers ON DELETE CASCADE | | OK. **RISK**: refresh does `DELETE FROM paper_chunks` then re-insert in one transaction, so older analyses lose the text they cited |
| `ai_usage` | `id` BIGSERIAL | none (intentional: the ledger outlives rows it describes) | `cost_status`, `outcome` NOT NULL | OK. **GAP**: `request_id` not unique (a retried write can duplicate), `cost_usd` DOUBLE PRECISION (rounding), no `provider_request_id`, `prompt_version`, `stop_reason` |
| `schema_migrations` | `version` | none | | OK. **GAP**: no checksum, so an edited past migration goes unnoticed |

No orphan rows can arise from the declared foreign keys. Orphans that *can* arise: `papers` rows no project references (harmless, public cache), `ai_usage` rows referring to deleted projects (intended), `analysis_jobs.user_id` and `project_members.user_id` referring to users that no longer exist (there is no users table; account deletion would leave them).

### 2.2 Indexes

| Query | Index | Verdict |
|---|---|---|
| projects of a user | `project_members_user_idx` + join | OK |
| project by id | PK | OK |
| job by id | PK | OK |
| jobs of a project, newest first | `analysis_jobs_project_idx (project_id, created_at DESC)` | OK |
| worker/reaper scans by status | `analysis_jobs_status_idx (status, updated_at)` | **GAP at ~100K users**: covers all statuses, so completed rows (the vast majority) inflate it; use a partial index on `status IN ('QUEUED','PROCESSING')` |
| idempotency lookup | unique partial index | OK |
| ledger by tenant and time | `ai_usage_tenant_idx` | OK |
| ledger by time | `ai_usage_created_idx` | OK; becomes a partitioning key at stage 3 |
| ledger by `request_id` or `job_id` (reconciliation, support) | none | **GAP**: sequential scan; add when support or reconciliation starts |
| paper by DOI/PMID/arXiv id | none (lookups are by canonical `paper_id`) | OK |

Indexes should be reviewed from `pg_stat_statements` (not enabled or verified today) when query time p95 passes 100 ms.

### 2.3 Transactions, isolation, concurrency

- Isolation level is PostgreSQL's default, READ COMMITTED; the client never sets another. Adequate for the access patterns below.
- `pool.transaction` issues BEGIN/COMMIT and ROLLBACK on error: correct.
- Project creation (project + owner membership): one transaction. OK.
- Member change: `SELECT ... FOR UPDATE` on all owner rows then upsert, in one transaction, so two concurrent demotions cannot leave a project without an owner. OK (tested).
- Paper refresh: upsert paper, delete chunks, insert chunks in one transaction. Concurrent refreshes of one paper serialise on the row lock; a Redis lock also limits duplicate retrieval. OK, with the C14 caveat.
- Job claim: atomic conditional update by id with worker id and status; completion and failure conditional on the same. OK (the best-designed part of the system).
- Idempotent job creation: `INSERT ... ON CONFLICT DO NOTHING` then select. Race-free, but the replay returns whatever job holds the key regardless of the request (V-3).
- **RISK (reproduced), migrations**: `BEGIN; <sql>; INSERT ...; COMMIT;` is one simple query with no `ROLLBACK`. When a statement fails the server leaves the session in an aborted transaction; the pool returns that connection to the idle list (it only checks that the socket is alive), and it still holds the session advisory lock. Local run: the next query on that connection fails with `25P02 current transaction is aborted`; `pool.end()` then never completes. `backend/tests/node/migrationSafety.integration.test.js` demonstrates it (`todo` until the runner is fixed, which needs approval). Control tests prove the failed migration itself is atomic and that re-running applied migrations is a no-op.
- **RISK (reproduced earlier by the reviewer, not re-run in this pass)**: a client-side parse error (for example an `infinity` timestamp) leaves a connection with an unread response stream.
- **Local finding fixed in this pass**: a NUL byte in a project name caused a PostgreSQL error that surfaced as `503 DEPENDENCY_UNAVAILABLE`. The route now rejects control characters with 400. The general fix (map SQL errors that are the client's fault to 4xx) is in the roadmap (Phase 1).
- No server-side `statement_timeout`, `lock_timeout` or `idle_in_transaction_session_timeout`; a client timeout destroys the socket but the backend may continue the statement.

### 2.4 Duplicates and idempotency

- Jobs: duplicate paid work is possible when a client sends no idempotency key (double click) and the cache is off or the requests are not concurrent. Mitigation design: a unique partial index on active jobs `(project_id, paper_id, depth) WHERE status IN ('QUEUED','PROCESSING')` and "attach to the existing job" semantics (additive, no data change).
- Ledger: rows are written once per request after the call; a crash between the paid call and the write loses the row; retries create new rows. Design: write an *intent* row before the call and *settle* it after (ADR-009). The ledger today is accurate for completed calls and silent about crashed ones.
- Papers: one canonical row per id; `title:` ids can collide for different papers (audit P1-11).

### 2.5 Tenant isolation

Isolation is enforced in application code: every route resolves membership by project, and every cache key includes tenant and project. There is no row-level security in Postgres. Local attack tests (`securityAudit.integration.test.js`) confirm that a stranger cannot read, change, analyse or cancel anything in another user's project, that responses for "exists but not yours" and "does not exist" are identical, and that role escalation is refused. `tenant_id` is derived from the creator's uid, so a tenant is one user (audit P2-2). Defence in depth with Postgres row-level security is a **do not build yet** item: it needs a per-request `SET LOCAL` with the hand-written client and is justified only by an enterprise customer, a compliance requirement, or a second team writing queries (ADR-017).

### 2.6 Timestamps

All timestamps are `TIMESTAMPTZ` with `now()` defaults: correct. `analysis_jobs.updated_at` is set by application code (no trigger): acceptable. Missing: `updated_at` on `projects`, `deleted_at` everywhere. Lease and cancel logic uses the **database clock**, which avoids replica clock skew: good.

### 2.7 Growth and retention (today: none)

`ai_usage` (a row per request), `analysis_jobs` (a JSONB request and result per job), `papers` and `paper_chunks` grow without bound; no job removes anything. Modelled sizes: a structured result is on the order of tens of KB; 4,500 analyses per day (10K-user stage, Section 3 of the scaling document) is on the order of 100 MB per day of job results, so retention must exist before the 10K stage.

## 3. Deletion: soft delete, archive or hard delete

Decision (ADR-010): **soft delete first, hard purge later, by data class.**

| Class | Delete behaviour | Why |
|---|---|---|
| Projects, membership, analyses (user research) | Soft delete: `deleted_at` set, hidden from every API path, restorable for 30 days; then a purge job hard-deletes after the window, unless a legal hold flag is set. An owner may request immediate purge (confirmed, logged). | Accidental deletion of research is the most damaging user-visible failure; a short undo window costs little. Erasure obligations are met by the purge. |
| Analysis run records (`analysis_runs`, ADR-006) | Append-only; erased only with their project/user purge; content bodies purged, a tombstone row (id, hashes, cost, no content) may remain for accounting | Audit trail and cost history |
| Jobs (`analysis_jobs`) | Operational: results copied into the permanent record, then job rows archived or deleted after 90 days | Keeps the hot table small |
| AI usage ledger | Keep detail 13 months, then monthly rollups; no content; `user_hash` replaced by a keyed hash (HMAC with a server secret) so it cannot be matched to a person after erasure | Financial and audit value without personal data |
| Papers and chunks (public content) | Refresh policy plus purge on takedown (licence) | Not user data |
| Redis | Never authoritative; flushing it is always safe | |
| Account deletion | Soft delete the account's owned projects, remove memberships, then purge after the window; anonymise ledger rows; delete the Firebase user | Store requirements and privacy law (verify the specific obligations for your users with counsel) |

Archival (moving old completed jobs to cheaper storage) is appropriate only when job volume makes the hot table a measured problem; before that, delete-after-copy is simpler.

## 4. Migration policy (ADR-011)

Every migration must be **deterministic, versioned, reviewable, backward-compatible where practical, tested against realistic data, reversible when technically possible**, and none may be destructive automatically.

1. **Versioned and immutable.** One file per version, never edited after release. A checksum of each applied migration is stored in `schema_migrations`; the runner refuses to start if an applied migration's checksum changed. (Today: no checksum.)
2. **Expand, then contract.** Release N adds (tables, nullable columns, new indexes `CONCURRENTLY`, `NOT VALID` constraints). Release N+1 reads/writes the new shape. Only a later release, at least one full deploy cycle and N days after, may remove the old shape. Application code must tolerate the previous and the next schema (the readiness check already accepts a *newer* schema: `current >= expected`).
3. **Classification in the file header**: `additive`, `backfill`, or `destructive`. CI lints SQL for `DROP`, `TRUNCATE`, `ALTER COLUMN ... TYPE`, `RENAME`, unbounded `DELETE/UPDATE` and fails unless the file is classified `destructive`.
4. **Destructive migrations never run automatically.** The boot runner skips them and `/ready` reports `PENDING_DESTRUCTIVE_MIGRATION`; an operator applies one by setting `ALLOW_DESTRUCTIVE_MIGRATION=<version>` for a single deploy, after a verified backup and written approval. Not built yet.
5. **Reversible where possible.** Additive migrations ship a `down` that drops what they add; a CI job asserts `up, down, up` yields an identical schema dump. Backfills ship a verification query. Destructive ones are not reversible by definition: the rollback is the backup (Section 5), which is why a fresh restore point is a precondition.
6. **Tested on realistic data.** A seeded generator builds a dataset sized to the next stage (for example 100K projects, 5M jobs, 1M papers, 100M chunk rows scaled down proportionally for CI) and a nightly job runs pending migrations against it, recording duration and the longest lock wait. Thresholds: no migration may hold an `ACCESS EXCLUSIVE` lock longer than 1 s on a hot table (`lock_timeout` 2 s, `statement_timeout` set per migration).
7. **Runner safety (the P0-4 fix).** On any error: `ROLLBACK`, destroy the connection, release the lock on a dedicated connection that is closed after use. Migrations connect directly to Postgres, not through a pooler (session advisory lock).
8. **Review.** Migration PRs require a second reviewer (or a documented self-review checklist while the team is one person), a stated rollback, and a measured duration on the realistic dataset.

## 5. Backup and disaster recovery (ADR-012)

**Verified state today: unknown.** The repository configures no backup, and the Railway dashboard was not inspected. Everything below is the target; the first action is to look (roadmap Phase 3, item 1).

### 5.1 Objectives

| Stage | RPO (data you may lose) | RTO (time to restore) | Mechanism |
|---|---|---|---|
| Now (hundreds of users) | 24 h, accepted explicitly | 8 h | daily logical dump copied off the platform, plus any platform backup that is verified to exist |
| ~10K users | 1 h | 4 h | continuous WAL archiving / point-in-time recovery (managed, if the plan offers it: verify) plus the off-site dump |
| ~100K users | 5 min | 1 h | PITR plus a streaming replica in the same region for fast promotion |
| 1M+ / enterprise | 1 min | 15 min | replica promotion, warm standby in a second region (ADR-016) |

These are targets to be confirmed by measurement; an objective that has never been tested is not an objective.

### 5.2 Mechanism details

- **Frequency and retention**: daily full logical dump (custom format) retained 14 days, weekly 8 weeks, monthly 12 months; PITR window 7 days when available. Retention beyond that depends on legal needs (verify with counsel).
- **Off-platform copy**: encrypted (client-side key held by the owner, not by the platform), stored in object storage in another provider or account, with **versioning and object lock** so a compromised credential cannot delete history (ransomware and malicious-delete defence). The writer credential can only add objects.
- **Restore test**: monthly, automated where possible: restore the latest dump into a scratch database, run schema status, run a fixed set of integrity queries (row counts within tolerance of production, referential checks, `SELECT count(*)` per table, checksum over a sample of `analysis_jobs.result`), run the real test suite's read-only checks, record elapsed time. The measured time **is** the RTO; if it exceeds the objective, the stage objective fails and is escalated.
- **Redis**: not backed up and not restored; the application must start with an empty Redis (verified by design: counters reset, locks expire, cache refills, job wake-ups rebuilt by the stale-job reaper). A test that flushes Redis mid-load and asserts no data loss belongs in the suite.
- **Secrets**: stored in the platform's secret store plus an offline copy in a password manager; restoring the database without secrets is not a recovery.
- **Firebase**: user identities live in Firebase, outside these backups. Export the user list periodically (owner action; verify Firebase's own export and recovery options).

### 5.3 Disaster scenarios and responses

| Scenario | Detection | Recovery | Data lost |
|---|---|---|---|
| Postgres volume loss or corruption | `/ready` database failing; provider alert | restore latest PITR or dump to a new instance, repoint `DATABASE_URL`, run schema status | up to RPO |
| Bad migration | `/ready` NOT_READY; error spike | stop deploy, roll back the application; if the schema changed destructively, restore to the pre-migration point | up to RPO, hence a restore point is taken before any destructive migration |
| Accidental or malicious deletion | user report; audit event | restore into a scratch database, copy back the rows, never overwrite production blindly | none if PITR |
| Redis loss | rate limiting fails closed (503) | restart or replace Redis; flows resume empty | none that matters |
| Region or platform outage | uptime monitor | stage 1: wait or restore elsewhere from off-site dump (hours); stage 3: promote warm standby | up to RPO |
| Anthropic outage or account suspension | provider failure rate alert | labelled local fallback, queue, second provider (ADR-008) | none |
| Leaked database credential | secret scanning, anomaly | rotate credential, review audit log, restore if altered | depends |
| Leaked Anthropic key | spend alert | rotate in console (an owner action), redeploy | none |

### 5.4 Replication

A streaming replica is for **read scaling and faster failover**, not for backup: it replays a bad `DELETE`. Introduce it at the stage where RTO or read load requires it (scaling document 4.2). Before any read is routed to it, replica lag must be a measured metric and the application must specify which reads may be stale. Logical replication is a tool for zero-downtime major upgrades and later per-tenant moves, not a day-one need.

## 6. Realistic-data testing and verification still owed

Not done in this pass (needs infrastructure or approval): restore drill, realistic-volume migration timing, `pg_stat_statements` index review, measuring actual table sizes in production, checking Railway backup settings. All are read-only or run on copies; none touches production data.
