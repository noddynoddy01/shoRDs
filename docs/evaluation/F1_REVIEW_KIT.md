# F1 manual review kit (evidence guard)

> **Update (Phase 4):** decision D-F1-1 was approved and implemented. With `BENCHMARK_RAW_CAPTURE=1` and an absolute `BENCHMARK_RAW_CAPTURE_DIR` on a **local** machine, each analysis writes one file holding `paper`, `chunks`, `rawText` and `modelOutput` (the unvalidated intelligence) for licences that allow keeping text; that file has the shape `f1_review.js make --raw` expects. Production cannot enable it. See `docs/ops/BENCHMARK_PREPARATION_2026-11-04.md`. No real paper has been captured or reviewed yet.


Status: tooling built and tested on a fictional paper only (backend/tests/node/guardReview.test.js, 7 tests). **No real paper has been reviewed and no human has rated anything.** Nothing here says the guard, or any summary, is accurate. The kit exists so that one or two people can measure how often the guard keeps a statement that a careful reader finds unsupported (a *miss*) and how often it removes one that is supported (a *false drop*).

Real-paper examples could not be prepared in this environment: there is no network access, so no paper text or model output could be fetched, and a model run would be a paid analysis that was not approved. What is ready is the procedure and the code the owner runs.

## What the owner does (about 1 hour of setup, then reviewer time)

1. **Pick 5 to 10 papers** whose licence allows keeping the text in an internal evaluation set: CC0, public domain, CC BY, CC BY-SA. `make` refuses everything else (CC BY-NC, ND, publisher-specific, unknown). Take them from different fields and include at least two with tables of numbers. Record the licence and where you checked it (the paper's own page, not a database alone).
2. **Run one analysis per paper** with the normal product path (this spends model budget, so it needs the owner's approval and the spending ceiling in place; see `docs/ops/BENCHMARK_SPEND_ESTIMATE_2026-11-04.md`).
3. **Save a raw file per paper** as `paper-N.json` with the shape `{ paper:{paperId,title,license,doi?,sourceUrl?}, chunks:[{chunkId,section?,text}], modelOutput:{...} }`. The chunks are the exact chunk texts the analysis was given (read them from the `paper_chunks` table of the paper that was analysed, or from the analysis response's evidence).

   **Important gap (owner decision D-F1-1).** The kit judges each statement in `modelOutput` with the same validation production uses, so `modelOutput` should be the intelligence object **as the model returned it, before validation**. Today the product does not store that: a finished analysis job holds only the statements that survived. Feeding the kit a saved job result therefore works, but every statement in it is already a survivor, so the kit can measure **misses** (survivors a reviewer rejects) and **cannot measure false drops**. Capturing the raw model output needs a small change to the analysis path (for example, an opt-in debug field written only for benchmark runs, never shown to users). That change touches production code and was not made in Phase 3; it needs your approval. Until then, report only the miss side and say so.
4. **Build the sheets**: `node scripts/f1_review.js make --raw paper-N.json --out review/ --seed 7`. This writes `paper-N.reviewer_sheet.csv` (give to reviewers) and `paper-N.KEY_DO_NOT_SHARE_WITH_REVIEWERS.json` (keep private). Statements are shuffled by the seed, so order does not reveal which ones the guard kept.
5. **Two reviewers work independently**, each on their own copy of every sheet, without discussing it. They must not see the key, each other's labels or the product's output screen.
6. **Score**: `node scripts/f1_review.js score --key paper-N.KEY….json --sheets a.csv b.csv --out report-N.json`. Do it per paper, or concatenate keys and sheets if you want one total (unit ids are per paper).

## Reviewer instructions (give this text with the sheet)

For each row, read the statement, then the cited passages. Decide using **only** the passages shown, not what you know about the field. Write one word in `human_verdict`:

- `SUPPORTED`: the passages say this, including every number, comparison and who did it.
- `PARTIAL`: mostly right but something is missing or overstated (a hedge removed, a condition dropped, "improves" where the passage says "may improve").
- `UNSUPPORTED`: the passages do not say this, or say something different (different number, different unit, different system, claim attributed to the wrong party).
- `CONTRADICTED`: the passages say the opposite.
- `NOT_A_CLAIM`: not a factual statement about the paper; skipped.

Use `human_notes` for anything you were unsure about. Pay particular attention to: numbers and their units, who is being compared with whom, whether a result is the paper's own or cited from other work, negations ("did not improve"), and conditions ("on short questions only"). Do not label from memory of the paper; if the shown passages do not support it, it is `UNSUPPORTED`.

## What the report contains and how to read it

- **miss**: of statements reviewers found unsupported or contradicted, the share the guard kept. The number that matters for trust.
- **falseDrop**: of statements found supported, the share the guard removed. Shows what caution costs.
- **shareOfKeptThatIsUnsupported**: of everything a user would have seen, how much a careful reader would reject.
- **agreement** (two reviewers): exact agreement and Cohen's kappa. Below about 0.6 the instructions need another round before any rate means anything.
- 95 percent Wilson intervals with the counts. With 5 to 10 papers the intervals will be wide; the report says so in `warnings`.
- Disputed items (reviewers differ) and unlabelled items are counted and set aside, not resolved silently; resolve them in a discussion after both have finished and record the outcome.

## Limits that stay true whatever the numbers are

- The guard checks numbers, a list of overclaim words, direction words and negation against the *cited passages*. It does not understand meaning. The regression register (`backend/tests/fixtures/evidence_limits_register.json`, 22 cases, run by `evidenceLimits.test.js`) documents known failures: of 17 unfaithful statements built to slip through, 15 were kept; of 5 faithful statements, 4 were dropped. These are hand-built adversarial cases, **not rates**.
- A review of a handful of papers by two people measures this prompt version on those papers only. Statements within a paper are not independent. It is a sanity check and a way to find failure patterns, not a validation.
- Any change to the guard or prompt changes `INTEL_PROMPT_VERSION`; reports are valid only for the version recorded in the key.
- Do not describe the results as "verified" or "accurate". The honest wording is "passed automated checks".
