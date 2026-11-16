# Phase 2: change list and launch assessment (2026-11-04)

Branch `p0-fixes`, uncommitted, cloud copy. Local `D:\shords` has only my staged tarballs in `claude-deliverables-2026-11-03\` (new folder); no project file there was changed by me.

## A. Completed (in the cloud working copy, tested)

| Area | Files |
|---|---|
| F1 evidence validation | `backend/llm/claimGuard.js` (new), `backend/llm/intelligence.js`, `backend/eval/faithfulness.js` (new), tests `evidenceRegression`, `evidenceGaps`, fixture `evidence_regression.json`, `fingerprintProbes.js`, `cacheIdentityAudit` (re-pinned) |
| Evidence endpoint | `backend/app.js`, `backend/papers/paperService.js` (`loadChunk`), `evidenceEndpoint.integration.test.js` |
| Search / feed client | `services/federatedSearch.ts` (rewritten), `services/feedEngine.ts`, `app/search.tsx`, `services/searchRanker.ts` (deleted), `frontendSearchOffline.test.js` |
| Offline service | `services/offlineResearchService.ts` (rewritten, schema v2), `app/paper/[id].tsx` |
| Device brief | `services/sentenceSplit.ts` (new), `services/paperIntelligenceService.ts`, `services/papersStore.ts`, `deviceBrief.test.js` |
| Bundle and rendering | 44 files import `@expo/vector-icons/Ionicons`; `components/Logo.tsx` + `assets/logo-ui-512.png`; `app/(tabs)/index.tsx` list windowing |
| Benchmark tooling | `backend/eval/summaryBenchmark.js`, `scripts/summary_benchmark.js`, `summaryBenchmark.test.js` |
| Test infrastructure | `backend/tests/node/registerTs.js`, `frontendAudit.test.js`, `migrationUpgrade.integration.test.js`, `package.json` test scripts |
| CI (inactive) | `.github/workflows/ci.yml` |
| Docs | `docs/ops/*` (this phase and earlier), `docs/evaluation/*`, `docs/architecture/ROADMAP_UPDATE_2026-11-04.md`, `docs/ops/firebase/*.PROPOSED` |

## B. Pending (owner decision or follow-up work, nothing blocks safe code work except where noted)

1. Review F1 and approve merge; commit/PR/merge/push `p0-fixes` is yours to approve.
2. Place `ci.yml` in `.github/workflows/` and run it.
3. Native `npm run build:web` and Lighthouse on your PC; `npm audit --omit=dev`; real Node 20 run (CI will do it).
4. Evidence UI that shows the cited sentence (backend endpoint exists).
5. Backend search proxy with server-side OpenAlex key; Redis cache.
6. Feed score: real signals; judged relevance set.
7. Run the 50-paper study (needs network, backend analyses with spend cap, two raters).
8. Rename `savedCount`; result de-duplication in search.
9. Add `expo-file-system` and hashing dependency only if PDF caching is wanted.
10. ADR-008 (guard version policy), update ADR index; update CHANGELOG at merge time.

## C. Blocked (needs access or approval I do not have)

| Item | Blocked by |
|---|---|
| Production build, Lighthouse, device performance | no `node_modules`/registry in the cloud; mounted modules too slow for Metro |
| Dependency advisories | registry/advisory API unreachable |
| Live OpenAlex/Semantic Scholar behaviour; benchmark `collect` | no network to those hosts |
| Real human benchmark | no raters |
| Railway plan and usage; live Firebase rules; production `/ready` | no authorised access; no production probing |
| D6 PostgreSQL archive authenticity (`D:\Tools\pgsql-16.15`) | open owner decision; the binaries remain untouched |
| Any purchase, account, secret, billing change | approval rule |

## D. If I were responsible for launching shoRDs, what would I still refuse to release, and why?

I would not release any of these as they stand.

1. **Any claim that summaries are accurate, verified or grounded in the evidence.** There is no measurement of real summary quality: no human ratings, no false-drop rate and no miss rate for the guard, and the guard has documented misses (reversals without cue words, wrong attribution, paraphrased numbers). The honest product statement today is "AI summaries are checked by automatic rules and may still be wrong; open the source". Shipping "verified" in a research tool is the one error that destroys trust and cannot be walked back.
2. **The F1 change to production without your review.** It is the right direction, but it changes what users see and invalidates caches; it should go through a PR, CI on Node 20 and 22, and a manual look at a few real papers first.
3. **Public sign-up before the spend and recovery basics are verified.** The app's spend gate is tested, but the account-level ceiling (Anthropic Console limit), a verified database backup with one restore, and an alert on `/ready` are unconfirmed. One bad day without them costs real money or real data.
4. **Anything whose performance I have not seen.** I changed bundle size and list rendering and they are untested on a real build or a real phone. I would not publish performance claims, and I would build the latest code and run Lighthouse before shipping.
5. **The current Firebase rules, until someone has read the live ones.** Unknown rules on a production auth/data project are an unknown risk; my proposed rules are untested against the console.
6. **The home feed's ordering as "personalised" or "relevant".** It has no relevance signal and the "interest" is two hard-coded topics. As a plain "newest from your topic" feed it is fine; calling it recommendations would be false.
7. **Offline "saved for offline reading" for PDFs.** It no longer lies (briefs only, PDFs never marked cached), but there is no PDF download, so the feature is a saved brief. Describe it as that.
8. **Search at scale as designed.** Every device calls OpenAlex directly; shared networks will hit limits and you would never see it. Fine for a closed beta, not for a launch.
9. **Use of OpenAlex abstracts and Semantic Scholar data until the rights are confirmed** (D6 in the discovery audit; S2 terms are unresolved for commercial use).

What I would release: a closed beta with the F1 change reviewed, honest labels (rule-based brief vs AI analysis, "checked by rules", visible source links), the spend limit, monitor and backup checks done, and the 50-paper study scheduled so the first public accuracy statement is a measured one.
