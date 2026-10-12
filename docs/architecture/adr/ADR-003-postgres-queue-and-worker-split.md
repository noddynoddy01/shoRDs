# ADR-003: Postgres-backed job queue; split the worker into its own process when triggered

- Status: Accepted
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Jobs are rows in `analysis_jobs` with leases, attempts, idempotency and cancellation; Redis only wakes workers. The worker runs inside the API process today (`WORKER_CONCURRENCY` default 2, lease 120 s).

## Decision

Keep the Postgres queue (using `FOR UPDATE SKIP LOCKED` style claiming and lease expiry). Do not introduce a message broker. Add a `ROLE` setting so the same image can run as api, worker or both.

## Trigger to revisit or advance

Run a separate worker service when any one is true: API p95 latency degrades while jobs run; a worker crash or long job affects API availability; AI job volume needs more workers than API replicas; deploying the API should not interrupt jobs. Introduce a dedicated broker (for example SQS or a Postgres-compatible queue extension, not Kafka) only when sustained queue throughput exceeds what Postgres handles comfortably (order of hundreds of claims per second) or fan-out to independent consumers is needed.

## Consequences

Jobs are durable, inspectable with SQL, transactional with the data they create. Cost: polling and lease tuning; throughput ceiling far above projected need up to the 100K stage.

## Reversibility

Reversible. The job interface (enqueue, claim, complete, fail, cancel) can sit in front of another backend later.

## Alternatives rejected

Kafka (rejected: designed for log streaming at a scale and with operations cost shoRDs does not have); Redis lists or streams as the queue (rejected: durability).
