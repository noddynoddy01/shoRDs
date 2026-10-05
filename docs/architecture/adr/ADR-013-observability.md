# ADR-013: Observability: ids and events first, tools after, no invented metrics

- Status: Accepted
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Telemetry today is a request log line, the AI ledger, job timestamps and `/ready`. See OBSERVABILITY_STRATEGY.md.

## Decision

A single allow-listed event schema, one request id across logs, ledger and jobs, SQL-based alerts first, an external uptime monitor, an error tracker with body and header scrubbing, then log aggregation. OpenTelemetry tracing and a metrics stack only after more than one service exists or the SQL and log approach stops answering questions.

## Trigger to revisit or advance

When an incident cannot be diagnosed in 10 minutes with the existing signals, or a second service appears, add the next layer.

## Consequences

Cheap, actionable alerting with no privacy leakage (tested). Cost: aggregation requires a vendor decision.

## Reversibility

All additive.

## Alternatives rejected

Full tracing and metrics stack immediately (rejected: cost and maintenance exceed the benefit at this size).
