# ADR-006: Every analysis permanently records its provenance; auditable, not reproducible

- Status: Accepted (design); needs migration approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Cached bodies today carry the model and prompt version but there is no permanent record of which evidence, provider, schema and fallback produced a result, and chunks are overwritten on re-fetch.

## Decision

Add an append-only `analysis_runs` table and content-addressed `evidence_chunks`/`evidence_sets`. Each run stores provider, requested and served model, model version if provided, prompt and schema versions, analysis version, content hash, evidence-set version, timestamp, token usage, cost (or UNKNOWN), request id, status and fallback status. The `reproducibility` value is `NOT_GUARANTEED` for every hosted model. We say the result is **auditable** (we can show exactly what was sent and which model answered), never that it is **reproducible**.

## Trigger to revisit or advance

Revisit the `reproducibility` vocabulary only if a provider offers a documented determinism guarantee for a pinned model snapshot; even then record the provider's wording.

## Consequences

Disputes and quality investigations can be answered from data; old analyses stay interpretable after model changes. Cost: storage growth (partition per ADR-004) and a backfill with `UNKNOWN` for old rows.

## Reversibility

Additive tables; reversible by dropping the new tables before they are depended on.

## Alternatives rejected

Rely on the cache body only (rejected: evidence overwritten, no history); claim determinism with temperature 0 (rejected: not guaranteed by providers).
