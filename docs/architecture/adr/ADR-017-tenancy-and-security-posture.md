# ADR-017: Application-enforced tenant isolation, with row-level security as a later defence in depth

- Status: Accepted (current); RLS proposed
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Isolation is enforced in application code with tenant and membership checks. The security audit's BOLA matrix passed. A missing check in a future endpoint would be a data leak.

## Decision

Keep the central authorisation helpers and the BOLA regression matrix as a gate for every new route. Add Postgres row-level security as a second line of defence once every query path carries tenant context (needs the repository layer and a per-request setting). Parse untrusted documents in a restricted worker when uploads exist. Fix the registered vulnerabilities (V-1, V-2, V-3, V-10, V-12) with approval.

## Trigger to revisit or advance

RLS when a second engineer joins, or before enterprise customers, or after any isolation bug; parser sandbox with the first upload feature.

## Consequences

Defence in depth. Cost: RLS adds query complexity and test effort.

## Reversibility

RLS is reversible by policy removal.

## Alternatives rejected

Separate database per tenant (rejected at this size).
