# Product-quality audit, 2026-11-03

Evidence labels: **[MEASURED]** I ran it and have the output; **[READ]** from reading the code, line references given; **[NOT MEASURED]** a claim I could not test here. No device, emulator or browser run was possible in this session, so nothing about on-screen frame rate or touch latency is measured. Scope: cloud copy of `p0-fixes`, uncommitted, nothing deployed.

## 1. Mobile reading and offline

| Finding | Evidence |
|---|---|
| The web bundle is one JavaScript file: 3,743,138 bytes raw, **918,458 bytes with gzip -9**. Brotli was not available to measure. No code splitting. | **[MEASURED]** on `D:\shords\dist`. **That build is dated 2026-09-30, before the Phase 7/8 and P0 changes**, so use it as the order of magnitude, not as the current size |
| Static assets in that build: 5,537,372 bytes in 38 files, of which **19 icon font files are 4,076,840 bytes** (`MaterialCommunityIcons.ttf` alone is 1,307,660) and one logo PNG is 1,440,271 bytes | **[MEASURED]** |
| Native packages are large: the release-candidate APK is 183,899,821 bytes (176 MB); the older phone APK is 83,257,350 | **[MEASURED]** file sizes (contents not inspected) |
| The service worker / offline web support: none found (no `serviceWorker`, no workbox) | **[READ]** grep over `app/`, `services/`, `components/` |
| `services/offlineResearchService.ts` (an offline brief cache) is **not imported anywhere**, so there is no working offline reading feature through it. Other services keep a few small AsyncStorage lists (saved ids, a 100-item feed cache in `liveFeedService.ts:53`) | **[READ]** zero call sites by grep |
| That unused service would also be wrong if wired up: it defaults an unknown licence to `"CC-BY-4.0"` when a paper is only flagged open access, treats any licence string containing "CC" as cacheable (that includes CC BY-NC-ND), and sets `pdfCached: true` / `OFFLINE_FULL_ACCESS` without downloading any PDF | **[READ]** lines 61-80 |
| Reading screen builds its "Research Brief" **on the device from the paper record's text** (regex and sentence splitting in `paperIntelligenceService.ts`, section building in `paperSummarizer.ts`), not from the backend's cited model analysis | **[READ]** `app/paper/[id].tsx:75`, `services/paperIntelligenceService.ts:197` |

Recommendations
- Do not move summarisation on to the device for model quality. Heuristic on-device briefs already exist; the only published on-device LLM measurement found was a Pixel 8 running models under about 4B parameters at over 30 s latency (secondary source; see the SIGMOBILE strategy). No shoRDs-specific measurement exists, so none is proposed.
- Cheap, safe first wins: ship only the icon fonts the app uses, and recompress the logo. Estimated saving is up to several MB of the 5.5 MB of assets, **[NOT MEASURED]** until the build is redone on a machine with `node_modules`.
- Offline: the realistic design is "save this brief and its citations" (a few KB per paper as JSON), which needs the cache service wired in and its licence logic replaced by `permissionsFor()` (a PDF is cached only when `redistributeText` is "yes"). Not changed here because the frontend cannot be type-checked or run in this container.

## 2. Feed performance

- The reel feed is a `FlatList` with `pagingEnabled`, `snapToInterval` and a viewability callback, and no `getItemLayout`, `windowSize`, `initialNumToRender` or `maxToRenderPerBatch`. Keys include the array index (`${item.id}-${index}`), which remounts rows if the list is ever reordered or prepended. **[READ]** `app/(tabs)/index.tsx:294-300`. Effect on a real device: **[NOT MEASURED]**.
- I first suspected the per-paper `await` loop in `feedEngine.ts` (step 2, eligibility) would add network latency. **I checked: `verifyAndResolveFullTextAsync` does no I/O** (it inspects the record and returns), so that loop is cheap. **[READ]** `services/fullTextResolver.ts:50-60`. Not a finding.
- Ranking, dedupe, "seen" filtering and diversity run on the client in `feedEngine.ts` using locally stored seen/dismissed ids. It calls OpenAlex directly from the app. **[READ]**. A rate limit or outage on OpenAlex therefore hits every user separately; there is no shared cache.

## 3. Search, discovery and recommendation

- **Every search makes a request that cannot succeed.** `services/federatedSearch.ts:65` calls `${EXPO_PUBLIC_API_URL}/api/v1/search`, and **the backend has no search route** (route table `backend/app.js:484-501`). The call 404s (or fails outright if `EXPO_PUBLIC_API_URL` is unset and the default `http://localhost:8000` is used on a phone), then the code falls back to calling OpenAlex directly. Cost: one wasted round trip per search, no timeout on the first call. **[READ]**.
- `services/searchRanker.ts` produces a "transparent score breakdown" with **fixed percentages (42/18/15/13/12) for every paper and a score of `95 - 2×rank`**; nothing is computed from the paper or the query. It is not imported anywhere today, so users do not see it. **[READ]** It should be deleted or replaced before any UI uses it, because showing it would present invented explanations of ranking.
- Discovery quality has no measurement at all: no click, save or dismiss rate is collected on the server, and I found no evaluation set for ranking. A recommendation system needs interaction data first; recommend only counting events (saves, dismisses, opens) before choosing a model.
- Search architecture options, smallest first: (1) remove the dead backend call; (2) add a thin backend `/api/v1/search` proxy with a shared cache so all clients share OpenAlex quota and a contact email, and so rate limiting and the project's header rules apply; (3) later, an index in Postgres over papers already retrieved (the `papers` table has only a primary-key index today; search over titles/abstracts would need `tsvector`). Nothing requires a paid vector database at current scale.

