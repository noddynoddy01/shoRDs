# ADR-014: Object storage for uploaded and large documents

- Status: Proposed (not needed yet)
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

Papers and chunks are stored as database rows. Uploaded files and full texts at scale would bloat the database and its backups.

## Decision

When uploads exist, store file bytes in object storage (private bucket, server-side encryption, short-lived signed URLs, content-addressed keys, malware and type checks before parsing, size caps) and keep only metadata and extracted chunks in Postgres.

## Trigger to revisit or advance

Introduce when users can upload files, or when stored text exceeds roughly 20 percent of database size, or the backup time becomes a problem.

## Consequences

Smaller backups, cheaper storage, safer parsing boundary. Cost: a second durability system with its own backups and lifecycle rules.

## Reversibility

Reversible while the metadata keeps a pointer type.

## Alternatives rejected

Store blobs in Postgres at scale (rejected beyond the threshold).
