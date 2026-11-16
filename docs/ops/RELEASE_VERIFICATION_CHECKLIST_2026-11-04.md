# Frontend and release verification checklist (exact, reproducible)

Date: 2026-11-04. Every row's **Result** column is the truth as of this document. "NOT RUN" means nobody has run it; nothing below may be described as passing, built or faster until its row is filled in with the output.

| # | Check | Result so far |
|---|---|---|
| 1 | `npm ci --legacy-peer-deps` clean install | NOT RUN here (npm registry unreachable from the cloud copy) |
| 2 | `npx tsc --noEmit` | **Passed** (exit 0) on the owner's machine with their `node_modules` (TypeScript 5.9.3), run in Phase 4 on a scratch copy whose key files have checksums identical to the cloud working copy, after the analysis panel, client and paper-screen wiring. Re-run after any further frontend edit |
| 3 | `npm run build:web` | **NOT RUN**. Metro could not run in either environment used so far |
| 4 | Bundle scan `node scripts/check_web_bundle.js dist` | NOT RUN (needs the build). Tool is tested in `securityAudit.test.js` |
| 5 | Lighthouse mobile | NOT RUN |
| 6 | `npm audit --omit=dev` | NOT RUN (advisory service unreachable here) |
| 7 | Backend tests on Node 22 (`npm run test:node`, `test:integration`) | **Phase 4, Node 22.23.4:** unit 530 tests, 529 pass, 0 fail, 0 skipped, 1 todo (known gap C1); also 529 pass with `--no-experimental-strip-types`; integration 219 of 219 pass, 0 skipped. Node 22 only |
| 8 | Backend tests on Node 20 | **NOT RUN.** Node 20 is the production image (`node:20-alpine`); this container has only Node 22 |
| 9 | CI on GitHub | **NOT RUN.** `.github/workflows/ci.yml` exists in the working tree but is untracked and has never executed. Phase 4 fixed one defect found by reading it (the TLS test needs a `redis-server` binary the runner does not have) |
| 10 | Real-device performance | NOT RUN |
| 11 | Analysis panel on the real paper screen (button-only, states, withheld-licence state) | **NOT RUN in the real app.** The real component source was rendered with react-native-web in headless Chromium (8 screenshots, `docs/ops/evidence/phase4-ui/`); the paper screen, real device layout, focus and screen-reader behaviour are unverified |
| 12 | Android release signing | **Fails the release gate:** release builds use the public debug key (`build.gradle` line 120) |
| 13 | Pilot of 3 benchmark papers and actual spend | **NOT RUN.** Needs the Console limit, local services and person-confirmed licences (see the benchmark preparation report) |

## 1. Install and build (any machine with network, Node 20 or 22)

```
git checkout p0-fixes            # after the owner has committed and pushed; not before
npm ci --legacy-peer-deps
npx tsc --noEmit                 # pass = exit code 0, no output
npm run build:web                # = expo export -p web, writes ./dist
echo "exit=$?"                   # pass = 0 AND ./dist/index.html exists
du -sh dist; find dist -name '*.js' -size +500k -exec ls -l {} \;   # record total size and every JS file over 500 KB
node scripts/check_web_bundle.js dist --public-firebase-key "<the EXPO_PUBLIC_FIREBASE_API_KEY value>"
                                 # pass = exit 0 (no secrets, provider hosts or server-only names in the browser bundle)
```
Record: Node version (`node -v`), npm version, exit codes, `dist` size, the largest JS files. Do not use environment values for `EXPO_PUBLIC_*` that are production secrets; the Firebase web key is public by design.

## 2. Lighthouse mobile
Use a **preview** of the built site, not production, so a change cannot be mistaken for the live site.
```
npx serve dist -s -l 4173 &       # local static server; or the Vercel preview URL (creating one is a deployment: owner approves)
npx lighthouse http://localhost:4173/ --preset=perf --form-factor=mobile --output=json --output=html --output-path=./lh/run1 --chrome-flags="--headless=new"
```
Run **5 times** (`run1` to `run5`) and report the **median** Performance score, LCP, TBT, CLS, total transfer size and the date; one run varies too much. Record the Lighthouse version (`npx lighthouse --version`). Compare against a baseline built from `main` the same way, on the same machine, the same day. Local-server results omit CDN and compression behaviour; say so, and repeat on the Vercel preview before drawing conclusions about production.
Pass criterion is the owner's to set; a suggested starting target for a research reader on mid-range phones is Performance >= 70 and LCP <= 4 s on the simulated mobile profile, to be revised once a baseline exists.

## 3. Dependency audit
```
npm audit --omit=dev --audit-level=high
echo "exit=$?"
```
Pass = exit 0. Any finding: record package, severity, whether the vulnerable code path is reachable in this app, and fix or accept in writing. The backend has no runtime dependencies (zero-dependency Node), so only the root `package.json` matters; confirm with `node -e "console.log(Object.keys(require('./package.json').dependencies||{}).length)"` and by checking the Dockerfile copies no `node_modules`.

## 4. Backend tests on Node 20 and Node 22
Needs PostgreSQL 16 and Redis 7 (CI uses service containers; locally use your own throwaway instances; **never point these at production**; the tests drop and recreate the public schema).
```
export TEST_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/shords_test
export TEST_REDIS_URL=redis://127.0.0.1:6379
export TEST_REDIS_AUTH_URL=redis://:<password>@127.0.0.1:6380    # a second Redis started with requirepass
# repeat the following under Node 20 and again under Node 22 (nvm use 20 / nvm use 22):
node -v
npm run test:node
npm run test:integration
```
Pass = `fail 0` and no skipped tests (CI fails on any skip; locally `grep -c "# SKIP"` of the output must be 0). Also run once with `NODE_OPTIONS=--no-experimental-strip-types npm run test:node` on Node 22 to prove the Node 20 TypeScript path works.

## 5. CI on GitHub
1. Owner decides to commit and push (not done). 2. The workflow file is `.github/workflows/ci.yml` (matrix Node 20 and 22, Postgres 16 and Redis 7 services, no-silent-skips step, frontend `tsc` job). It has **never run**, so expect to fix YAML or environment mistakes on the first push. 3. Open the pull request, wait for both matrix jobs, record the run URL and the pass/fail per job. 4. Only then treat "CI passes" as true. Branch protection requiring this check is an owner setting.

## 6. Real-device performance test
Devices: one recent mid-range Android phone and one iPhone, both on ordinary mobile data, not office Wi-Fi. Build: the Vercel preview of the exact commit.
- Cold start: close the browser tab, open the URL, stopwatch to first readable paper list. 5 times each; record median and worst.
- Search: a query of 3 words; time to results; then airplane mode and repeat to confirm the offline message and cached results.
- Feed scroll: 60 seconds of continuous scroll through the reel feed; note dropped frames (Chrome remote debugging Performance panel on Android; Safari Web Inspector on iOS) and any memory warning.
- Paper screen: open 10 different papers in a row; note any freeze above 1 second.
- Record device model, OS, browser version, network type, build commit, date and every number. No "feels faster" claims.

## 7. What may be said after each check
- After step 1 passes: "the web build completes". Not "production ready".
- After Lighthouse: the measured median numbers, dated, with the device profile.
- After audit: "no high or critical advisories in production dependencies on <date>".
- Performance improvements: only as a before/after pair measured the same way on the same machine.
