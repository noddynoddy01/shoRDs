# ADR-018: Scholarly provider usage, rate limits and licensing

- Status: Accepted (policy); terms review owed
- Date: 2026-10-06
- Deciders: project owner, with Claude as author of the analysis

## Context

shoRDs retrieves from public scholarly providers. Their rate limits and terms of use differ, and shared caching of derived analyses (ADR-007) depends on licence terms. These terms were **not verified** in this session.

## Decision

Respect each provider's published limits with a per-provider token bucket and the existing `RETRIEVAL_PROVIDERS` policy; identify the application in requests as the provider asks; cache metadata with the provider's permitted retention; store full text only where the licence permits; prefer open-access sources; never scrape pages that forbid it; record provider and licence per paper. Review each provider's terms before launch and annually.

## Trigger to revisit or advance

At each new provider, at each scale stage (volume can exceed polite limits and call for a partner or paid tier), and before the shared analysis cache is built.

## Consequences

Legal and operational safety. Cost: some papers will be abstract-only.

## Reversibility

Policy; reversible.

## Alternatives rejected

Fetch whatever is reachable (rejected).
