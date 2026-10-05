# ADR-002: PostgreSQL is the single source of truth; Redis is never authoritative

- Status: Accepted
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Postgres 16 holds projects, members, jobs, papers, chunks and the AI ledger. Redis 7 holds the rate limiter, result cache, locks and job wake-ups. See DATA_DURABILITY.md.

## Decision

Anything that must survive a Redis flush lives in Postgres. Redis may lose all data at any time and the system must stay correct (jobs are recovered from Postgres, cache rebuilds, rate-limit windows reset, budget counters are rebuilt from the ledger, ADR-009). One relational database; no second database technology.

## Trigger to revisit or advance

Consider a different store only when Postgres demonstrably cannot serve a workload after the steps in ADR-004 (for example full-text search at a scale where Postgres search is too slow or too costly, ADR-015). Evidence required: measured query times and cost, not preference.

## Consequences

Strong transactions and constraints for the data that matters; one backup story; one skill set. Cost: Redis loss degrades speed and temporarily resets rate windows; rate limiting fails closed so a Redis outage is visible to users as 503 on limited routes.

## Reversibility

Reversible; the data model does not depend on Redis semantics.

## Alternatives rejected

Redis as primary job store (rejected: loss on eviction or restart); MongoDB or DynamoDB (rejected: relational integrity and constraints are needed).
