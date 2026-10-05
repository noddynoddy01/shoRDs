# ADR-001: Stay a modular monolith

- Status: Accepted (current), reviewed at each stage
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

The backend is one zero-dependency Node process containing the HTTP API and an in-process job worker, with clear module boundaries (`llm/`, `jobs/`, `papers/`, `security/`, `data/`). The team is small; operations time is the scarcest resource. See SCALING_ARCHITECTURE.md.

## Decision

Keep one deployable codebase. Separate **processes** (not services) from the same image when needed: first `ROLE=api` and `ROLE=worker` (ADR-003). No microservices, no service mesh, no Kubernetes.

## Trigger to revisit or advance

Split a *service* out only when one of these is measured: (a) a component needs a different scaling shape and process-level separation does not fix it, (b) a different team owns it with a different release cadence, (c) a hard isolation requirement exists (for example untrusted document parsing in a sandbox, ADR-017), (d) the code boundary is already clean and enforced by tests. Popularity is not a trigger.

## Consequences

One deploy, one rollback, one log stream, in-process calls with no network failure modes. Cost: a bug in one module can take down the process (mitigated by the process split and by supervision).

## Reversibility

Fully reversible. A module with a clean boundary can later be extracted; nothing about staying monolithic blocks that.

## Alternatives rejected

Microservices now (rejected: multiplies deploys, networks, failure modes and on-call load with no measured need); serverless functions per route (rejected: the in-process worker, long calls and connection pooling fit poorly).
