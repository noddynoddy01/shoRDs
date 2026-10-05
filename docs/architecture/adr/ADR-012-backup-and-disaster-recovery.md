# ADR-012: Backups, restore drills and recovery objectives

- Status: Accepted (targets); verification owed
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Whether the hosting platform's backups are enabled, their retention and their restore path were **not verified**. A backup never restored is not a backup.

## Decision

Objectives by stage: RPO 24 h and RTO 8 h now; RPO 1 h and RTO 4 h at 10K; RPO 5 min and RTO 1 h at 100K (point-in-time recovery); RPO 1 min and RTO 15 min at 1M+. An encrypted, versioned, off-platform copy of logical dumps (and later WAL) with object lock; a monthly restore drill into a scratch database with row-count and integrity checks, results recorded; documented runbooks per scenario.

## Trigger to revisit or advance

Tighten targets at each stage or when a customer contract demands it.

## Consequences

A tested path from loss to recovery. Cost: storage and a few hours a month.

## Reversibility

Fully reversible; additive.

## Alternatives rejected

Rely on the platform default untested (rejected).
