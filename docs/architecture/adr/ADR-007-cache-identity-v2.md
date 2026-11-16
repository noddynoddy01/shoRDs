# ADR-007: Cache identity v2 and a shared cache for public-paper analyses

- Status: Accepted (design); needs approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

The audit proved that changing tenant, project, query, depth, model, chunk text or paper identity invalidates cached results. Two gaps were found: the paper title was not in the key (C2) and cached bodies could carry a stale paper header (C4). Both have a fix **implemented in the local working tree** of branch `p0-fixes`, without a schema bump (the title and coverage reach the structured-analysis key; a cache hit has its paper header, coverage notice and document hash refreshed from the current request), together with a bump of `PROMPT_VERSION` / `INTEL_PROMPT_VERSION` to 2026.3 / 2026.2-intel for the prompt-safety and grounding changes, which orphans older entries (they expire by TTL; no flush). What remains of this ADR is the v2 design below: provider and validator version in the key, and the shared public-paper cache.

### Delivery state of the C2 / C4 / coverage-identity fix (as of 2026-11-01; update this table when the state changes)

| Stage | State |
|---|---|
| Implemented locally | **Yes** (working tree of `D:\shords`, branch `p0-fixes`; tests pass) |
| Committed locally | **No** (uncommitted; local `HEAD` `ab4d702` does not contain it) |
| Pushed to PR #1 | **No** (the remote PR head is `5c44517`, which does not contain it) |
| Merged | **No** (production `main` is `40989e1`) |

Do not describe this fix as "in PR #1" or "merged" until the corresponding row above is true. The fixes for security audit V-1, V-2, V-3, V-10 and V-12 are different: they are already on the PR head. AI cost dominates at scale and most requests concern the same public papers.

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
