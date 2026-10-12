# Architecture decision records

Each record states context, decision, the trigger for revisiting it, consequences, reversibility and the alternatives rejected. Status words: Accepted, Accepted (design) = agreed design not yet implemented, Proposed = direction not yet needed.

| ADR | Decision | Status |
|---|---|---|
| [001](ADR-001-modular-monolith.md) | Stay a modular monolith | Accepted (current), reviewed at each stage |
| [002](ADR-002-postgres-source-of-truth.md) | PostgreSQL is the single source of truth; Redis is never authoritative | Accepted |
| [003](ADR-003-postgres-queue-and-worker-split.md) | Postgres-backed job queue; split the worker into its own process when triggered | Accepted |
| [004](ADR-004-connection-pooling-and-replication.md) | Database connections, pooling, replicas and partitioning | Accepted (staged) |
| [005](ADR-005-provider-agnostic-ai-gateway.md) | Provider-agnostic AI gateway with a single adapter boundary | Accepted (design); implementation needs approval |
| [006](ADR-006-analysis-provenance.md) | Every analysis permanently records its provenance; auditable, not reproducible | Accepted (design); needs migration approval |
| [007](ADR-007-cache-identity-v2.md) | Cache identity v2 and a shared cache for public-paper analyses | Accepted (design); needs approval |
| [008](ADR-008-fallback-routing-no-silent-meaning-change.md) | Fallback routing never silently changes the meaning of an analysis | Accepted (design) |
| [009](ADR-009-ai-cost-control-and-kill-switch.md) | Budgeted AI calls with a server-side kill switch | Accepted (design); needs approval |
| [010](ADR-010-soft-delete-and-retention.md) | Soft delete with a bounded undo window, then purge; retention by data class | Accepted (design); needs migration approval |
| [011](ADR-011-migration-policy.md) | Migrations are versioned, checksummed, expand/contract; destructive ones are never automatic | Accepted (design); runner fix needs approval |
| [012](ADR-012-backup-and-disaster-recovery.md) | Backups, restore drills and recovery objectives | Accepted (targets); verification owed |
| [013](ADR-013-observability.md) | Observability: ids and events first, tools after, no invented metrics | Accepted |
| [014](ADR-014-object-storage-for-documents.md) | Object storage for uploaded and large documents | Proposed (not needed yet) |
| [015](ADR-015-search-infrastructure.md) | Search starts as Postgres full-text search; a search engine only on evidence | Proposed |
| [016](ADR-016-multi-region.md) | Single region first; multi-region only for resilience or latency requirements | Proposed |
| [017](ADR-017-tenancy-and-security-posture.md) | Application-enforced tenant isolation, with row-level security as a later defence in depth | Accepted (current); RLS proposed |
| [018](ADR-018-scholarly-provider-and-licence-policy.md) | Scholarly provider usage, rate limits and licensing | Accepted (policy); terms review owed |

Related: `../SCALING_ARCHITECTURE.md`, `../AI_GATEWAY_DESIGN.md`, `../AI_COST_CONTROL_DESIGN.md`, `../DATA_DURABILITY.md`, `../OBSERVABILITY_STRATEGY.md`, `../TECHNICAL_ROADMAP.md`, `../../security/SECURITY_AUDIT_2026-10.md`.
