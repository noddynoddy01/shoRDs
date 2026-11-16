# Human-rated faithfulness benchmark: protocol

Status 2026-11-03. **No human ratings exist yet.** `benchmark/dev_fixture.json` is a regression fixture written and labelled by one engineer; it is explicitly marked `DEV_FIXTURE_NOT_HUMAN_RATED` and says nothing about accuracy on real summaries. This document is the protocol for producing the real benchmark. The tooling (`backend/eval/agreement.js`, `backend/eval/benchmarkScoring.js`, `scripts/score_benchmark.js`) is built and tested; the people and the papers are the missing part.

## 1. What the benchmark measures

Whether each **claim** in a shoRDs summary is backed by the paper it summarises, and whether the automatic evaluator (`backend/eval/faithfulness.js`) agrees with careful readers. It does not measure style, whether the summary is useful overall, or whether the paper itself is correct.

## 2. Paper selection

1. **Licence first.** Only papers whose recorded licence passes `selectEvalCorpus` (`evalCorpus` = "yes" in `backend/papers/licensePolicy.js`: CC0, public domain, CC BY and CC BY-SA; CC BY-ND is "review" and enters only after a person has checked it and `allowReview` is set deliberately; NonCommercial, unknown and "free to read" never enter). The `collect` command additionally narrows its search to CC BY, CC0 and public domain, which is stricter than the policy. Never include a paper whose licence is unknown, NonCommercial, or "free to read". Record the licence string, the licence URL and the retrieval date with each item.
2. **No ACM-specific assumption.** ACM's Digital Library is open to read, but ACM's own pages read in this project say nothing about text mining or AI use. An ACM paper enters only if its own page shows a CC BY or CC0 licence.
3. **Sampling frame.** Open-access full text from sources shoRDs already retrieves (Europe PMC, arXiv, OpenAlex locations). Stratify so that no field, length band or section structure dominates: aim for at least 4 fields (for example biomedical, machine learning, physics, social science), short and long papers, empirical and theory papers, papers with and without a limitations section, and papers with many numeric results.
4. **Size.** Pilot: 20 papers, about 8 to 12 claims each (about 200 claims). A pilot of this size can show whether the protocol works and give a rough kappa; it cannot show small differences between evaluator versions. Plan 60 or more papers before using the results to choose between methods. Report the confidence interval, not only the point value.
5. **Where the summaries come from.** The production prompt run on the selected papers, recorded once and stored with the prompt version, model name and date, so that ratings stay tied to what was shown. Include some deliberately flawed summaries (an altered number, a dropped hedge, a flipped result) so the raters' ability to catch errors is itself measured; label these in a field the raters cannot see.
6. **Storage.** Keep only what the licence allows: paper id, licence, offsets and short quotations. Do not copy full text into a repository or share a benchmark file that contains text the licence does not allow to be shared.

## 3. Raters

Two independent raters per item, a third adjudicator for disagreements. Raters are blind to the model, the prompt version, the evaluator's output and each other's labels. Raters need subject familiarity; recruit them (colleagues, domain students) with a short briefing and a written consent for their ratings to be used. A calibration round of 20 claims (not counted) is rated first and discussed.

## 4. Labels (one per claim)

| Label | Definition |
|---|---|
| SUPPORTED | The paper states what the claim says, in the same scope and strength. Paraphrase is fine. |
| PARTIAL | Part of the claim is supported, or the claim is stronger, broader or less hedged than the paper, or it mixes two findings. |
| UNSUPPORTED | The paper does not state this, or it is a number, name or result that does not appear in the paper. |
| CONTRADICTED | The paper states the opposite, or a different value for the same quantity. |
| NOT_A_CLAIM | A question, a heading or a fragment with no assertion. Excluded from scoring. |

Rules: judge against the paper only, never against outside knowledge of whether the claim is true. A claim that is true in the real world but absent from the paper is UNSUPPORTED. When a claim has two assertions, rate the weakest. Mark the supporting passage (start and end offsets) for SUPPORTED, PARTIAL and CONTRADICTED. Optional flags: NUMBER, DIRECTION, NEGATION, HEDGE, OVERCLAIM, SCOPE, WRONG_ATTRIBUTION.

Summary-level questions, asked once per summary: (1) Does the summary omit a result, limitation or caveat that a reader needs? (yes/no and which). (2) Would you act on this summary without opening the paper? (yes/no/with checks).

## 5. Scoring

- **Inter-rater agreement:** Cohen's kappa for each rater pair on the four labels, plus exact agreement; report the confusion matrix. Working target: kappa of at least 0.6 on the four labels before ratings are used (a common convention for "substantial" agreement, not a guarantee). If it is lower, revise the guidelines and re-rate, rather than averaging noise.
- **Reference label:** the adjudicated label.
- **Evaluator versus reference:** exact agreement, kappa, per-label precision and recall, and the decision that matters to a reader, "can this claim be read as written" (SUPPORTED) versus "check it" (anything else). **The costly error is an unsafe claim read as SUPPORTED**; report that count and its rate separately, with the confidence interval.
- **Thresholds:** the evaluator's thresholds (`THRESHOLDS` in `faithfulness.js`) are tuned on a development half and reported on a held-out half, never tuned and reported on the same items.
- **Judge comparison:** if a model judge is added, score it the same way, and report its cost per claim.
- Run with `node scripts/score_benchmark.js <file>`; a file is reported as human-rated only if it has at least two raters and is not marked as a fixture.

## 6. Known limitations to state with every result

Raters can share blind spots; adjudication by one person adds that person's bias. Small samples give wide intervals. Claim splitting by sentence puts several assertions in one claim. The lexical evaluator cannot understand paraphrase or comparison words it has no rule for; on the author's own fixture it missed contradictions that used "above" versus "keeps", and "stronger" versus "weaker". Abstract-only papers give raters less to check against. Papers outside the sampled fields are unrepresented. The benchmark shows agreement with careful readers on these papers, not truth.

## 7. Files

`benchmark/annotation_template.csv` (one row per rated claim), `benchmark/dev_fixture.json` (development only), and the rated benchmark file once it exists, with the same item shape: `{id, license, source, claims:[{text, ratings:{raterA, raterB}, adjudicated}]}`.
