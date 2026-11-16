# Phase 4 change report: file by file, with test results and evidence

Date: 2026-11-04. Branch `p0-fixes`. **Everything is uncommitted.** Nothing was committed, pushed, merged, deployed, purchased or run against production; no account setting was changed; **no paid model call was made (spend $0.00)**.

## 1. What the six approved items became

| # | Approved item | Result | Evidence |
|---|---|---|---|
| 1 | Licence gate on excerpts in analysis and Copilot responses (D-UI-2) | **Done.** One pure function, `gateResponse`, runs in the pipeline's single `finish()` on every response (fresh, cache hit, de-duplicated) with the paper's **current** licence. Text is served only for CC0, public domain and CC BY. CC BY-SA and CC BY-ND ("review"), CC BY-NC and unknown ("no") are withheld | 5 unit + 4 integration tests incl. a cache hit after a licence change (no extra model call) |
| 2 | One auto-created personal project per user (D-UI-1) | **Done.** `POST /api/v1/projects/personal`; id derived from the uid (`prj_` + 18 hex), `INSERT ... ON CONFLICT DO NOTHING`, creator only, **no schema change, no migration** | 7 integration tests incl. idempotent, per-user, concurrent first taps |
| 3 | Opt-in benchmark-only raw model output capture (D-F1-1) | **Done.** Off unless `BENCHMARK_RAW_CAPTURE=1` **and** an absolute `BENCHMARK_RAW_CAPTURE_DIR`; refuses to start when `NODE_ENV=production` or any Railway/Vercel/Kubernetes variable exists; no request path can enable it; separate 0700 directory, 0600 files, licence-gated text, no user data | 5 unit + 5 integration tests; a unique canary string is absent from responses, job rows, usage rows and logs with capture off **and** on |
| 4 | Evidence UI on the paper screen, explicit user-triggered analysis | **Done.** `AnalysisPanel` on `app/paper/[id].tsx`. The only call site of `runAnalysis` is the `run` callback bound to a button; nothing runs when a paper opens | 13 source and logic tests; screenshots of the real component (section 5); `tsc` exit 0 |
| 5 | Node 20/22 CI workflow (D-C-1) | **Included, never executed.** Found and fixed one defect (section 3). Validated as YAML only | not run on GitHub |
| 6 | Remove `android/replay_pid29016.log` from Git tracking, keep the file | **Done in the index only** (`git rm --cached`, staged deletion, **not committed**); the 4.4 MB file is still on disk; `.gitignore` already matches `replay_pid*.log` | `git status` shows `D  android/replay_pid29016.log`; file listed on disk |

Safeguards, each checked: the claim guard (`claimGuard.js`) was **not changed**; no summary is described as verified or guaranteed (a test fails if any copy string or panel text contains verified/accurate/guarantee/confidence...); the heuristic confidence score is **not exposed** (the response gate reduces `confidence` to `{level, basis}` and the view model never reads it); restricted excerpts are never shown (server withholds, card says so and links to the paper); no automatic analysis; raw capture is separate from user data and logs; spend gate (`aiBudget.js`), idempotency and cache identity untouched (aiBudget.js is byte-identical to its Phase 3 state; cache key code unchanged).

## 2. File-by-file (Phase 4 only; earlier phases' files are in their own reports)

### Backend, new
| File | What it is |
|---|---|
| `backend/llm/responseGate.js` | `gateResponse(body, paper)`, `stripConfidence`; adds `textPolicy` (`INCLUDED` or `WITHHELD_BY_LICENSE`, licence, reason, notice, `verbatimFieldsRemoved`); removes `evidence[].text` (marks `textAvailable:false`), replaces the extractive local answer, nulls `EXTRACTED_VERBATIM` items; pure |
| `backend/eval/rawCapture.js` | env-only capture config and writer (section 1 item 3) |
| `backend/eval/benchmarkRun.js` | gates and loop of the local pilot runner (see the benchmark preparation report) |
| `scripts/benchmark_run_local.js` | the paid pilot CLI. Refuses without `--confirm-spend`, ceiling over 25, non-local environment, cache on, capture off, unconfirmed licences |
| `backend/tests/node/responseGate.test.js`, `responseGate.integration.test.js`, `personalProject.integration.test.js`, `rawCapture.test.js`, `rawCapture.integration.test.js`, `benchmarkRun.test.js`, `benchmarkRun.integration.test.js` | tests for the above |

