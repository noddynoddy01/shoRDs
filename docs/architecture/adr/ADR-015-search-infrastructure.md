# ADR-015: Search starts as Postgres full-text search; a search engine only on evidence

- Status: Proposed
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Retrieval today is by provider APIs and chunk selection in code. Library-wide search across users' papers will be wanted.

## Decision

Use Postgres full-text search (and `pg_trgm` where needed) first. Embeddings and vector search, if justified, start with the `pgvector` extension in the same database.

## Trigger to revisit or advance

Move to a dedicated search service when measured p95 search latency stays above target after indexing and tuning, the index size no longer fits comfortably in memory, or relevance features (facets, typo tolerance, hybrid ranking) are product requirements the database cannot meet.

## Consequences

No new system to run until it earns its place. Cost: heavy search load shares the database (mitigated by a replica, ADR-004).

## Reversibility

Reversible; search is behind an interface.

## Alternatives rejected

Elasticsearch or a vector database now (rejected: operations cost without measured need).
