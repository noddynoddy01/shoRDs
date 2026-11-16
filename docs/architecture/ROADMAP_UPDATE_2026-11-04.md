# Architecture and technical roadmap: update of 2026-11-04

Supersedes only the items named here; everything else in `TECHNICAL_ROADMAP.md` (2026-10-06) and the ADRs stands. Cost column is recurring money or attention.

## What changed in the architecture

1. **Evidence path.** Analyses now carry `evidenceSpans` (offsets into a stored chunk) per statement, checked by one shared guard (`backend/llm/claimGuard.js`) in production and in offline evaluation. A new read endpoint `GET /api/v1/papers/*/evidence/*?start&end` returns the cited sentence only when the paper's licence allows redistributing text. Response schema additions: `qualifiers`, `evidenceSpans`, drop counts. Cache keys include `INTEL_PROMPT_VERSION = 2026.3-intel`, guarded by a pinned fingerprint test. **ADR note to add (ADR-008):** any change to what the guard accepts changes cached-answer meaning and must bump the version.
2. **Discovery.** One OpenAlex client on the device (timeout, one retry for transient errors, no retry for 429, 10-minute cache, error classes) used by search and the feed. There is no backend search route; the client no longer pretends there is.
3. **Offline.** `offlineResearchService` v2 stores a brief, citations and metadata only. A PDF is cached only after byte verification (not yet reachable: no downloader).
4. **Test infrastructure.** `registerTs.js` loader lets `node --test` read the app's `.ts` services on Node 20 and 22; frontend logic is now under test.

## Reprioritised roadmap

### Before any external user (blockers)

| # | Item | Owner/approval | Difficulty | Op cost | Risk |
|---|---|---|---|---|---|
| 1 | Review and approve the F1 change (it alters which statements survive and invalidates cache). Then merge via a normal PR with CI. | Owner | S | none | Medium: user-visible, fewer statements shown |
| 2 | **Measure real summary quality** (50-paper study) and the guard's false-drop and miss rates. Until then nothing may be advertised as "verified" or "accurate". | Owner + 2 raters | M | rater time + ~50 analyses | Low |
| 3 | Production web build of the latest code on a normal PC; Lighthouse mobile; fix what it finds. | Owner machine | S | none | Low |
| 4 | Anthropic Console spend limit; verified database backup and one restore test; uptime monitor on `/ready`. (Unchanged from the 10-06 list; still unverified.) | Owner | S | none | Low |
| 5 | Place and run CI (Node 20 + 22, real Postgres/Redis). | Owner | S | none | Low |
| 6 | Look at the live Firebase rules and compare with `firestore.rules.PROPOSED` / `storage.rules.PROPOSED`. | Owner | S | none | Medium if rules are open |
| 7 | OpenAlex abstracts and caching rights: confirm acceptable use (D6 in the discovery audit). | Owner | S | none | Legal |

### Next (one to two months)

| Item | Why | Difficulty | Op cost |
|---|---|---|---|
| Backend search proxy + Redis cache with one server-side OpenAlex key | Shared limits and visibility; key off devices; stale-while-revalidate during provider trouble | M | none ($0 free key) |
| Evidence UI: show the cited sentence next to each statement via the new endpoint; show "n statements removed by checks" | Makes traceability usable | M | none |
| Replace the two hard-coded interests and constant relevance in the feed score with real signals (library topics, saved/dismissed), judged on a 50-100 query set by nDCG@10 | Ranking is currently not personal or relevant | M | low |
| Engagement and discovery events (spec in the discovery audit) with a privacy review | Cannot improve what is not measured | M | free tier of an analytics tool |
| PDF download + verification (needs `expo-file-system` and a hashing dependency; owner approval for new dependencies) | Offline PDFs | M | low |
| Gateway refactor ADR-005 / test C1 | Single place where AI calls and the guard live | L | low |
| Rename `savedCount` (holds citation count) with a stored-data migration | Wrong name will collide with a real saved metric | S | none |

### Later / only on a trigger

Postgres full-text search over the user's library; Semantic Scholar only after written licence clarification; embeddings only if the judged-set measurement shows lexical ranking is the limit; paid plans per the register's triggers.

## Honest scaling statement

Verified: the backend scales horizontally in tests with shared Postgres and Redis (multi-process integration tests). Not verified: any load figure, any production behaviour, device performance of the latest build. The first real constraint is likely the OpenAlex per-user rate limit on shared networks, then AI spend, not CPU.
