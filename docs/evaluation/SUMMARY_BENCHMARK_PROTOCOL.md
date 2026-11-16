# Summary-quality benchmark: protocol (device brief vs backend analysis)

Status 2026-11-04. **Tooling is built and tested. No papers have been collected and no human has rated anything, so there are no quality results.** Any number in this repository that looks like a summary-quality score comes from a synthetic regression fixture and says nothing about real accuracy.

Companion: `HUMAN_BENCHMARK.md` is the claim-level faithfulness protocol (does each claim hold in the paper). This one is summary-level: how good is the whole summary, and which of the two shoRDs summaries is better.

## What is compared

| System | What it is | Where it comes from |
|---|---|---|
| `device_brief` | The grounded research brief built on the phone by fixed rules (no AI), from the abstract or the extracted PDF text. | `services/paperSummarizer.ts` via `summary_benchmark.js device` (offline) |
| `backend_analysis` | The cached intelligence object from the backend model run, each statement carrying evidence ids. | Produced separately with the owner's own key; handed to `plan` as a file |

No benchmark command calls a language model or spends money.

## Papers

- 50 papers (the tool reports any shortfall instead of padding), stratified evenly across six strata: biomedical, machine learning, physics, social science, earth/environment, systems engineering. Fixed seed, so the sample is reproducible.
- Licence gate in code (`selectBenchmarkPapers` -> `permissionsFor(...).evalCorpus`): unknown, NonCommercial and "free to read" papers are excluded and listed with the reason. `collect` asks OpenAlex only for CC BY, CC0 and public-domain full-text open-access articles.
- The licence string, retrieval date and landing page are stored with each paper. Do not copy paper text into a repository or give raters text the licence does not allow. Raters get a link to the paper.
- Limitation to state in any write-up: papers that are open access under CC BY are not a random sample of all papers (they skew to certain publishers and fields), and abstracts/full texts must be attached by the person running the study.

## Criteria (1 to 5, integer)

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| Factual accuracy | Several numbers, names or directions wrong or reversed | One clear error or several small imprecisions | Every number, name, direction and claim is in the paper |
| Completeness | Misses most of question/method/results/limitations | Main result present, method or limitations missing | Nothing a reader needs is missing |
| Readability | Fragments, repeated or cut-off sentences | Understandable with effort | Clear, ordered, quick to read |
| Evidence traceability | Nothing can be checked against a passage | Some statements point to a passage | Each statement points to its passage |
| Usefulness | Would still have to open the paper to decide | Helps, with checks | Could decide whether to read, with confidence |

Judge against the paper only, not outside knowledge. A summary containing any wrong or reversed number or claim cannot score above 2 on factual accuracy; the tool also counts these as "factually unsafe" per system.

## Failure tags (zero or more per summary)

`WRONG_NUMBER`, `REVERSED_RESULT`, `OVERCLAIM`, `MISSING_LIMITATION`, `MISSING_KEY_RESULT`, `UNSUPPORTED_STATEMENT`, `WRONG_ATTRIBUTION`, `GENERIC_FILLER`, `TRUNCATED_FRAGMENT`, `UNREADABLE`, `NO_TRACEABLE_SOURCE`, `OTHER`. Unknown tags are reported as problems in the returned sheet and not counted.

## Workflow

```
node scripts/summary_benchmark.js collect --out benchmark/candidates.json --total 50 --seed 1   # needs network (OpenAlex); untested here
# attach abstract (and licensed full text if available) to each selected paper -> papers.json
node scripts/summary_benchmark.js device  --papers papers.json --out benchmark/device_briefs.json
# run the backend analysis for the same papers with the owner's key -> backend_analyses.json { paperId: { intelligence, chunksById? } }
node scripts/summary_benchmark.js plan    --selected benchmark/candidates.json --device benchmark/device_briefs.json --backend benchmark/backend_analyses.json --raters rater_a,rater_b --out benchmark/round1
# give each rater only their own CSV; keep KEY_DO_NOT_SHARE_WITH_RATERS.json private
node scripts/summary_benchmark.js score   --key benchmark/round1/KEY_DO_NOT_SHARE_WITH_RATERS.json --ratings benchmark/round1/rater_a.csv benchmark/round1/rater_b.csv --out benchmark/report.json
```

Blinding: each unit shows the summary only, in an order shuffled per rater with a seed; the system label lives in the key. Raters are two people who work independently, are not the author of the code, and do a short calibration on 3 to 5 papers first (not counted).

## What `score` reports

Per criterion: quadratic-weighted kappa, exact agreement, within-one agreement and a `reliable` flag (kappa >= 0.6; below that the criterion should not be used, revise the rubric and re-rate). Per system: mean and standard deviation per criterion, count of factually unsafe summaries, failure-tag counts. Comparison: backend minus device on each criterion with a 95% bootstrap interval over papers. If fewer than 50 papers are present the report says so. The report also lists the limitations above.

## Owner actions needed

1. Run `collect` on a networked machine (or supply a candidate list) and attach texts.
2. Run the backend analysis for those papers with the production key and a spend cap (the cost is 50 normal analyses).
3. Recruit two independent raters with subject familiarity and written consent to use their ratings.
4. Run `plan`, distribute CSVs, run `score`, and read the `reliable` flags before reading any mean.

## Test coverage

`backend/tests/node/summaryBenchmark.test.js` (7 tests) covers licence gating, stratified reproducible selection, blinded plan and key, CSV round trip, kappa, bootstrap, and the comparison on a synthetic set. Synthetic data tests the machinery, not summary quality.
