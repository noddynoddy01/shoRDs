# Phase 2 test and regression report (2026-11-04)

All runs on the cloud container (Linux), branch `p0-fixes`, last run 2026-11-04. Infrastructure: PostgreSQL 16.15 server (the cloud's own binaries, database `shords_test`, localhost only), two throwaway Redis servers on localhost (one password-protected). The `D:\Tools\pgsql-16.15` binaries were never extracted or run.

## Results

| Run | Command | Result |
|---|---|---|
| Backend unit + frontend logic tests, Node 22.23.4 | `npm run test:node` | 451 tests: **450 pass, 0 fail, 1 todo** (the todo is the planned gateway-boundary test C1, ADR-005) |
| Same with type stripping disabled (emulates Node 20, whose runtime cannot run `.ts` natively) | `NODE_OPTIONS=--no-experimental-strip-types npm run test:node` | 451: **450 pass, 0 fail, 1 todo** |
| Integration, real PostgreSQL + real Redis (+ password-protected Redis) | `npm run test:integration` | 199 tests: **199 pass, 0 fail, 0 skipped** |
| TypeScript strict type check of the frontend, on your PC copy of `node_modules` (TypeScript 5.9.3) | `tsc --noEmit -p tsconfig.json` on the updated sources | **exit 0, no errors** (re-run after the last source edits) |
| Migrations on a fresh database | `migrationSafety.integration.test.js`, run inside the integration suite | pass |
| Migrations on a representative existing schema | new `migrationUpgrade.integration.test.js` (4 tests): an old-shape database is upgraded, data preserved, re-running is a no-op | pass |
| P0 regression | P0 test files (`aiBudget`, `idempotency`, `migrationSafety`, `securityAudit`, `logSafety`, `cacheIdentityAudit`, `aiGatewayBoundary`, `rateLimit`, `readiness`, `jobs`) all inside the suites above | pass |
| P0 working-tree integrity | SHA-256 snapshot of the 25 files modified for P0 (taken at the start of the previous phase), compared again on 2026-11-04 | 20 identical; 5 differ: `backend/llm/aiBudget.js` (byte-identical to the saved post-fix copy: the earlier large-amount Lua fix, not touched this phase), `backend/app.js` (evidence endpoint), `backend/llm/intelligence.js` (F1), `backend/tests/node/cacheIdentityAudit.test.js` (re-pinned fingerprint), `package.json` (test lists, `--require` loader). Every difference is intentional and covered by the suites above |

A note on one earlier run in this session: a single integration run showed 2 failures. Cause: I started the password-protected test Redis with a password I then guessed wrongly when re-attaching; the "WRONGPASS" error is from that, not from the code. After restarting my own throwaway Redis with a known password the suite passed 199/199.

New tests this phase: `evidenceRegression` (39), `evidenceGaps`, `evidenceEndpoint.integration` (5), `migrationUpgrade.integration` (4), `frontendSearchOffline` (11), `deviceBrief` (2), `summaryBenchmark` (7), extended `frontendAudit` and `cacheIdentityAudit`. For the frontend search client, the offline service and the sentence splitter I **mutation-checked** the tests: I broke the code on purpose in several ways and confirmed the tests failed, so they are not passing vacuously.

## What did not run, and why

| Not run | Reason |
|---|---|
| Real Node 20 execution | No Node 20 in the cloud; emulated only (type stripping disabled). The production image is `node:20-alpine`. CI matrix [20, 22] will run it for real once the workflow is placed. |
| Production web build of the latest code (`npm run build:web`) | Metro did not finish on the mounted `node_modules` (slow mount, 175 s per-call limit, background processes killed). Cloud has no `node_modules`. |
| Lighthouse / mobile measurements of the latest build | Needs the build above and Lighthouse; neither available. |
| Frontend lint | The repository has no ESLint config; I did not invent rules. |
| Frontend component/unit tests (jest) | No jest setup in the repo; frontend logic is tested through the node:test harness (typescript transpile on the fly). |
| `npm audit` / dependency advisories | npm registry and GitHub advisory API unreachable from the cloud (403). Run `npm audit --omit=dev` on your PC for both package.json files. |
| Live OpenAlex / Semantic Scholar behaviour | No network to those hosts; client verified against a scripted `fetch`. |
| `summary_benchmark.js collect` | Needs OpenAlex; untested. `device`, `plan`, `score` were smoke-tested offline. |
| Railway plan/usage, live Firebase rules, production `/ready` | No authorised access; no production probing. |
| Real 50-paper benchmark with two raters | No raters, no network; will not be fabricated. |
| GitHub Actions workflow | Not placed (protected folder, no push). Not executed anywhere. |

## Reproduce

```
export NODE_PATH=<dir containing typescript>   # tests load the project's own TypeScript to read .ts files
npm run test:node
TEST_DATABASE_URL=postgres://.../shords_test TEST_REDIS_URL=redis://127.0.0.1:6379 TEST_REDIS_AUTH_URL=redis://:<pw>@127.0.0.1:6380 npm run test:integration
```
(The integration helper refuses to run unless the database name ends in `_test` and both services are on localhost.)
