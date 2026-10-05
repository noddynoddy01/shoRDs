# ADR-004: Database connections, pooling, replicas and partitioning

- Status: Accepted (staged)
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

The backend has a hand-written Postgres client with `PG_POOL_MAX` default 8 per replica, using unnamed prepared statements, which is compatible with transaction-mode poolers. The migration runner takes a session advisory lock and needs a direct connection.

## Decision

Stage 1: direct connections, small pools, set `statement_timeout` and `lock_timeout`, and an explicit connection budget (`replicas x PG_POOL_MAX + workers + admin < max_connections` with headroom). Stage 2: a transaction-mode pooler in front of the app connections (migrations use the direct URL). Stage 3: a read replica for heavy reads, with an explicit route classification (reads that must see their own writes stay on the primary). Stage 4: partition large append-only tables (`ai_usage`, finished jobs) by month.

## Trigger to revisit or advance

Pooler when connections used exceed 60% of `max_connections` at peak, or a second API replica is added. Read replica when primary CPU is above 60% sustained at peak with reads dominating, or analytic queries threaten interactive latency. Partitioning when `ai_usage` or a similar table exceeds about 50 to 100 GB or maintenance operations take longer than their windows. Sharding is not planned; reconsider only far beyond 1M users and only after partitioning, a larger instance and read replicas are exhausted.

## Consequences

Predictable connection use; replica lag creates eventual-consistency cases that must be designed (read-your-writes routing). Cost: the pooler is another component (managed pooler preferred).

## Reversibility

Each stage is reversible by configuration; partitioning needs a planned migration (ADR-011).

## Alternatives rejected

Sharding early (rejected: large complexity, no need); one huge pool per replica (rejected: exhausts connections).
