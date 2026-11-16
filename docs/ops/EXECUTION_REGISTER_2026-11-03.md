# shoRDs execution register

Opened 2026-11-03 (after the owner moved the working model to autonomous execution). Every entry has evidence. Nothing is listed as done unless it was run and the output seen. No secrets appear here.

Scope labels used throughout: **LOCAL-PROJECT** (files in a checkout), **CLOUD-ENV** (the throwaway Linux container), **REMOTE-REPO** (GitHub), **PRODUCTION** (Railway, Vercel, live database).
Standing limits from the owner: no push, merge or deploy without asking; no production changes; no destructive database work; no overwriting or removing backups; no secrets in reports.

## 1. Access and capability assessment (2026-11-03)

| Area | Finding |
|---|---|
| Cloud container | Linux, root. Node 22.23, Python 3.13, git, unzip, redis-server, psql client and Postgres 16.15 server binaries. No 7z, no pwsh. |
| Cloud network | GitHub reachable. **registry.npmjs.org is refused by the proxy (HTTP 403 on CONNECT)**, so `npm ci` cannot run in the container. Not worked around. |
| Cloud repo copies | `/home/claude/shoRDs` (branch `p0-fixes`) and `/home/claude/shords` (branch `main`, tracks origin). |
| Owner device | Linked ("nod-e", Windows). The shell is a Linux VM that sees only connected folders: `D:\shords` and, after a granted request, `D:\Tools\pgsql-16.15`. Node 22, git and Python are available in the VM. Windows PowerShell cannot be driven (computer use gives terminals click-only access). |
| Protected paths | `D:\shords\.github\...` cannot be written through the device tools (reported as a protected file). |
| Project docs | 16 docs readable and writable through the Projects tool. |
| Not accessed (by rule) | Railway, production database, Anthropic keys, `.env` contents. |

## 2. PostgreSQL 16.15 Windows archive: verification (read-only; nothing extracted, installed or executed)

Scope: **LOCAL-PROJECT** none; the archive folder on `D:\Tools\pgsql-16.15` was only read. Scripts live outside it, in the device VM's home.

| Check | Result | Evidence |
|---|---|---|
| File size | 373254386 bytes | matches the expected size and the directory listing |
| SHA-256 recomputed independently on the device | `43BB45F1...CCAA8281` (full value below) | equals the value the owner's PowerShell run printed |
| ZIP central directory | 21799 entries (20256 files, 1543 directories); methods stored/deflate only; not encrypted; no comment | Python `zipfile` |
| CRC-32 of every file | 20256 of 20256 verified, 0 bad | streaming CRC compared with the stored value |
| Entry-name safety | none flagged: no absolute paths, `..`, backslashes, colons (alternate data streams), reserved device names, trailing dots/spaces, control characters, case collisions, duplicates, file/directory collisions; longest path 170 characters | script output |
| Symlinks | none flagged, **with a limit**: every entry was written by a DOS/FAT-style creator (create_system 0), so Unix mode bits do not exist and a symlink could not be encoded that way; the Windows reparse attribute was checked and is not set on any entry | script output |
| Layout | exactly one top-level folder `pgsql/`; `bin` has pg_dump, pg_restore, psql, initdb, pg_ctl, pg_isready, postgres and libpq | script output |
| Version | `pg_config.h` (two copies) says PG_VERSION 16.15 | read in memory |
| Static PE headers | all 73 PE files in `bin` are x86-64 (machine 0x8664) | parsed from headers |
| Runtime dependency | the 7 tools plus libpq import `vcruntime140.dll` and the Universal CRT forwarders. **`vcruntime140.dll` is not shipped in the archive**, so the Microsoft Visual C++ 2015-2022 x64 runtime must already be on the PC (not verified there) | import tables |
| Archive folder state afterwards | still only the one zip, same size | listing |

Full SHA-256: `43BB45F173A6F08CF1D29A97A6D8DEB119E8E8093A24C00D2D1001A0CCAA8281`.

