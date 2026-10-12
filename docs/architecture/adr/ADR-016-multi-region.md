# ADR-016: Single region first; multi-region only for resilience or latency requirements

- Status: Proposed
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Users are mostly in one geography today. The data tier is stateful, so multi-region is expensive.

## Decision

Stay single-region with a warm standby plan: backups and infrastructure definitions able to rebuild in another region. Serve static assets and cached public content from a CDN worldwide. Next step if needed is a cross-region read replica, then a pilot of active/passive failover. Active/active writes are not planned.

## Trigger to revisit or advance

Cross-region standby when the RTO of a regional outage is unacceptable to customers or contracts, or the share of users far from the region makes latency unacceptable (measured by real-user timing). Data-residency demands (enterprise or legal) are a separate trigger and may require regional deployments.

## Consequences

Predictable cost and simple operations. Risk: a regional outage means a restore-time outage until the standby exists.

## Reversibility

Reversible; each step is additive.

## Alternatives rejected

Active/active multi-region (rejected: consistency complexity far beyond need).
