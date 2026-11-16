# Phase 3: pre-merge review and closed-beta readiness

Date: 2026-11-04. Branch `p0-fixes` (11 commits ahead of `main`) plus 153 uncommitted working-tree entries. **Nothing was committed, pushed, merged, deployed, purchased or changed in production.** No secret was read or written. No paid model call was made.

## 1. Recommendation

**READY FOR OWNER REVIEW** (the branch and the working tree can be reviewed, committed and merged by you).
**NOT READY for a closed beta** until the "before any user" items below are done. The code is in better shape than the operations around it.

### What is ready (and how I know)
- Unit tests on Node 22: 498 run, 497 pass, 0 fail, 0 skipped, 1 documented pre-existing TODO (audit finding C1, gateway boundary). The same suite also passes with `--no-experimental-strip-types`.
- Integration tests (real PostgreSQL 16 and two real Redis servers, throwaway, local): 199 of 199 pass, 0 skipped.
- Frontend `tsc --noEmit`: exit 0 on your machine before the last two small component edits (below). The two edited files were checked for syntax only.
- P0 protections are intact (section 3). The spend-gate, cache-key, migration 3 and evidence-endpoint tests all pass.
- No secrets, dumps or generated files will enter a commit by accident (section 4), with the three exceptions in the defect list.

### What is still unsafe or unverified
1. **No production web build has run** (`npm run build:web`), so I cannot say the app builds after the 44 icon-import edits and the feed changes. No Lighthouse, no device performance, no `npm audit`.
2. **Node 20 has never run the tests**, and **CI has never run** (the workflow file is untracked). Node 20 is what production uses.
3. **No database backup has ever been restored.** There is no backup script in the repo.
4. **The evidence UI is not shown anywhere.** The building blocks exist and are tested; users still cannot see a cited sentence.
5. **The guard has not been validated** on real papers; it keeps most hand-built unfaithful statements (15 of 17). Summaries must not be called verified.
6. **Rights:** analysis and Copilot responses include excerpt text regardless of the paper's licence, while the evidence endpoint obeys it. Abstracts from OpenAlex/Semantic Scholar are used without a reviewed terms check.
7. Anthropic Console spending ceiling, uptime monitor and live Firebase rules review are owner actions not yet done.

### Decisions I need from you
See the table in `docs/ops/OWNER_ACTION_CHECKLIST_2026-11-04.md`. The ones that block progress: **D-P3-1** merge F1; **D-UI-2** apply the licence gate to response excerpts; **D-UI-1** project model for analysis UI; **D-F1-1** opt-in capture of raw model output; **D-B-1/D-B-2** benchmark ceiling and where to run it; **D-C-1** place the CI workflow; **D-C-2** untrack the crash log; and a decision to recruit two reviewers.

## 2. Method and limits of this review
I read the actual diffs and implementations of all backend files changed on the branch and in the working tree (app.js, migrations, aiBudget, aiPipeline, anthropicClient, intelligence, claimGuard, resultCache, paperService, cors, projects, promptSafety, licensePolicy, eval and script files), ran the full suites, hash-compared the P0 files with the snapshot, scanned all 151 changed or new files for secret patterns, and sampled the frontend diffs (44 mechanical import edits, paper screen, search, feed, offline service). **I wrote most of this code, so this is not an independent review.** A second reader, ideally a person, should read the guard, the spend gate and the evidence endpoint before merge. Frontend behaviour was not run on a screen.

## 3. P0 protections: verified intact
| Protection | Check | Result |
|---|---|---|
| Spend gate on every provider call | `spendGateWiring.test.js` (new): no module outside the gate reaches `callMessages`; readiness only probes; raw client is never passed to handlers | Pass |
| Dead bypass | `runCopilot.js` and `cachedCopilotQuery` could call the provider without the gate; both removed (no importers) | Fixed |
| Gate internals | `aiBudget.js` differs from the pre-Phase-2 snapshot only by the recorded large-amount Lua formatting fix; byte-identical to the recorded post-change copy; `aiBudgetLargeAmount.integration.test.js` passes | Pass |
| Cache identity | prompt version, schema version, model, depth, tenant, project, paper, content hash and query are in the key; `cacheIdentityAudit.test.js` pins the prompt/guard fingerprint | Pass |
| Cache hit freshness | paper header/coverage refreshed on hits (`refreshQuestionHit`, `refreshIntelligenceHit`) | Pass |
| Claim guard | present, per statement, bounded time (new test), limits documented | Pass with known limits |
| Migration 3 | applies once on fresh and on an upgraded database holding data, rows byte-identical, two replicas race safely, index really used (plan asserted with sequential scans disabled, strengthened in Phase 3) | Pass |
| Evidence endpoint | licence checked **before** the span length, so a restricted paper reveals nothing, not even chunk length (a leak found and fixed in Phase 3, with test) | Pass |
| Idempotency / projects / cors | integration tests pass; CORS lists exactly the routed methods | Pass |

