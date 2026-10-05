# ADR-011: Migrations are versioned, checksummed, expand/contract; destructive ones are never automatic

- Status: Accepted (design); runner fix needs approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Migrations run `BEGIN; sql; INSERT; COMMIT;` as one simple query with no rollback; a failure leaves the connection in an aborted transaction (reproduced in `migrationSafety.integration.test.js`, V-12). There is no checksum, so an edited old migration goes unnoticed.

## Decision

Fix the runner to roll back on failure and always release the lock; store a checksum per version and refuse to start when an applied migration's file changed; classify each migration (`additive`, `backfill`, `destructive`) in a header; destructive migrations run only with `ALLOW_DESTRUCTIVE_MIGRATION=<version>` set by a human; use expand/contract (add, dual-write or backfill, switch reads, remove later in a separate release); set `lock_timeout`; test up, down and up again; nightly test on a realistic-size dataset with timing.

## Trigger to revisit or advance

Always. The runner fix is the first item because it is a bug.

## Consequences

Deploys stay reversible and predictable. Cost: contract steps take an extra release.

## Reversibility

Policy and tooling; reversible.

## Alternatives rejected

Auto-apply everything (rejected: destructive risk); adopt a heavy migration framework (rejected for now: the small runner plus the policy is enough).