### Backend, modified
| File | Change |
|---|---|
| `backend/llm/aiPipeline.js` | requires the gate; `finish(out, ctx, paper)` applies it; all four `finish` calls pass `paper`; passes `captureRaw` to intelligence |
| `backend/llm/intelligence.js` | `captureRaw` hook invoked after the model answers and before validation (injected dependency; absent by default) |
| `backend/runtime.js` | loads the capture config (throws on a refused environment, so the process does not start), logs one warning line when on, passes the hook |
| `backend/security/projects.js` | `personalProjectId`, `ensurePersonalProject`, `PersonalProjectUnavailableError` |
| `backend/app.js` | route `POST /api/v1/projects/personal` (before `POST /api/v1/projects`) |
| `backend/tests/node/cacheIdentityAudit.test.js` | **one test adjusted, see 4.** |
| `package.json` | new test files added to `test:node` and `test:integration` allow-lists |
| `.env.example` | documents `BENCHMARK_RAW_CAPTURE` and `BENCHMARK_RAW_CAPTURE_DIR` (both empty) |
| `.github/workflows/ci.yml` | adds a step installing the `redis-server` binary (section 3) |

### Frontend, new
| File | Role |
|---|---|
| `services/analysisClient.ts` | `runAnalysis` (personal project, ONE Idempotency-Key per tap, same key if the start request is repeated, bounded polling, outcomes DONE / UNAVAILABLE / FAILED / STOPPED / TIMED_OUT; never reads `confidence`), `backendPaperRef`; no runtime import so it loads under Node's test runner |
| `components/research/AnalysisPanel.tsx` | `AnalysisPanelView` (drawing) and `AnalysisPanel` (sign-in state, the one run function, forgets results on paper or user change) |
| `backend/tests/node/analysisUi.test.js` | 13 tests (see 4) |

### Frontend, modified
| File | Change |
|---|---|
| `app/paper/[id].tsx` | imports and renders `<AnalysisPanel paper={paper} />` before the bottom button |
| `services/auth/apiClient.ts` | optional `Idempotency-Key` header (validated `^[A-Za-z0-9_.:-]{1,128}$` **before** any request); no other header can be set; Authorization cannot be overridden |
| `services/evidenceModel.ts` | `aiUsed`, `textWithheld`, `license` fields; two copy strings; `resultAsStatement` |
| `components/research/EvidenceStatementCard.tsx` | optional test/preview props only (`loader`, `preview`); the app passes neither |
| `components/research/EvidenceSummaryNote.tsx` | shows "no AI model was used" and "licence does not allow text" notes |
| `services/copilotMapping.ts` | adds a limitation line when the server withheld excerpt text for licence reasons |

## 3. CI workflow: what I validated and what I fixed
Validated: parses as YAML; two jobs (`backend` with Node 20 and 22, `frontend-types`); service containers Postgres 16 and Redis 7; second password-protected Redis; env names match what the tests read (`TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_REDIS_AUTH_URL`); the "No silent skips" step fails on any skipped test.
**Defect found and fixed:** `backend/tests/node/redisTls.test.js` starts its own `redis-server` and `openssl`, and **skips** if the binary is missing. The runner image does not provide a `redis-server` binary (the Redis service is a container), so that test would have skipped and the no-silent-skips step would have failed the first run. I added a step that installs the package without starting it (a `policy-rc.d` stops apt from starting a system Redis on port 6379). Not verified on GitHub; a `ubuntu-latest` image change could still break it.
Other unverified assumption: `node --test` prints TAP when output is piped (true on Node 20 and 22, which the workflow targets; the `# skipped` line the step greps is TAP).

## 4. Test results (Node 22.23.4, throwaway PostgreSQL 16 and two Redis 7 servers on this container)

| Run | Result |
|---|---|
| `npm run test:node` (default Node 22) | **530 tests: 529 pass, 0 fail, 0 skipped, 1 todo** |
| same with `NODE_OPTIONS=--no-experimental-strip-types` (the transpile path Node 20 uses) | **530 tests: 529 pass, 0 fail, 0 skipped, 1 todo** |
| `npm run test:integration` | **219 tests: 219 pass, 0 fail, 0 skipped, 0 todo** |
| `tsc --noEmit` on the owner's machine (scratch copy of this working tree, owner's `node_modules`, TypeScript 5.9.3), file checksums identical to the cloud copy | **exit 0, no output** |

