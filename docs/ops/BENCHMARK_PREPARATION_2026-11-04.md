# Benchmark preparation and pilot runbook (Phase 4)

Date: 2026-11-04. Branch `p0-fixes`, uncommitted.

**Status in one line: prepared, not started. No model call has been made, nothing has been spent ($0.00), no real paper has been fetched, no licence has been checked, no rating exists.**

Approved by the owner (Phase 4): ceiling **$25**, depth **STANDARD**, **local environment only**, no paid call until the preparation below is done, then a **3-paper pilot, then stop and report the actual spend**.

## 1. What blocked me and what the owner must do

| Gate the owner set | State | Why |
|---|---|---|
| Prepare the environment | **Partly.** The runner and its safety gates are built and tested (section 2). The local database, Redis and key are the owner's machine and account; I did not touch them | the owner's machine has none of the uncommitted work yet (see 3.1) |
| Validate the paper licences | **Not done.** OpenAlex answers `403` through the egress proxy from the cloud container and from the Linux shell on the owner's computer, so no paper could be selected or checked | network allow-list; I did not try to go around it |
| Confirm the Anthropic Console spending limit | **Cannot be done by me.** It is an account setting only the owner can see | owner action 1 in the owner checklist; write the value and date down before the pilot |
| Pilot the first three papers | **Not started** (needs the three items above) | |

## 2. What I built so that the pilot is safe to press

There was no tool that turned a model run into the `backend_analyses.json` the rating step needs. `scripts/benchmark_run_local.js` (logic in `backend/eval/benchmarkRun.js`) runs the **normal analysis pipeline** in-process, one paper at a time, and writes three things: `backend_analyses.json` (input of `summary_benchmark.js plan`), `spend_log.jsonl` (one line per paper), and, through the Phase 4 raw-capture hook, one local file per paper holding the unvalidated model output and the chunks it was given (input of `f1_review.js make`).

Every gate is in code and tested (`backend/tests/node/benchmarkRun.test.js`, 9 tests; `benchmarkRun.integration.test.js`, 4 tests on real PostgreSQL and Redis with a stub model):

| Gate | Behaviour |
|---|---|
| Explicit spend consent | refuses unless `--confirm-spend` is passed |
| Ceiling | refuses `--max-usd` above **25** (a constant; raising it needs a new approval and a code change) |
| Local only | refuses if `NODE_ENV=production`, if any `RAILWAY_*`, `VERCEL` or `KUBERNETES_SERVICE_HOST` variable exists, or if `DATABASE_URL` / `REDIS_URL` do not point to localhost, 127.0.0.1 or ::1 (look-alike hosts such as `localhost.evil.example` are refused) |
| Real measurement | refuses unless `AI_CACHE_ENABLED=false` (a cached answer would hide the real cost) |
| Raw capture | refuses unless `BENCHMARK_RAW_CAPTURE=1` and an absolute `BENCHMARK_RAW_CAPTURE_DIR` |
| Key | read only from the process environment; never printed, logged or written (tested) |
| Licence | runs only papers whose row in `selection_record.csv` has **both** `licence_confirmed_by_person` and `confirmed_on` filled in; all others are listed with the reason and never run |
| Pre-call ceiling check | before every paper: measured spend so far + the spend gate's own worst-case reservation for one call (two attempts, about **$0.86** at STANDARD) must fit under `--max-usd`, otherwise it stops. A ceiling below one worst-case call runs nothing |
| Unmeasured cost | a call that reached the provider without a measured cost is counted at its **worst case**, never zero |
| Failures | stops after two failures in a row; an exception is logged and marks the total as a lower bound |
| Pilot size | `--limit` defaults to 3 |
| Report | prints papers run, spent, mean measured cost per paper, a **labelled-as-assumption** projection for 50 papers, why it stopped, and the instruction to compare with the Console before going on |
| Cross-check | the integration test confirms the runner's total equals the spend gate's own ledger (`ai_usage`) |

Also checked: a capture file written by the integration test (stub model, fixture paper) was accepted by `node scripts/f1_review.js make --raw <file>` and produced a reviewer sheet and key, so the capture-to-F1 path works on the fixture.

Not done and stated plainly: the runner has only ever run against the stub model and the fictional fixture paper. Real papers will exercise the provider fetch, chunking and licence paths for the first time during the pilot.

## 3. Owner runbook (nothing below has been executed)

