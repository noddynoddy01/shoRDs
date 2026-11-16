# Feed, search and discovery audit (2026-11-04)

Scope: how shoRDs finds papers (OpenAlex), what it does with them, how the feed ranks them, whether Semantic Scholar should be added, and what to measure. Everything about the live OpenAlex and Semantic Scholar services is from their public documentation read on 2026-11-03/04 (the build environment could not reach either API, so no live call was made and no latency or error rate was measured). Code facts are from the cloud copy of branch `p0-fixes`.

## 1. What the app does today

| Path | Code | Behaviour before this phase | After this phase |
|---|---|---|---|
| Search screen, domain feeds, live feed | `services/federatedSearch.ts` | First called `${API}/api/v1/search` (a route the backend does not have; always 404, so every search paid a failed round trip), then fell back to OpenAlex. No timeout, no cache, no error classes. Year range was accepted and ignored. Seven "source" chips (arXiv, Crossref, Europe PMC, CORE, DOAJ, PubMed, OpenAlex) all queried OpenAlex only. Showed "2026" when the year was unknown. | One OpenAlex client: 8 s timeout, one retry on 5xx/network/timeout, no retry on 429, 10-minute in-memory cache, in-flight de-duplication, errors classified (`rate_limited`, `timeout`, `network`, `server_error`, `bad_response`), year range and sort applied, unsupported filters returned in `ignoredFilters`. Source chips replaced by one honest line. Unknown year/author/abstract stay blank. |
| Home feed | `services/feedEngine.ts` | Own `fetch` to OpenAlex (`per-page=50`, sorted by `publication_date:desc`), no timeout or cache. | Uses the same client. |
| Venue / topic fields | both | Read `host_venue` (removed from OpenAlex) and `concepts` (deprecated), defaulted the topic to "Computer Science" in one path. | `primary_location.source` and `primary_topic`; default "General Science". |

OpenAlex facts used (help.openalex.org, 2026-11-03): `host_venue` removed, `concepts` deprecated in favour of `topics`/`primary_topic`; `mailto`/polite pool replaced by API keys; a 429 can mean the request rate **or the daily credit budget**; error responses cost 0 credits; backoff guidance 1 s, 2 s, 4 s with a timeout; `per_page` maximum 100; date filters `from_publication_date` / `to_publication_date`; `is_oa:true`. Pricing and limits (keyless basic queries about 10 requests/s; free key worth about $1/day of credits; paid tiers from $5k/year) are recorded in `TOOLING_PURCHASING_REGISTER.md`.

## 2. OpenAlex integration findings

| # | Finding | Severity | Status |
|---|---|---|---|
| D1 | The app queries OpenAlex **from every user's device**, keyless. Budget and rate limits are therefore per user IP, which is fine for a few users and a risk for shared networks (a campus or office NAT shares one allowance). A 429 for one person is invisible to you. | Medium now, High at scale | Mitigated in the client (no hammering; clear message). Architecture fix below. |
| D2 | Any key must stay off the device. The frontend audit test already forbids key handling in the two network files. | n/a | Held by tests. |
| D3 | Removed/deprecated fields were read. | Medium | Fixed. |
| D4 | No timeout, no retry policy, no error classes, no cache. A hung request left the screen spinning. | Medium | Fixed in the client; tested with a scripted `fetch` (cache hit, expiry, 429 not retried, 5xx retried once, timeout, bad JSON, de-duplication). |
| D5 | Feed ordering is "newest 50 matches of a keyword", so relevance is whatever OpenAlex's text match gives within a date sort. A sort by date on a search returns recent papers that only weakly match. | Medium (quality) | Not changed: changing ranking without a judged set would be a guess. See §4. |
| D6 | OpenAlex "does not ship plaintext abstracts for legal reasons" (its works-attribute page). The app rebuilds abstract text from the inverted index and stores it in device storage and the local registry. | Needs a decision | **Open for the owner**: confirm that displaying and caching reconstructed abstracts for personal reading is acceptable under the abstracts' publishers' terms and OpenAlex's terms. Not a code defect; a rights question. I did not find the data licence text in this session (OpenAlex data is widely described as CC0; I could not confirm it from the pages I could read), so treat both points as unverified. |
| D7 | `Paper.savedCount` is filled with the citation count (`cited_by_count`) and `feedEngine` reads either. The name is wrong and a real "saved" metric would collide. | Low | Pending (rename needs a data migration of stored papers). |
| D8 | No result de-duplication across pages in search; the feed de-duplicates by canonical id. | Low | Pending. |

## 3. Semantic Scholar: evaluation

What it offers (documentation read 2026-11-03): Academic Graph API, Recommendations API (related papers), Datasets, SPECTER2 embeddings; an unauthenticated shared pool and a keyed tier of about 1 request/second (introductory). Value to shoRDs: (a) citation context and influence data, (b) a "papers like this" list that is embedding-based rather than OpenAlex's topic overlap (`related_works` = "recent papers sharing the most topics", per OpenAlex).

Why not yet:
1. **Terms.** The licence requires attribution, restricts repackaging the API, says S2 Data can carry its own licences (some non-commercial), and is silent on caching and on machine-learning use; Semantic Scholar can terminate at will. Commercial use of a recommendation feature built on it needs written clarification from Semantic Scholar first. That is a question for them, not an assumption.
2. **Rate.** About 1 request/second per key cannot serve per-user requests from devices; it only works behind a backend cache.
3. **No measurement yet** that related-paper discovery is something users want from shoRDs.