## 4. Hygiene: what will and will not enter a commit
- Ignored: `dump.rdb` (a Redis dump in the repo root; present, ignored, **untouched**), `*.rdb`, `replay_pid*.log`, `hs_err_pid*.log`, `/benchmark/` (generated), now also excluded from the Docker and Vercel uploads.
- Secret-pattern scan over 151 changed or new files: only placeholders (`CHANGE_ME` in `.env.example`), CI service-container passwords for throwaway containers, a fake password inside a test (`hunter2pass` on a dead address), and the pre-existing compose default. No real key, token, connection string or private key.
- Already tracked, not caused by this work: `android/replay_pid29016.log` (4.4 MB JVM crash log; recommend `git rm --cached`), `android/app/debug.keystore` (the standard Android debug keystore; low risk, only if it is the template default), `assets/logo.png` and splash logo (1.4 MB each), two website images over 600 KB, `auth-redesign.png`, `emulator-screen.png`, `presentation.html` in the repo root.
- New binary: `assets/logo-ui-512.png` (91 KB, intended).
- Throwaway PostgreSQL and Redis used for tests live under `/tmp`, outside the repo.

## 5. Remaining defects
**Critical:** none found in the reviewed code. (The critical blockers for a beta are operational: items 1 to 3 under "unsafe" above.)

**High**
- H1 Licence not applied to excerpt text inside analysis and Copilot responses (rights; decision D-UI-2).
- H2 Production Node 20 and GitHub CI have never executed the suites (process; fix by running them).
- H3 No restore-tested backup (operations).
- H4 Web build, performance and dependency audit unmeasured (verification; checklist ready).
- H5 Guard keeps most adversarial unfaithful statements; no real-world validation (product risk, mitigated by wording and by showing the source sentence once the UI is wired).
- H6 Evidence UI not wired; analysis requires a project the app does not have (decision D-UI-1).

**Medium**
- M1 Raw model output not stored, so false drops cannot be measured (D-F1-1).
- M2 `computeConfidence` is a heuristic returned in the API; the UI must never show it (documented; UI components ignore it).
- M3 Daily default ceilings ($2 per user and per project) will interrupt a 50-paper benchmark run through one account (documented, section 6 of the spend estimate).
- M4 Migration 3 takes a brief write lock on `ai_usage` while the index builds (a fraction of a second at current size; deploy outside peak).
- M5 Three number tokenisers with small differences (`numbersIn`, `guardNumbers`, device brief): maintenance risk.
- M6 `docker-compose.yml` default Postgres password `shords_secure_password` (pre-existing; local use only, change before anyone reuses it).
- M7 Legacy offline storage key `shords_offline_cached_papers` is discarded without migration (users lose old saved briefs once).
- M8 About 40 services and 17 components are never imported (dead code, pre-existing); `ClaimCard.tsx` colours a status "VERIFIED" green, which the client can never produce. Harmless today, misleading if ever fed.

**Low**
- L1 Evidence endpoint distinguishes "chunk exists" (200) from "no such chunk" (404) for restricted papers; no text or length leaks.
- L2 `android/replay_pid29016.log` tracked; debug keystore tracked.
- L3 Large images tracked.
- L4 CORS no longer lists DELETE (no DELETE route exists; add the verb together with a route).
- L5 One TODO test (audit C1) is expected failing/pending by design.
- L6 `SourcePanel`/`CopilotResponse` showed "Verified: N claims" (always 0 because the client never emits VERIFIED). **Fixed in Phase 3:** now "Statements: N (automatic checks only, not verified)". The two files are syntax-checked only; the device `tsc` run is pending (the device bridge was disconnected).

## 6. What Phase 3 changed (summary; full list in `PHASE3_FILE_INVENTORY_2026-11-04.md`)
Evidence endpoint ordering fix; removal of the dead gate-bypass module; stronger migration index assertion; CSV-injection hardening of rater sheets; ignore rules; guard limits register and review kit; evidence display model and components (unwired); benchmark collection workflow test and selection record; offline cost calculator; honest wording in the Copilot panel; reports and checklists (this file, F1 review, evidence UI plan, spend estimate, release checklist, owner checklist).

## 7. Closed-beta readiness checklist
**Before any user (all required)**
- [ ] Anthropic Console monthly spend limit set; dedicated key
- [ ] Backup taken and restored into a scratch database, row counts compared
- [ ] Uptime monitors on `/ready`, `/health` and the web app, alert tested
- [ ] Live Firebase rules diffed against the proposed rules
- [ ] Branch committed by you; CI green on Node 20 and 22
- [ ] `npm run build:web` completes, bundle scan clean, `npm audit --omit=dev` has no high or critical findings
- [ ] Decision D-UI-2 made and, if "gate", implemented with tests
- [ ] Product text reviewed: no "verified", "accurate" or "guaranteed" anywhere users see summaries

**Before inviting beyond a few trusted users**
- [ ] Evidence UI wired and checked on a phone-width build and a real device
- [ ] Lighthouse mobile median and real-device timings recorded
- [ ] F1 review on 5 to 10 CC BY papers by two readers (needs D-F1-1 for false drops)
- [ ] OpenAlex terms and key decision recorded; abstract-use rights confirmed
- [ ] Railway plan/usage reviewed; per-user limits chosen for beta
- [ ] 50-paper benchmark run (approve ceiling first: about $25) and rated by two independent people

## 8. Companion documents
`docs/evaluation/F1_REVIEW_2026-11-04.md`, `docs/evaluation/F1_REVIEW_KIT.md`, `docs/ops/EVIDENCE_UI_PLAN_2026-11-04.md`, `docs/ops/BENCHMARK_SPEND_ESTIMATE_2026-11-04.md`, `docs/ops/RELEASE_VERIFICATION_CHECKLIST_2026-11-04.md`, `docs/ops/OWNER_ACTION_CHECKLIST_2026-11-04.md`, `docs/ops/PHASE3_FILE_INVENTORY_2026-11-04.md`.