### 3.1 Get the code onto the machine
The owner's `D:\shords` checkout does not contain any Phase 2 to 4 work; it exists only in the cloud working copy, uncommitted. The pilot needs it. Options (an owner decision, D-B-3): approve a commit on `p0-fixes` and pull it, or take the working-tree patch bundle delivered with this phase. I will not commit or push without approval.

### 3.2 Local services
Use a throwaway PostgreSQL 16 and Redis 7 on this machine (official installer or Docker; the `D:\Tools\pgsql-16.15` archive stays unused until decision D6). Create an empty database, for example `shords_bench`. **Never** use the production `DATABASE_URL` or a Railway reference.

### 3.3 Environment (PowerShell 5.1; set in the window you will run from, close it afterwards)
```powershell
cd D:\shords
$env:DATABASE_URL = "postgres://<user>:<password>@127.0.0.1:5432/shords_bench"
$env:REDIS_URL    = "redis://127.0.0.1:6379"
$env:AI_CACHE_ENABLED = "false"
$env:BENCHMARK_RAW_CAPTURE = "1"
$env:BENCHMARK_RAW_CAPTURE_DIR = "D:\shords-benchmark\raw"       # outside the repository; the files contain paper text and model output
$secure = Read-Host "Anthropic key (input is hidden)" -AsSecureString
$env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
```
Do not paste the key into chat or into any file. Use a **dedicated key** with the Console spending limit already set. The default per-user and per-project daily limits ($2 each) are enough for a 3-paper pilot. For the later 50-paper run only, raise `AI_BUDGET_USER_DAILY_USD` and `AI_BUDGET_PROJECT_DAILY_USD` in this local window (for example to 10); nothing in production changes.

### 3.4 Select papers and validate licences (free, needs network)
```powershell
node scripts/summary_benchmark.js collect --out benchmark/candidates.json --total 50 --seed 1
```
This writes `benchmark/selection_record.csv`. **For each paper you intend to use**, open `landing_page`, read the licence on the paper's own page, and fill in `licence_confirmed_by_person` (what you saw, for example "CC BY 4.0 shown on publisher page") and `confirmed_on` (date). The OpenAlex licence field is a lead, not a permission. The OpenAlex query itself has never run against the live service; if it answers an error, nothing is written and I need to see the message.

### 3.5 Pilot: the first three papers, then stop
```powershell
node scripts/benchmark_run_local.js --selected benchmark/candidates.json --record benchmark/selection_record.csv --out benchmark/pilot --limit 3 --max-usd 3 --depth STANDARD --confirm-spend
```
Expected: three lines (one per paper), then the report. At the **worst case** the three papers cost about $1.30 ($0.43 each; $2.58 if every call retried), so `--max-usd 3` cannot be exceeded. My assumption for a typical paper is about $0.13 each (assumption, not measured).

Then **stop**. Send me `benchmark/pilot/spend_log.jsonl` (contains no paper text) and the Console usage figure for the same period. I will compare the three, replace the assumption with the measurement, and re-plan the 50-paper run. Do not continue until they agree to within a few cents; if they do not, tell me the two numbers.

Hand me nothing from `D:\shords-benchmark\raw` or `benchmark/pilot/backend_analyses.json` unless you want me to look at the content; they hold paper text and model output.

### 3.6 After the pilot (not authorised yet)
Run the remaining papers with a new `--out`, `--limit` and a `--max-usd` of at most 25 **minus what the pilot spent**; then `device` (free), `plan` (blinded sheets), two independent raters (8 to 12 hours each, my estimate), `score`. The F1 review kit takes the raw-capture files directly (`f1_review.js make --raw <file>`), which closes decision D-F1-1's gap.

## 4. Spend arithmetic (unchanged from the Phase 3 estimate, recomputed with `scripts/estimate_analysis_cost.js`)
Model `claude-sonnet-5-5`, $2 / $10 per million input / output tokens (pinned in code, not re-checked against the live price list; the Console is the truth). Worst case per paper at STANDARD: $0.43 per attempt, $0.86 with the one permitted retry. 50 papers: $21.53 if no retry, $43.07 if all retried. The runner's per-paper guard uses $0.86 and the hard ceiling is $25, so the ceiling is enforced against the measured spend plus one worst-case call, not against an average.

## 5. What this report does not establish
- That any real paper will run: provider fetch, licence classification of real records and chunking on real text are untested outside fixtures.
- That the estimate of $5 to $12 for 50 papers is right. It is an assumption until the pilot.
- That summaries are accurate. Nothing here measures quality; the rating step does, and needs two independent people.
