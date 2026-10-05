# ADR-009: Budgeted AI calls with a server-side kill switch

- Status: Accepted (design); needs approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

There is no spend ceiling, pre-call estimate, circuit breaker or kill switch today (AI_COST_CONTROL_DESIGN.md).

## Decision

Reserve a computed maximum cost before every paid call and settle after; budgets per user, project, tenant, model and global; unknown-cost models denied by default; circuit breakers and cooldowns; a server-side kill switch (`AI_ENABLED` environment variable plus a Redis key) that clients cannot influence and that fails closed; observe mode before enforcement; and a provider-side spend limit as the outer wall.

## Trigger to revisit or advance

Budgets before the first paid external users (the provider limit today, observe-mode budgets soon). The kill switch before any public sign-up. Per-plan budgets when billing exists (ADR for billing, roadmap phase 9).

## Consequences

Bounded worst-case spend and fast containment. Cost: a few percent latency for the reservation, a chance of wrongly denying a legitimate burst (mitigated by observe mode and visible messages).

## Reversibility

Flags per layer; fully reversible.

## Alternatives rejected

Rely on rate limits only (rejected: not a spend control); rely on the provider limit only (rejected: no per-user protection, no graceful degradation).