## 4. Summary quality and consistency

- There are **two summary paths that can disagree**: the on-device brief on the paper screen (heuristics, `paperSummarizer.ts`) and the backend's model analysis with server-owned citations (`backend/llm/intelligence.js`). A reader sees different text depending on which screen they open. **[READ]**.
- The backend path has strong integrity checks (every statement must cite chunks it was shown; numbers must appear in the cited chunks; unsupported statements are dropped). The device path has its own chunk-support check (`verifyClaimSemanticSupport`), whose strictness was not examined.
- New tooling in this branch measures both without calling a model: `backend/eval/summaryMetrics.js` (invented numbers, copying, length, readability) and `backend/eval/faithfulness.js` (claim by claim, with evidence spans). To compare the two paths, record the on-device brief for each benchmark paper (this needs the Expo dependencies on a developer machine) and score both. **[NOT MEASURED]**: no such comparison was run.
- Summary-level literature result worth knowing (secondary, arXiv 2512.23206): LLM summaries of scientific papers tend to be more extractive, longer than asked and harder to read than human ones. The `copying` and `readability` metrics exist to catch exactly this.

## 5. Evidence traceability

- Server side: evidence ids are issued by the server; the client cannot supply evidence. Chunk text is stored in `paper_chunks` and **not** returned by the paper endpoint. **[READ]**
- Gap: stored evidence is chunk-level. A reader cannot yet be shown the exact sentence supporting a statement; the faithfulness evaluator can compute character spans, but the production response does not carry them.
- The licence of the stored text is recorded per paper but nothing consults it before text is shown or exported. Fine today (only the requester sees analysis results); see `docs/evaluation/INTEGRATION_ASSESSMENT.md` for where the gate belongs once an evidence viewer exists.

## 6. Backend scaling and database efficiency

- **[MEASURED]** Spend-gate seed queries: on 2,000,000 synthetic `ai_usage` rows (100,000/day), project and user seeds took about 210-270 ms each (whole day scanned, about 30,000 buffer reads); with two composite indexes about 0.1-0.2 ms. Tenant (already indexed) 0.1 ms; global about 270-300 ms and unavoidable without a pre-aggregated table. **Fixed**: migration 3 adds `(project_id, created_at)` and `(user_hash, created_at)`; migration and startup tests pass (52/52) and a fresh database ends with five `ai_usage` indexes. Caveat: synthetic data, one machine.
- **[MEASURED]** The hourly usage report query took about 200 ms on the same table (24-hour window, 2.4 M rows scanned by the date index). Fine for an admin report, not for a hot path.
- `ai_usage` grows without bound (418 MB total, 60 MB for the date index, at 2M rows). No retention or rollup exists. Recommend a monthly rollup table and a retention rule before volume reaches the millions; nothing to do today.
- `papers` has no secondary indexes. Current lookups are by primary key (`paperService.js:85`), so this is fine until search over the table is added.
- Jobs: indexes on `(status, updated_at)` and `(project_id, created_at)` exist; `analysis_jobs` lookups are by id or by the unique idempotency index. **[READ]**.
- A noted-but-unfixed spend-gate behaviour (from the code review): a second concurrent identical request is denied with `DUPLICATE_IN_FLIGHT` rather than waiting for the first; a retried provider call that eventually succeeds is billed by the provider for the failed attempts but the ledger records only the successful one; and after a Redis flush the settle step can race with re-seeding. Details are in `docs/ops/P0_CODE_REVIEW_2026-11-03.md`; their worst-case effect on the ceilings was not bounded by a test.

## 7. UI responsiveness and visual consistency

Not assessed beyond reading: no screenshot or device run was possible in this session. `auth-redesign.png` and `emulator-screen.png` in the repo root are old captures and were not evaluated. Recommended next step needing the owner's machine: run the web build, record a Lighthouse report (free, built into Chrome), and capture the feed on a mid-range Android device.

## 8. Priority list

1. Wire a free uptime monitor to `/ready` and set the Anthropic Console spend limit (owner actions; see the purchasing register).
2. Remove the failing `/api/v1/search` call or implement the route (one small change; needs frontend type-check, so it was left for a machine with `node_modules`).
3. Delete or fix `searchRanker.ts` and `offlineResearchService.ts` before anything uses them.
4. Trim icon fonts and the logo; re-measure.
5. Collect interaction events before building any recommender.
6. Run the human benchmark, then compare the two summary paths.