The one todo is the existing, documented known gap (audit finding C1, provider boundary; needs the gateway refactor ADR-005). **One existing test had to change**, and I want the change reviewed: `cacheIdentityAudit.test.js` ("changing the coverage label ... is a cache miss") asserted `confidence.factors.coverage` in the served response. Phase 4 deliberately removes the heuristic confidence factors and score from every response, so the assertion could no longer hold. I kept the real intent (cache miss, new model call, new `contentCoverage`, hit afterwards) and replaced the factor assertions with checks that `factors` and `score` are **not** served and a coarse `level` still is. The weight derived from coverage is still computed server-side; it is simply no longer visible, so this test no longer proves it.

**Not run, and not to be described as passing:**
| Item | State |
|---|---|
| Node 20 | NOT RUN (only Node 22 here; the transpile-path run is a proxy, not Node 20) |
| `npm run build:web` and the bundle scan | NOT RUN (Metro does not run here or in the owner environment so far; the visual evidence below used a separate esbuild bundle, not the production build) |
| Lighthouse | NOT RUN |
| `npm audit` | NOT RUN |
| GitHub CI | NOT RUN |
| Real-device and real-browser tests of the actual app | NOT RUN |
| Anthropic Console limit | NOT CONFIRMED (owner only) |
| Any real paper, real licence or real model call | NONE |

## 5. Evidence of the wired UI
The paper screen itself could not be run (needs the Expo build, router and auth). What I did instead, and what it does and does not prove:
- `app/paper/[id].tsx` contains `<AnalysisPanel paper={paper} />` (test-checked); `tsc` passes with it.
- The **real** `AnalysisPanelView`, `EvidenceStatementCard` and `EvidenceSummaryNote` source files were bundled with esbuild and `react-native-web` (React 19.2.8, not the project's 19.1.0; `react-native-web` and its dependencies taken from the owner's `node_modules`) and rendered in headless Chromium at 390 px, device scale 2, fed with view models produced by the **real** backend validator on the fictional fixture paper. Icons are replaced by plain glyphs; the theme tokens are the real ones. 8 states in `docs/ops/evidence/phase4-ui/`: `idle.png` (button, "Nothing runs until you press the button"), `running.png`, `done_open.png` (statements, qualifier warning, expanded source sentence, removed-statement note, "Run again (uses allowance)"), `done_withheld.png` (licence notice, no sentence shown), `signed_out.png`, `no_ref.png`, `unavailable.png`, `failed.png`.
- Not proven: real device layout, the paper screen's surrounding layout, scrolling, keyboard focus, screen-reader behaviour, fonts, real network states.
- A visible text scan of all states found none of: verified, accurate, guarantee, confidence (the words "accuracy" in the sample appear only inside the fictional paper's own sentence).
- A limit of the withheld state: its cards still show "Show source sentence"; pressing it asks the server, which answers "not available for licence reasons". Harmless but one wasted request; hiding the button when the server already said text is withheld is a small follow-up.

## 6. Debug keystore finding (`android/app/debug.keystore`, tracked)
JKS, alias `androiddebugkey`, opened with the well-known password `android`, created 2014-01-01, valid to 2052-05-01, owner `CN=Android Debug, OU=Android, O=Unknown, ...`, 2048-bit RSA, SHA-1 signature. SHA-1 fingerprint `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, SHA-256 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. This matches the standard debug keystore shipped in the React Native / Expo project template (same alias, same default password, same 2014 creation date; I recognise the fingerprint but could not compare it with the template online, so this is "consistent with the standard template key", not a proof). It is a **public, non-secret key**: anyone can build an APK that Android treats as signed by it.
**Finding that matters:** `android/app/build.gradle` line 120 signs the **release** build type with this debug key. Such a release APK is installable for testing but must **not** be uploaded to a store or described as a production build; a real release keystore, kept out of Git, is needed before any store release. I changed nothing.

## 7. Known follow-ups (none blocking the above)
- The runner and CI have never met real data or a real runner.
- Hide "Show source sentence" when the server already withheld the text.
- The `AnalysisPanel` asks for `STANDARD` depth only; there is no depth choice and no display of the remaining daily allowance (the API does not expose it).
- Decision D-B-3 (below) on how the code reaches the machine that runs the pilot.
