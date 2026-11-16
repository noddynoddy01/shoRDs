# Before / after product quality (2026-11-04)

"Measured" = I ran it and saw the number. "Expected" = follows from the change, not measured. Nothing here is a user-study result.

| Behaviour | Before | After | Evidence |
|---|---|---|---|
| Requests per search | 2 (a guaranteed 404 to `/api/v1/search`, then OpenAlex) | 1 (OpenAlex), cached 10 min, duplicate in-flight requests merged | Measured by test (scripted fetch counts calls); latency gain expected |
| Hung search | Spinner with no limit | 8 s timeout, one retry for transient errors, clear message for rate limit / offline | Measured by test |
| Unknown publication year | Shown as 2026 | Not shown | Measured by test |
| Source chips (arXiv, Crossref, PubMed, ...) | 7 chips, all queried OpenAlex | Removed; one line saying OpenAlex is searched; ignored filters reported | Measured by test |
| OpenAlex fields | Removed/deprecated fields read | Current fields | Checked against docs, not live API |
| Sentence splitting on "p = 0.05", "3.1 times faster" | Cut at the decimal point, fragments such as "1 times faster" in briefs | Whole sentences, decimals, abbreviations, initials, DOIs intact (known under-split: "p < 0.05. n = 12") | Measured by test; mutation-checked |
| "Saved for offline" | Marked cached with nothing stored; invented licence | Saves brief + citations + metadata; PDF `NOT_DOWNLOADED` unless bytes verified; unknown licence stays unknown | Measured by test |
| Device brief label | Looked like an AI analysis | "Built on this device by fixed rules, not an AI analysis" | Measured by test |
| Evidence for a statement | Chunk id only | Character offsets per statement + endpoint returning the sentence when the licence allows | Measured by integration test; no UI yet |
| Unsupported numbers/reversals/overclaims in AI analysis | Partly checked on headline fields | Every statement and field checked by one shared guard | Synthetic regression cases only (39); real-world rate unmeasured |
| Icon fonts in bundle | Whole icon library via barrel import | Only Ionicons family imported (44 files), enforced by a test | Import structure measured; bundle size not measured |
| Logo asset on screen | 1,440,271 bytes | 91,114 bytes (512 px) | File sizes measured; load time not measured |
| Reel/feed list rendering | Default list settings | Windowed rendering, fixed item layout | Expected smoother scrolling and lower memory; not measured |
| Dead code | `searchRanker.ts` implied ranking that never happened | Deleted, test guards it | Measured |
| Feed ranking | Constant relevance, hard-coded interests, citations counted twice | **Unchanged** (documented, no fake explanation added) | Code reading |
| Summary accuracy on real papers | Unknown | **Still unknown** | No study run |
