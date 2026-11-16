# Owner-action checklist for closed-beta readiness (updated after Phase 4)

## Phase 4 update (2026-11-04, later the same day)
Done by me, uncommitted on `p0-fixes`: D-UI-2, D-UI-1, D-F1-1, the evidence UI on the paper screen (button-triggered), the CI workflow (one defect fixed), the replay log removed from the Git index (file kept). **Still nothing committed, deployed, purchased or spent ($0.00).** Details: `PHASE4_CHANGE_REPORT_2026-11-04.md`, `BENCHMARK_PREPARATION_2026-11-04.md`.

### New and changed items for you, in order
| # | Action | Why now |
|---|---|---|
| A | **Console spending limit** (item 1 below), write the value and date here: ______ | The pilot must not start without it. I cannot see or set it |
| B | Decide **D-B-3: how the code reaches the machine that runs the pilot** (commit on `p0-fixes` and pull, or use the working-tree bundle I delivered) | Your `D:\shords` has none of the Phase 2 to 4 work |
| C | Set up a throwaway local PostgreSQL 16 and Redis 7; create `shords_bench` | Runbook 3.2 in the benchmark preparation report |
| D | Run `collect`, then **read and record each paper's licence on its own page** in `selection_record.csv` | OpenAlex is blocked from my environments; the runner refuses papers without your confirmation |
| E | Pilot of 3 papers (runbook 3.5), then **send me `spend_log.jsonl` and the Console usage figure and stop** | The ceiling is $25 and nothing beyond the pilot is approved yet |
| F | **Android release signing:** `android/app/build.gradle` signs release builds with the public debug key. Create a real release keystore (kept out of Git, backed up) before any store upload. I did not change anything | Found while inspecting the keystore you asked about |
| G | Review the one changed existing test (`cacheIdentityAudit.test.js`, described in the Phase 4 report, section 4) | A test that used to look at confidence factors now checks that they are not served |

### Decisions from Phase 3: status
| ID | Decision | Status |
|---|---|---|
| D-P3-1 | Merge F1 | Still yours; F1 review of real papers not done |
| D-UI-2 | Licence gate on excerpts | **Approved, implemented, tested** |
| D-UI-1 | Personal project | **Approved, implemented, tested** |
| D-F1-1 | Raw capture, opt-in | **Approved, implemented, tested** |
| D-B-1 | $25, local, STANDARD | **Approved**; enforced in code (hard ceiling constant 25) |
| D-B-2 | Daily ceilings | Not changed; the pilot fits the defaults; raise them only in your local window for the full run |
| D-C-1 | CI workflow | **Approved, included, never run** |
| D-C-2 | Untrack replay log | **Done in the index only; takes effect when you commit** |
| D-C-3 | docker-compose default Postgres password | Open (pre-existing) |
| D-C-4 | Remove unused services and components | Open (separate pull request) |
| D-D6 | PostgreSQL archive authenticity | Open |
| D-R | Two independent reviewers | Open; needed before any quality claim |
| D-B-3 | **New:** how the pilot gets the code (see B) | Open |

---


Date: 2026-11-04. Nothing here was done, accessed or changed by me: all of it touches accounts, production or spending that only the owner may touch. Order matters; do the top items before anything else.

## Do before any user gets access

### 1. Anthropic Console spending ceiling (about 5 minutes, free)
- Console > Settings/Limits > set a **monthly spend limit** at an amount you accept losing (suggestion: the amount you plan to spend on the benchmark plus a margin, for example $50, then raise deliberately).
- Confirm the key used by production is a **dedicated key** for shoRDs, not shared with anything else, and that no other key exists unnoticed.
- Why: the application's own ceilings (`AI_BUDGET_*`; global default $25/day, user and project $2/day) protect against bugs in this app. The Console limit protects against everything else, including a leaked key.
- Done when: you can see the limit in the Console and wrote down its value and date here: ________.

### 2. Railway plan and usage
- Look at the current plan, monthly usage, and the memory/CPU ceiling of the backend service and of Postgres and Redis (read only).
- `railway.json` declares healthcheck path `/ready` (timeout 100 s) and restart on failure (3 retries). Confirm the dashboard shows the same and that a failed deploy does not replace a healthy one.
- Decide the **smallest plan** that keeps the database and Redis always on. If a plan change is needed, tell me the plan and price and I will record it in the purchasing register before you buy; I will not buy anything.
- Done when: plan name, monthly cost, current month's usage written here: ________.

