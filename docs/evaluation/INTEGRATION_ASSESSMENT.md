# How the licence gate and the faithfulness checks should connect to shoRDs

Status 2026-11-03. Everything here is modular and not on the request path. The assessment below is why, and what would justify integration.

## What is in the code today (verified by reading it)

- The backend stores the full text of retrieved open-access papers as chunks in the shared database (`paper_chunks`), with a `license` value on the paper row (`backend/papers/paperService.js`). The paper endpoint returns the abstract and metadata, not chunk text (`backend/app.js`, comment at the paper route). Analysis results cite chunk ids.
- Production already checks statements it receives from the model (`backend/llm/intelligence.js`): every statement must cite chunks that were sent and overlap them lexically (at least 20% of its words), and the **value** of a quantitative result must consist of numbers found in its cited chunks. Statements failing these are dropped.
- **What that check does not do (probed 2026-11-03, `backend/tests/node/evidenceGaps.test.js`):** numbers inside narrative statements are not checked against the evidence (a statement that changes 87.4 to 91.7 is kept), the free-text `context` of a quantitative result is not checked (an invented "40 points" is kept), and a statement that reverses the cited result survives because word overlap cannot see negation. The faithfulness checker in `backend/eval` labelled each of these four hand-written cases correctly (altered number and invented number UNSUPPORTED; reversed result CONTRADICTED; inflated scope PARTIAL). That is four examples I wrote, not a measured rate, but it is the strongest argument for running it as a second opinion offline.
- The model call path is the spend gate (`backend/llm/aiBudget.js`) and nothing in the browser calls the provider.

## Where each piece fits

| Piece | Fit | Integration level now |
|---|---|---|
| Licence gate (`backend/papers/licensePolicy.js`) | Decides whether stored text may be (a) kept in evaluation sets, (b) used for training, (c) shown to people other than the requester. (c) will matter the day an evidence viewer shows source passages: for permissive licences it may show the text; otherwise it should show offsets and a link to `source_url`. The licence is already stored per paper, so no schema change is needed. | Library only. Wire it in front of any future evidence viewer and any corpus export, in the same change that creates them |
| Summary checks (`summaryMetrics.js`) | Cheap regression gate on recorded outputs | CLI and, later, a CI step on recorded outputs |
| Faithfulness evaluator (`faithfulness.js`) | Independent second opinion on model output; produces evidence spans a UI can highlight | Offline tool now. Not used to drop or relabel statements in production until the human benchmark shows its error rates, because a wrong automatic label shown to users is worse than none |
| Benchmark scoring | Measures the evaluator and the raters | Offline tool |

## Options and recommendation

1. **Offline regression gate (recommended now).** Record outputs for a fixed set of licence-permitted papers on each prompt or model change; run the checks; attach the report to the pre-merge verification. No production risk, no cost, uses what exists.
2. **Admin-only batch audit (next).** A scheduled job re-checks a sample of recent production answers against their stored chunks and reports rates to the operators. Needs the human benchmark first, so its numbers mean something.
3. **User-facing evidence view (later).** Highlight the supporting passage for each statement using stored chunks and offsets. This is the strongest product feature (a reader can check a claim in one tap) and needs the licence gate in front of it. The evaluator should not decide which label a reader sees until its measured error rate is acceptable; the production citation check can drive the view meanwhile.
4. **Replacing the production check with the evaluator: not recommended.** It would trade a stricter existing rule (cite or be dropped) for a looser proxy.

## Triggers to move from one level to the next

Human benchmark exists with kappa at least 0.6 and the evaluator's "unsafe read as supported" rate has a known upper bound the owner accepts; the evidence view has a design and the gate is wired in front of it; a reviewer confirms the licence handling.
