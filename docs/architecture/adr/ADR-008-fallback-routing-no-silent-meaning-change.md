# ADR-008: Fallback routing never silently changes the meaning of an analysis

- Status: Accepted (design)
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Outages, deprecations and limits will force routing decisions. A different model can produce a differently-meaning answer, and an answer labelled as the same analysis would be misleading.

## Decision

Fallbacks are classed `SAME_ANALYSIS_VERSION` (same model family and behaviour verified by evaluation; allowed automatically) or `DIFFERENT` (default disallowed; allowed only by explicit policy, and the result carries a visible label and a different cache identity). The local deterministic fallback is labelled as such, never cached as a normal result and never `VERIFIED`. Every route taken is recorded in `analysis_runs` (ADR-006).

## Trigger to revisit or advance

Review the class assignments whenever a model is added or a model's behaviour changes after evaluation.

## Consequences

Users and auditors can always tell what produced a result. Cost: a model evaluation step before a model may be classed SAME.

## Reversibility

Policy is configuration; reversible.

## Alternatives rejected

Automatic failover to any model (rejected: silent meaning change).