### 3. One verified database backup and restore (most important unverified item)
The design is written down (`docs/architecture/DATA_DURABILITY.md` and the A7 amendment in the Project), but the repository contains **no backup script**, and **no backup has ever been taken and restored**. A backup that has not been restored is a hope.
1. Take a backup (`pg_dump -Fc`, or Railway's own backup feature if your plan includes it; check what the plan offers) against a **non-production copy** if possible, or read-only against production with your approval.
2. Restore it into a throwaway local PostgreSQL 16.
3. Count rows in `papers`, `paper_chunks`, `ai_usage`, `projects`, `analysis_jobs`, `schema_migrations` in the restored copy and compare with the source; start the backend against the restored copy locally and call `/ready`.
4. Record: date, size, how long backup and restore took, row counts, who did it.
Note on the PostgreSQL tools archive in `D:\Tools\pgsql-16.15`: its authenticity is still undecided (decision D6). Until you decide, I did not run its binaries; use the official installer or a container instead.
- Done when: a dated restore log exists.

### 4. Uptime monitoring of `/ready`
Follow `docs/ops/UPTIME_MONITOR_SETUP.md` (free plan, about 10 minutes). Three monitors: `/ready` keyword `"status":"READY"`, `/health`, and the web app. Alert to a mailbox you read; fire after 2 consecutive failures.
- Done when: you deliberately cause no outage but see all three monitors green and you receive a test alert.

### 5. Live Firebase rules review
- Compare the **live** rules (Firebase console > Firestore/Storage/Realtime Database > Rules) against `docs/ops/firebase/` and `docs/ops/FIREBASE_RULES_REVIEW.md` (read only, copy the live rules into a file and diff).
- Confirm: no `allow read, write: if true`, no rules expiring on a date, authentication providers are only the ones you use, authorised domains list only your domains, the API key restrictions (HTTP referrers) are set.
- I could not read the live rules; the review is of the proposed rules only.
- Done when: a diff of live versus proposed exists and every difference is explained.

### 6. OpenAlex API key and rights clarification
- Check OpenAlex's current terms and whether a key is required or advised at your request volume; if so, create one in your own account and store it only as a Railway/Vercel secret (never in the repo or chat).
- **Rights question that the code cannot answer:** abstracts retrieved from OpenAlex and Semantic Scholar are shown and used in prompts. Confirm in each service's terms that this display and processing is allowed, and whether attribution is required. The code applies a *licence-per-paper* policy for full text; abstracts follow the provider's terms and are not gated by it.
- Done when: a short note records the terms read (URL, date) and the decision.

## Owner decisions needed (Phase 3)
| ID | Decision | My recommendation |
|---|---|---|
| D-P3-1 | Merge F1 (claim guard changes which statements survive; cached analyses are invalidated by version bump) | Approve after reading the F1 review; do not describe summaries as verified |
| D-UI-2 | Apply the licence gate to excerpt text inside analysis and Copilot responses | Yes (small change, needs tests) |
| D-UI-1 | Project model for the analysis UI | Auto-created personal project |
| D-F1-1 | Allow an opt-in benchmark-only capture of the model's raw output | Yes, behind an environment flag |
| D-B-1 | Benchmark spend ceiling and where to run it | $25, locally, depth STANDARD |
| D-B-2 | Raise per-user/project daily ceilings temporarily, or spread over days | Run locally instead |
| D-C-1 | Place `.github/workflows/ci.yml` and enable it | Yes, in the commit you approve |
| D-C-2 | `git rm --cached android/replay_pid29016.log` at commit time | Yes (a JVM crash log is tracked) |
| D-C-3 | docker-compose default Postgres password | Change to a required variable (pre-existing) |
| D-C-4 | Remove about 40 unimported services and 17 unused components | Separate pull request, later |
| D-D6 | PostgreSQL archive authenticity | Use an official installer instead |
| D-R | Recruit two independent reviewers for the benchmark | Needed before any quality claim |
