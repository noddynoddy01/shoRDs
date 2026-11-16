# Phase 6 / 03 – Claim-guard fix: direction reversal and ordered "from X to Y" (F-5-1, F-5-2)

Status: **IMPLEMENTED, TESTED**. Not committed, not deployed. Prompt/cache identity bumped to `INTEL_PROMPT_VERSION = "2026.4-intel"`.

## What changed (`backend/llm/claimGuard.js`)
- **F-5-1 direction.** The direction lexicon now includes third-person and -ing forms (rises/rising/risen, grows, gains, climbs, boosts, raises, surge, jump; falls/falling/fallen, drops, declines, decreasing, loses, lowers, shrinks/shrank, plunge, diminish…). The overlap used to decide "same subject" now ignores the direction words themselves, so "Latency rises" and "Latency falls" are recognised as the same statement with opposite directions, and "Throughput rises" against "Latency falls" is not.
- **F-5-2 order.** New `orderedChanges()` extracts `from X to Y`, `X -> Y` / `X → Y`, and `to Y from X` (units, % signs, negative numbers and the Unicode minus handled). New `orderConflict()` drops a statement only when its pair is absent from the cited evidence and the reversed pair is present. Reported as `REVERSED_MEANING` with detail `ORDER`, so counters and the UI need no change.
- Unchanged: NUMBER, NEGATION, OVERCLAIM, HEDGE and SCOPE checks. A change whose numbers are not in the evidence is still caught by the number rule first.
- New patterns were tested on pathological text (thousands of repeated "from 1", long digit runs): bounded time (< 3 s for the whole set).

## Tests
- `backend/tests/node/claimGuardDirectionOrder.test.js` – 42 tests, each negative case paired with a positive twin that must still be kept (same-side synonyms, same change written the other way round, evidence containing both orders, different subject, no ordered-change syntax).
- Existing suites re-run: `evidence_regression.json` (fixture m01 – "raised the median error from 6.2 to 3.9" against evidence that it fell – now expected **dropped**, which is the intended behaviour change), claim-guard, summary regression, cache identity (`cacheIdentityAudit.test.js` re-pinned to `038765b54e2dc768` after verifying the new probe outcomes), native pipeline (F-5-1 / F-5-2 are now real tests, not todos).
- Full suite: 626 tests, 625 pass, 1 todo, 0 fail.

## Before / after (`scripts/guard_before_after.js`, frozen pre-fix guard in `docs/phase6/evidence/claimGuard.before.js`)
MEASURED on **synthetic** fixture texts only; not a rate on real papers.

| Probe set | n | Dropped before | Dropped after |
|---|---|---|---|
| Faithful sentences cited against themselves (false-drop control) | 97 | 0 | **0** |
| Same-direction synonym rewrites (must be kept) | 13 | 0 | **0** |
| Direction flipped (should be dropped) | 13 | 8 | **10** |
| Ordered pair swapped (should be dropped) | 6 | 0 | **6** |

One verdict changed among 55 hand-written cases: m01 (above), KEPT → dropped.

## Remaining gaps (recorded in the test file so they stay visible)
- Flips whose only direction word is a noun that is also on the list ("gains" → "decreases"), and sentences with two directions ("accuracy rises and latency falls"), are still kept. Mixed-direction sentences are deliberately not judged by this rule.
- Reversed comparisons with no direction word and no ordered change ("A beats B" vs "B beats A") are still kept.
- Three flips in the synthetic set are still missed (two "gains" → "decreases", one mixed sentence).

## Cache and deployment impact
Entries cached under `2026.3-intel` become unreachable (new key), so summaries regenerate on first use after a future deploy. Nothing was deployed; production behaviour is unchanged until the owner approves a merge.
