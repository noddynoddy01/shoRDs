# ADR-005: Provider-agnostic AI gateway with a single adapter boundary

- Status: Accepted (design); implementation needs approval
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Anthropic-specific shapes (response blocks, usage fields, error classes, effort and thinking parameters) leak into seven modules today (`aiGatewayBoundary.test.js`). See AI_SUBSYSTEM_AUDIT.md and AI_GATEWAY_DESIGN.md.

## Decision

All provider calls go through one gateway with a normalised request/result/error contract. Provider specifics live only in `llm/anthropicClient.js` (and future sibling adapters). The boundary is enforced by the existing scanner test, converted from `todo` to enforced once the strangler migration finishes. Migration is eight small steps, each shippable and reversible.

## Trigger to revisit or advance

A second provider is added when: the provider has a sustained outage costing users, a price or capability difference justifies it, a contractual need exists, or quality testing shows a better model for a task. Until then only one adapter exists; the abstraction is justified by the audit gaps (token accounting, error normalisation, provenance) and not by speculation.

## Consequences

Model upgrades, deprecations and outages become configuration plus a recorded decision, not code edits in many places. Cost: some migration effort and a thin translation layer.

## Reversibility

Reversible; the strangler steps keep the old path until parity tests pass.

## Alternatives rejected

Call the SDK directly everywhere (rejected: the status quo, unmaintainable); adopt a third-party router product (rejected for now: adds a dependency and a data path for private content).
