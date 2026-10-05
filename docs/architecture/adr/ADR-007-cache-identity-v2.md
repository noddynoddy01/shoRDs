# ADR-007: Cache identity v2 and a shared cache for public-paper analyses

- Status: Accepted (design); needs approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

The audit proved that changing tenant, project, query, depth, model, chunk text or paper identity invalidates cached results. Two gaps remain: the paper title is not in the key (C2) and cached bodies can carry a stale paper header (C4). AI cost dominates at scale and most requests concern the same public papers.

## Decision

Bump `CACHE_SCHEMA_VERSION`, include a hash of the title and metadata that reach the prompt, and compute identity from a canonical serialisation of every analysis-relevant input (adding the schema version, evidence-set hash and provider). Add a second, **tenant-independent** cache for structured intelligence of public papers (keyed by paper content hash, analysis version, model, prompt/schema version), while private uploads and project-specific questions stay tenant-scoped. The tenant-independent cache stores only content derived from public text, never user questions.

## Trigger to revisit or advance

Ship identity v2 with the gateway migration. Ship the shared cache when AI cost exceeds a threshold the owner sets (suggested: when estimated monthly spend passes the point where a 30 to 60 percent saving is worth a week of work) and after confirming that provider terms and paper licences allow storing derived analyses (ADR-018).

## Consequences

Large cost reduction at scale, fewer duplicate calls. Risk: a wrong key leaks across tenants; mitigated by the scope rule (public-derived only), the existing test harness and a new cross-tenant test.

## Reversibility

A version bump orphans old entries harmlessly; flag-controlled; reversible.

## Alternatives rejected

Per-tenant caching only (rejected at scale: pays N times for the same paper).
