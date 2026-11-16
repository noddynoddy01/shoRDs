# 9 and 10. Evaluation framework and benchmark comparison against the Claude pipeline

Date 2026-11-04 · **Framework: IMPLEMENTED and TESTED (machinery only, synthetic ratings). Benchmark comparison against Claude: NOT RUN. There is no accuracy, completeness, cost-per-paper or latency number for any language model anywhere in this phase, and no claim that any system is better than another.**

## 5.1 Why the comparison has not been run

It needs four things that are not mine to supply, in this order:
1. **Papers with licences a person has confirmed** (`selection_record.csv`, Phase 4). The only network route to OpenAlex was blocked (403) from the cloud and from your computer's Linux shell, and licence confirmation is a human step. So no real paper has been fetched.
2. **The Claude baseline run** (Phase 4 pilot: 3 papers, then the rest), which spends real money on your Anthropic key within the $25 ceiling you set. You have not yet run it.
3. **The open-weight arms**, which need either a local model server you run, or a paid hosted endpoint (approval, price, ceiling).
4. **Two independent raters** (8 to 12 hours each for the 100 units of the Phase 4 study; this study has up to 150 units and 8 criteria, so assume 12 to 18 hours each: my estimate, not a measurement).

## 5.2 What was built (reusing, not replacing, the Phase 3/4 tooling)

| Piece | File | Reuses | State |
|---|---|---|---|
| Three-system plan, blinded sheets, key | `backend/eval/nativeCompare.js` | `summaryBenchmark` (criteria text, CSV, kappa, bootstrap), `licensePolicy` | IMPLEMENTED, TESTED (8 tests) |
| Eight criteria | factual accuracy, completeness, readability, evidence traceability, usefulness (the five existing) + **quantitative accuracy, methodology understanding, limitation identification** | existing five unchanged | IMPLEMENTED |
| Same layout for every system | `renderSections`: nine sections, passages shown identically, "Unavailable." written out, **no system, model or status names** | | TESTED (sheets are searched for leaks) |
| Per-rater shuffle, key kept apart | | | TESTED |
| Licence-aware passages | passages hidden when the licence does not allow redistribution | `licensePolicy` | TESTED |
| Identical source material | `native_compare.js assemble` runs systems B and C on the **exact excerpts Claude was given** (the Phase 4 raw-capture files), with the same chunk ids | `rawCapture`, `fromChunks` | IMPLEMENTED; run on synthetic captures only |
| Automatic cross-checks | per system: statements without citation, citations to unknown chunks, numeric statements whose numbers are not in the cited text (the guard's own number rule), sections available, guard withholds | `claimGuard` | TESTED. Proxies, not human judgement |
| Operational summary | mean / p50 / p95 latency, tokens, **cost only if measured for every paper** | | TESTED |
| Pre-declared decision rule | see 5.3 | | TESTED |
| Stage-level raw output for error analysis | `onRaw` hook (never in the result) | Phase 4 capture design | TESTED |

Systems: **A** current Claude brief (stored `intelligence`, mapped to the nine sections); **B** the open-weight model, one prompt for the whole brief, passed through the same guard (`directBaseline.js`); **C** the multi-stage pipeline. Comparing B with C answers "does the pipeline help beyond the model?"; comparing either with A answers "can we stop depending on Claude?".

## 5.3 The decision rule, fixed before any rating exists

A system may **replace** Claude only if all of these hold:
- at least 50 papers were rated, and weighted kappa is at least 0.6 on factual accuracy and quantitative accuracy;
- on those two criteria the lower bound of the paired 95% bootstrap interval of (system minus Claude) is at least −0.25 points (non-inferiority margin);
- its rate of factually unsafe summaries (either rater gave factual or quantitative accuracy ≤ 2) is not more than 0.05 above Claude's.

"Superior" additionally needs that lower bound above 0 on both. Otherwise the report says **"not shown"**. Summary **length is reported as a confound and is not used anywhere in the decision** (a test reads the function's source). Data labelled `SYNTHETIC` produce the verdict `NOT_EVIDENCE_SYNTHETIC_DATA`.

## 5.4 What the report will contain once real ratings exist

Mean and standard deviation per criterion and system; overall mean; paired differences with intervals (B−A, C−A, C−B); weighted kappa per criterion with a reliable / not-reliable flag; counts of factually unsafe summaries; recurring failure tags (wrong number, reversed result, overclaim, missing limitation, missing key result, unsupported statement, wrong attribution, filler, truncated, unreadable, no traceable source); automatic cross-check counts; the operational table. **Misses, false drops, unsupported claims, missing important findings and numerical errors** come from the failure tags and from the Phase 3 F1 review kit (`f1_review.js make --raw <capture>`), which compares what the model said before the guard with what the guard kept; for the native systems, `withheld` lists play the same role. **Hardware** is recorded by hand in the run notes (GPU model, quantisation, server, version) because the machine cannot see it.

## 5.5 Run order (each paid step needs your approval)

1. Phase 4 steps: licences confirmed → 3-paper Claude pilot → compare with the Console → remaining papers. *(Yours.)*
2. `native_compare.js assemble --captures <dir> --claude backend_analyses.json --out items.json --model http://127.0.0.1:PORT/v1 --model-name <name>` with a **local** server, or after your approval of a hosted endpoint (not wired into this script on purpose).
3. `native_compare.js plan` → two raters → `score`.

## 5.6 Demonstration that the machinery runs (not a result)

`node scripts/native_compare.js demo --out DIR` ran on the fictional fixture paper with the stub: 2 units, 9 of 9 sections for both systems, 0 numbers outside their cited text, 0 withheld. System A: "NOT RUN". This shows the sheets and key can be produced and the automatic metrics computed. It says nothing about quality.
