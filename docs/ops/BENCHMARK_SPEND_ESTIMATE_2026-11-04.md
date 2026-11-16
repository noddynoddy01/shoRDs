# 50-paper summary benchmark: readiness and exact API spend estimate

Date: 2026-11-04. **Nothing paid has been run. No paper has been fetched. No rating exists.** Every number below comes from reading code or from arithmetic, and is labelled so.

## 1. Readiness of the workflow

| Step | Command | State | Evidence |
|---|---|---|---|
| Collect candidates, licence-gate, stratify | `node scripts/summary_benchmark.js collect --out benchmark/candidates.json --total 50 --seed 1` | Works against a **fictional stubbed** OpenAlex response; never run against the real service (no network here) | `backend/tests/node/benchmarkWorkflow.test.js` (3 tests): only CC BY / CC0 / CC BY-SA selected, NC/ND/publisher-specific/unknown excluded, duplicates removed, two per stratum for 12, reproducible by seed, provider error writes nothing, shortfall reported |
| Selection and licence record | written by `collect` as `benchmark/selection_record.csv` | New in Phase 3. Columns `licence_confirmed_by_person` and `confirmed_on` are left blank on purpose | same test |
| Attach text | owner/assistant adds abstract or licensed full text per selected paper | Manual; not automated | protocol doc |
| On-device brief | `device --papers papers.json` | Offline, free | `deviceBrief.test.js` |
| Backend analyses | run by the owner with the owner's key | **The only paid step. Not run.** | section 2 |
| Blinded sheets for two raters | `plan --selected … --device … --backend … --raters rater_a,rater_b --seed N` | Tested on synthetic data: unit ids blinded, different order per rater, systems only in the secret key, passages only when licence allows | `summaryBenchmark.test.js` |
| Scoring | `score --key KEY.json --ratings a.csv b.csv` | Tested on **synthetic** ratings, which are labelled `SYNTHETIC` in output; refuses to report agreement it cannot compute | `summaryBenchmark.test.js` |

Known weaknesses of the collection step (not fixed; need real data to judge): the six topic strata use one search phrase each, so they are a convenience sample, not a representative sample of literature; the OpenAlex licence field is a lead, which is why a person confirms each licence on the paper's page; the OpenAlex filter syntax and any key/rate requirement are unverified against the live service.

### What the owner arranges for two independent reviewers
- Two people who have not seen the system outputs and will not discuss the ratings. Each gets only their own `rater_X.csv` plus the rubric in the protocol.
- Time per rater: 50 papers x 2 summaries (device brief and backend analysis). At roughly 10 to 15 minutes per paper pair this is **8 to 12 hours per rater** (author's estimate, not measured; pilot with 3 papers first and re-plan).
- Keep `KEY` private until both sheets are back. Run `score`, then discuss disagreements.

## 2. Exact worst-case API spend

Computed by `scripts/estimate_analysis_cost.js` using the production functions `estimateMaxCost`, `resolveProfile`, the pinned price table and the default context cap. This is the **ceiling the spend gate would reserve**, not a prediction.

Inputs read from code:
- Model `claude-sonnet-5-5`, price **$2.00 per million input tokens, $10.00 per million output tokens** (pinned in `anthropicClient.js` "docs models overview, 2026-10-01"; I could not re-check it here; the Console invoice is the truth).
- Input bound: `AI_MAX_CONTEXT_CHARS` default 120,000 characters of excerpt text plus wrapper plus system prompt; the gate counts **one token per byte** as a safe over-count: 135,343 tokens.
- Output bound: `maxTokens` per depth (thinking tokens are billed as output): QUICK 6,000, STANDARD 16,000, DEEP 32,000.
- One provider retry is permitted by default (`AI_MAX_PROVIDER_RETRIES`=1), so the reservation per request is two attempts.

| Depth | Worst case, one attempt | Worst case with one retry | 50 papers, no retries | 50 papers, every one retried |
|---|---|---|---|---|
| QUICK | $0.33 | $0.66 | $16.53 | $33.07 |
| **STANDARD (product default)** | **$0.43** | **$0.86** | **$21.53** | **$43.07** |
| DEEP | $0.59 | $1.18 | $29.53 | $59.07 |

**Hard ceiling for the benchmark at STANDARD: about $22 if no call is retried, $43 if every call is retried.** The per-request limit (`AI_BUDGET_REQUEST_MAX_USD`, default $1.25) is above every row, so no request is refused for size.

### Expected spend (assumptions, not measurements)
Typical full-text papers are far below the 120,000-character cap. Assuming 4 characters per token, and STANDARD output of 5,000 to 12,000 tokens including thinking:

| Scenario | Input tokens | Output tokens | Per paper | 50 papers |
|---|---|---|---|---|
| Short papers / abstracts | 6,000 | 5,000 | $0.062 | $3.10 |
| Typical | 20,000 | 9,000 | $0.130 | $6.50 |
| Large (cap) | 30,000 | 16,000 | $0.220 | $11.00 |

So **plan for about $5 to $12, approve a ceiling of $25**, and measure the first 3 papers (the response reports tokens) before running the rest. These scenario numbers are assumptions until three real runs replace them.

### A constraint that will interrupt a benchmark run
The default daily ceilings are **$2 per user and $2 per project**. At the typical figure that is about 15 analyses per day, and the gate reserves the worst case while a call is in flight. A 50-paper run through one user and project therefore needs about 4 days, **or** a temporary owner-approved increase of `AI_BUDGET_USER_DAILY_USD` and `AI_BUDGET_PROJECT_DAILY_USD` (for example to $10) for the run, then restored. I made no configuration change. Alternative: run in a local environment with the owner's own key and a separate budget configuration, which keeps production untouched.

### Before any model run, the owner confirms
1. A spending limit in the Anthropic Console below the amount they are willing to lose, set first.
2. The approved ceiling (suggested $25 total) and depth (STANDARD).
3. Whether to run through production or locally (suggested: locally).
4. That the 50 papers have person-confirmed licences (`selection_record.csv`).

## 3. Reproduce the estimate
Run `node scripts/estimate_analysis_cost.js` (offline, no model call). The calculation is: `ceil(inputTokensBound x 2 + maxTokens x 10)` micro-dollars per attempt, times attempts.