Recommendation: do not integrate yet. Ask Semantic Scholar the licensing question (owner), and meanwhile ship OpenAlex `related_works` / `referenced_works` through the backend cache as the first related-papers feature, labelled for what it is ("shares topics"), never "similar".

## 4. Feed ranking and recommendation logic

`feedEngine.rankCandidatesMultiSignal` is described as a "multi-signal score = quality 0.25 + relevance 0.25 + recency 0.15 + user interest 0.15 + popularity 0.10 + citation 0.10". Read line by line:

| Signal | What the code does | Honest description |
|---|---|---|
| relevance (0.25) | constant `0.8` for every paper | **No relevance signal.** Contributes the same to all papers, so it changes nothing. |
| quality (0.25) | `1.0` if the record has a PDF link, else `0.6` | "Has a link", not quality. |
| recency (0.15) | `(year − 2000) / 26`, floor 0 | A linear year score tuned to 2026; years after 2026 exceed 1. |
| user interest (0.15) | 1.0 if the paper's topic label contains one of two **hard-coded** interests (`artificial intelligence`, `quantum computing`), else 0.3 | **Not the user's interests**; the callers do not pass any. |
| popularity (0.10) and citation (0.10) | the same variable (`savedCount`, which holds the citation count) divided by 500, capped at 1 | One signal counted twice (0.20 total). |

So the effective ranking is: has link, newer, cited, and topic label matches two fixed words. Nothing in the UI displays a score or a reason today (checked: no "because" text in `app/` or `components/`; `productionScaleService.ts` has two "Recommended because you follow …" strings, not wired to the feed), so nothing misleading is shown. **No fake explanation or relevance score was added in this phase, and none should be until a signal exists.** The rule going forward: any "why am I seeing this" text must be generated from a field that was actually used in the ordering, and the ordering must be reproducible from logged inputs.

What I did not change: the weights. Re-weighting without a judged set would swap one guess for another.

## 5. Measurable engagement and discovery metrics (to implement behind a privacy review)

Events (no free text, no query strings that could hold personal data; hashed user id): `feed_impression`, `feed_open`, `feed_save`, `feed_dismiss`, `search_submit`, `search_result_open`, `search_zero_results`, `search_error` (with class), `brief_open`, `brief_evidence_open`, `offline_save`.

| Metric | Definition | Why it matters | Healthy signal to look for (target to be set from a baseline, not assumed) |
|---|---|---|---|
| Search success rate | sessions with ≥1 `search_result_open` within 3 min of `search_submit` / sessions with `search_submit` | Did search find something | Baseline first |
| Zero-result rate | `search_zero_results` / `search_submit` | Coverage or query problems | Should fall after fixes |
| Search error rate by class | `search_error` by class / `search_submit` | Rate limits and outages as users see them | `rate_limited` near zero |
| Time to first result | `search_submit` → first results rendered, p50/p95 | Perceived speed | Measure; no target assumed |
| Feed open rate | `feed_open` / `feed_impression` | Is the ordering interesting | Compare variants only |
| Dismiss rate | `feed_dismiss` / `feed_impression` | Irrelevance signal | Lower is better |
| Evidence open rate | `brief_evidence_open` / `brief_open` | Do people check sources (trust behaviour) | Informational |
| Save-for-offline rate | `offline_save` / `brief_open` | Is offline reading used | Decide whether to keep investing |
| Day-7 return | users with a session 7 days after first | Stickiness | Baseline first |

An offline relevance measure needs judgements: take 50–100 real queries, have two people mark the top 10 results relevant or not, compute nDCG@10 and precision@10 for each ranking variant. That is the only way to decide between rankers; engagement alone rewards clickbait. Tooling for the kappa and comparison already exists in `backend/eval`.

## 6. Recommended architecture (no new paid infrastructure required to start)

1. **Backend search proxy** `GET /api/v1/search` that the app already tries to call (now removed from the client until it exists): the backend calls OpenAlex with **one server-side key** (free tier first), so limits are shared and visible, the key is never on a device, and errors can be logged and alerted.
2. **Shared cache in the existing Redis** (cache-aside, key = normalised query + filters + page, TTL 10–60 minutes, stale-while-revalidate on 429/5xx so a provider incident degrades to slightly old results instead of an error). The Redis layer, rate limiter and cache module already exist and are tested.
3. **Per-user and per-IP rate limits** on that route using the existing limiter.
4. **Related papers** from OpenAlex `related_works` / `referenced_works` through the same cache, labelled "shares topics".
5. **Later, if search quality is the product**: PostgreSQL full-text search (`tsvector`) over papers the backend has already retrieved, to rank the user's own library and recent history without a second vendor. Embeddings or a vector index are not justified before the judged-set measurement in §5 shows lexical ranking is the limit.
6. Defer Semantic Scholar until the licensing answer arrives.

Cost: $0 to start (free OpenAlex key, existing Railway and Redis). The first paid item that is worth it, if traffic grows, is the OpenAlex paid tier only if the free credit budget is exhausted; see the register.