**What this does not establish.** The hash is a local fingerprint, not proof of origin: the vendor publishes no checksum or signature (decision D6, transport trust, remains open and is the owner's). CRC and structure checks show the archive is intact and unsurprising, not that it is genuine. No binary has been executed, so "it runs on this PC" is untested, and the Windows PowerShell 5.1 compatibility of the backup procedure (Task 10) is still unresolved. The A7 backup package stays NOT READY.

Next backup step (not started, needs only an instruction): design extraction into a fresh staging folder, then a run-and-version check, then rehearse restore on a local scratch database only.

## 3. shoRDs code baseline (cloud copy of branch `p0-fixes`)

State: **LOCAL-PROJECT**, nothing pushed. The branch holds 10 commits not on `main`, plus 24 modified and 1 new file that are uncommitted (the same set exists in `D:\shords`). The owner's local checkout and the cloud copy differ only by one commit hash for the same message (`38de369` vs `ab4d702`).

| Suite | Command | Result |
|---|---|---|
| Backend unit | `npm run test:node` | 354 tests: 353 pass, 0 fail, 1 todo (the AI gateway boundary, a documented known gap) |
| Backend integration | `npm run test:integration` with a throwaway Postgres 16.15 and Redis in the container | 189 tests: 188 pass, 0 fail, 1 skipped (needs a password-protected Redis) |
| The skipped test, run alone with a password-protected Redis | `dataClients.integration.test.js` | 18 pass, 0 skipped |
| TypeScript | `tsc --noEmit` on `D:\shords` | 2 errors, both `router.push("/projects")` in `app/research/copilot.tsx`. Cause: the generated `.expo/types/router.d.ts` dates from 2026-06-04 and does not list the `/projects` route that exists in `app/projects.tsx`. A stale generated file, not a code defect; `expo start` regenerates it. |
| Lint, web build, frontend tests | not run | need packages that cannot be installed in the container (npm registry blocked); not attempted on the owner's machine because it would change `node_modules` |

Note on first integration attempt: three groups failed because my test database had no password and one test asserts that logs never contain the password (an empty string is "contained" in every log). Fixed by using a password. Nothing in the product changed.

Not yet measured: performance, dependency vulnerability scan (needs the registry), mobile builds.

## 4. Changes made

| # | Scope | Change | Verified how |
|---|---|---|---|
| 1 | CLOUD-ENV | Throwaway Postgres 16.15 and two Redis servers for tests; stopped and deleted afterwards | server version query; tests above; shutdown output |
| 2 | LOCAL-PROJECT (cloud copy only) | New `.github/workflows/ci.yml`: unit and integration tests on Node 20 and 22 against real Postgres and Redis (open and password-protected), fails when any test is skipped; no secrets; AI provider never called | YAML parsed; every test command and environment variable it uses was run locally with the same values. **The workflow itself has not run on GitHub.** Node 20 (the production image) has not been exercised. **Corrected 2026-11-03 (later):** the first version piped test output through `tee` without `pipefail`, which would have hidden test failures (demonstrated locally); fixed with `defaults.run.shell: bash` and a "no silent skips" check. The copy delivered earlier as `shords-ci.yml` was the old version; a corrected copy is delivered with the later report. |

Not done: copying the workflow into `D:\shords` (the `.github` path is protected for the device tools). The file was delivered to the owner as `shords-ci.yml`. Nothing was pushed or merged.

## 5. Open items and decisions

1. D6: whether to trust the EDB archive given no vendor checksum (owner).
2. Merge of `p0-fixes` to `main`, push, and any deploy: awaiting owner approval; the P0 hardening (spend gate, evidence integrity, idempotency, migration safety) is not live until then.
3. Commit the 24 uncommitted files? They exist only in the working trees (plus the bundle and patch in `D:\shords`). A local commit is low risk but changes the owner's branch; to be done on request or in the cloud copy.
4. Place `ci.yml` at `.github/workflows/` (owner or after approval of a push).
5. Frontend lint, web build, dependency scan: need npm registry access.
6. Roadmap "must do now" items that need the owner: spend limit in the AI console, uptime monitor, Firebase rules review, verifying platform backups.

## 7. ACM SIGMOBILE research task (2026-11-03, evening)

Scope: **LOCAL-PROJECT** (cloud copy of branch `p0-fixes`; nothing pushed, merged or deployed). Research used public web pages only; no ACM or SIGMOBILE account was used.

| # | Change | Verification |
|---|---|---|
| 3 | New `backend/papers/licensePolicy.js`, `backend/eval/summaryMetrics.js`, `backend/eval/benchmark.js`, `scripts/eval_summaries.js`, `docs/evaluation/example_cases.json`, `backend/tests/node/evalAndLicense.test.js`; `package.json` gains the test in `test:node` and an `eval:summaries` script | 11 new tests pass; deliberately breaking two rules made 5 fail and restoring made all pass; full unit suite 365 tests, 364 pass, 0 fail, 1 documented todo (unchanged); CLI exit codes 1 (failing case) and 2 (no arguments) observed |
| 4 | New `docs/research/SIGMOBILE_RESEARCH_STRATEGY.md` (also saved to the project as `claude/sigmobile-research-strategy-2026-11-03.md`) | claims tagged verified, secondary, recommendation or unverified, with sources |

Not wired into the running product. Integration suite was not re-run for this change (the change touches no code the integration tests load); that is a gap, not a result.

Finding that changes expectations: SIGMOBILE is a mobile and wireless systems community; it is not a source of summarisation, citation or recommendation methods. Value is in mobile feasibility and measurement. Details and the roadmap are in the strategy document.

Open decisions: whether to pursue a MobiSys 2027 Emerging Ideas submission (abstract due 2026-11-27; not recommended without a real measurement); ACM licence position for the pre-2026 catalogue is unverified.

## 8. Second-round engineering work (2026-11-03, 20:59 IST directive onward)

Scope: **LOCAL-PROJECT** (cloud copy of `p0-fixes`, uncommitted; nothing pushed, merged, deployed or purchased) and **CLOUD-ENV** (throwaway Postgres 16.15 and two Redis servers, stopped at the end). No PostgreSQL binary from `D:\Tools\pgsql-16.15` was extracted or run. No production system was contacted.

| # | Change | Verification |
|---|---|---|
| 5 | `backend/llm/aiBudget.js`: one-line fix, Lua `rid .. '|' .. string.format('%.0f', amount)` instead of default number formatting (amounts of 1e14 micro-USD or more were written in exponent form the same script could not read) | New `aiBudgetLargeAmount.integration.test.js` fails on the original and passes with the fix; diff against the pre-work snapshot shows exactly this line |
| 6 | `backend/data/migrations.js`: migration 3 `ai_usage_project_and_user_indexes` (13 added lines) | Fresh database ends at [1,2,3] with five `ai_usage` indexes; 52 migration/startup/readiness tests pass; before/after timing on 2,000,000 synthetic rows: project and user seeds about 230 ms to about 0.15 ms |
| 7 | `backend/papers/licensePolicy.js` rewritten: four separate permissions (inference, evaluation corpus, training, redistribution) with a stated basis and deed URL | 15 tests in `evalAndLicense.test.js` |
| 8 | New `backend/eval/faithfulness.js`, `agreement.js`, `benchmarkScoring.js`, `scripts/score_benchmark.js`, `docs/evaluation/*` (protocol, annotation template, development fixture, integration assessment) | 13 + 5 tests; the fixture is explicitly not human-rated |
| 9 | New `backend/tests/node/evidenceGaps.test.js` (1 passing, 3 `todo`): pins gaps in production evidence validation | Probe output: a narrative statement with an altered number, an invented number in a result's `context`, and a reversed result are all kept |
| 10 | `.github/workflows/ci.yml` corrected (pipefail, skip check) | See section 4, row 2 |
| 11 | New docs: `docs/ops/P0_CODE_REVIEW_2026-11-03.md`, `docs/ops/PRODUCT_QUALITY_AUDIT_2026-11-03.md`, `docs/ops/TOOLING_PURCHASING_REGISTER.md`; `docs/research/SIGMOBILE_RESEARCH_STRATEGY.md` updated | Each finding is labelled measured or read; prices were read from vendor pages on 2026-11-03 |

### Regression and integrity

| Check | Result |
|---|---|
| `npm run test:node` | 391 tests: 387 pass, 0 fail, 0 skipped, 4 todo (1 pre-existing, 3 new known gaps) |
| `npm run test:integration` (real Postgres 16.15, Redis open and password-protected) | 190 tests: 190 pass, 0 fail, **0 skipped** |
| Working-tree comparison by SHA-256 against the snapshot taken before this work | Of 25 recorded files, exactly 2 differ: `aiBudget.js` (item 5) and `package.json` (test wiring, `eval:summaries`); `migrations.js` additionally changed (item 6). Pre-existing untracked files (`dump.rdb`, `fingerprintProbes.js`, etc.) untouched. No P0 change overwritten |
| Not run | Frontend lint, web build, frontend tests, dependency audit (npm registry blocked); Node 20; the CI workflow on GitHub; any device or browser run |

### Findings that need an owner decision

1. **F1 (high):** production evidence validation does not number-check narrative statements or a result's `context`, and cannot see reversed meaning. Fixing it changes which statements survive and needs a prompt-version bump (protected area). Details: `docs/ops/P0_CODE_REVIEW_2026-11-03.md`.
2. **Railway runway:** the last recorded trial credit (2026-10-04) was about $4.85 with 25 days left; if exhausted, production stops. Smallest tier is Hobby at $5/month plus usage. Only the owner can see the dashboard.
3. **Search call to a route that does not exist** (`/api/v1/search`): wasted request per search; needs a frontend change checked with `tsc`, which needs `node_modules`.
4. Dead code with misleading behaviour: `services/searchRanker.ts` (fixed fake score breakdown), `services/offlineResearchService.ts` (invents a licence, flags PDFs as cached without downloading). Neither is imported today.
5. Unchanged open items: D6 (PostgreSQL archive authenticity), merge/commit/push of `p0-fixes`, placement of `ci.yml`, MobiSys 2027 Emerging Ideas (abstract due 2026-11-27, not recommended without a measurement).

### Purchasing summary (no purchases made)

Needed now: $0, or $5/month for Railway Hobby if the trial is over. Free, high-value actions for the owner: Anthropic Console spend limit, a free uptime monitor on `/ready`, Firebase rules check. Full register with prices and sources: `docs/ops/TOOLING_PURCHASING_REGISTER.md`.


## Phase 2 entry 2026-11-04

See `PHASE2_IMPLEMENTATION_REPORT_2026-11-04.md`, `PHASE2_TEST_AND_REGRESSION_REPORT_2026-11-04.md`, `PHASE2_CHANGE_LIST_AND_LAUNCH_ASSESSMENT_2026-11-04.md`, `DISCOVERY_AUDIT_2026-11-04.md`. Final results: unit 450 pass/0 fail/1 todo (Node 22 and type-stripping-off); integration 199/199; frontend tsc strict exit 0. Nothing committed, pushed, deployed or purchased.

## Phase 3 (2026-11-04): pre-merge review and closed-beta readiness
Nothing committed, pushed, merged, deployed or purchased; no production access. Unit 498 run / 497 pass / 1 documented TODO; integration 199/199 (Node 22 only). Not run: web build, Lighthouse, npm audit, Node 20, GitHub CI, device performance, backup restore, real-paper F1 review, 50-paper benchmark. Reports: `PHASE3_PRE_MERGE_REVIEW_AND_BETA_READINESS_2026-11-04.md` and companions listed there. Open owner decisions: D-P3-1, D-UI-1, D-UI-2, D-F1-1, D-B-1, D-B-2, D-C-1..4, D6, reviewers.
