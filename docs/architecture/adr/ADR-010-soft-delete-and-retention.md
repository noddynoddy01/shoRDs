# ADR-010: Soft delete with a bounded undo window, then purge; retention by data class

- Status: Accepted (design); needs migration approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Deletion is hard delete with cascade today, and `analysis_jobs` has a foreign key without a delete rule, so some deletions fail. The AI ledger grows without bound.

## Decision

User research objects (projects, notes) are soft-deleted (`deleted_at`) with a 30-day undo, then purged by a job; personal-data erasure requests purge faster and are recorded without the content. Public paper data is never deleted by users. The AI ledger is kept 13 months, then rolled up with a keyed hash of the user. Backups follow their own retention and are not edited; restored data re-applies pending deletions.

## Trigger to revisit or advance

Revisit windows with legal or enterprise requirements (phase 10).

## Consequences

Mistakes are recoverable; storage and privacy exposure are bounded. Cost: all queries must filter on `deleted_at` (use views or a repository layer) and the unique constraints need care.

## Reversibility

Additive columns; the purge job can be disabled.

## Alternatives rejected

Hard delete only (rejected: no recovery); keep everything forever (rejected: privacy and cost).
