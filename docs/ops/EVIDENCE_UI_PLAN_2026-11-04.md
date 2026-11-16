# Evidence experience: what is built, what is not shown, and how to wire it

> **Status update (Phase 4, 2026-11-04):** items 1 to 4 of "Wiring steps that remain" and D-UI-1 and D-UI-2 are now implemented: `services/analysisClient.ts`, `components/research/AnalysisPanel.tsx` on `app/paper/[id].tsx`, the server-side licence gate (`responseGate.js`) and the personal project endpoint. The analysis starts only from a button. Copilot answers are gated on the server and their licence note is mapped in `copilotMapping.ts`; routing Copilot answers through the same statement card (step 5) and the real-device visual check (step 6) are **not done**. See `PHASE4_CHANGE_REPORT_2026-11-04.md`. The text below is the Phase 3 plan and is kept for history.


Date: 2026-11-04. Branch `p0-fixes`, uncommitted. Status: **building blocks implemented and tested; not displayed anywhere.** No screen in the app calls the backend analysis today, so a user still cannot see a cited sentence. I did not change the paper screen because it needs a product decision (below) and because I cannot run the app visually here.

## Built (all new files, nothing existing was rewired)

| File | Role | Verified how |
|---|---|---|
| `services/evidenceModel.ts` | Pure logic: reads an analysis response into display objects, summarises removed statements, builds the evidence request, caches sentences, fixed wording (`EVIDENCE_COPY`) | `backend/tests/node/evidenceUi.test.js` (8 tests, run on Node 22, transpiled with the project's TypeScript) |
| `components/research/EvidenceStatementCard.tsx` | One statement with "Show source sentence", licence-withheld state, no-match state, link to the paper, hedge/scope notes | Type-checked on the owner's machine (TypeScript 5.9.3, exit 0). **Never rendered.** |
| `components/research/EvidenceSummaryNote.tsx` | Line showing how many statements the automatic checks removed, plus the standing caution | Type-checked only. **Never rendered.** |
| Backend `GET /api/v1/papers/*/evidence/*` | Serves the exact characters only when the paper's licence allows redistribution; otherwise `{available:false, reason}` | Real PostgreSQL + Redis integration test; Phase 3 fix: the licence check now comes before the span-length check so a restricted paper does not leak chunk length |

## The five requirements and where each stands

1. **Source sentence beside the claim.** Statement carries `evidenceSpans` (chunk id, start, end) from the guard; the card requests each span from the endpoint on demand and shows it with the paper's attribution. Built, not shown.
2. **Explicit when the licence forbids it.** Endpoint answers `available:false`; card shows `licenseWithheld`. Tested for CC BY-NC, CC BY-ND, publisher-specific and unknown licences.
3. **Link to the original paper.** Card takes `paperUrl` (DOI link or source page from the analysis response `paper.sourceUrl`/`doi`). Built.
4. **How many statements the automated checks removed.** From `verification.statementsDropped` and `droppedReasons`; wording says "removed by the automatic checks" and, when zero, still says errors can remain. Built.
5. **Never a guarantee.** `checkNote` is fixed copy; the component never uses the words verified, accurate, confirmed, and never shows the backend `confidence` number (it is a heuristic over counts, not a probability). A test fails if the banned words appear in any copy string.

## Wiring steps that remain (in order)

1. **Decide the project model** (owner decision D-UI-1). `POST /api/v1/analysis` requires a `projectId` where the user is EDITOR, an `Idempotency-Key`, returns 202 with a poll URL. The app has no project concept in the paper flow. Options: (a) one auto-created personal project per user, created on first analysis; (b) expose projects in the UI. (a) is the smallest.
2. **Analysis client** in `services`: create project once, POST with a fresh Idempotency-Key per user tap, poll with backoff to a ceiling, map `ApiError` kinds (budget exhausted, kill switch, unauthorised) to plain messages. Parse the finished job with `parseAnalysisForDisplay`.
3. **Explicit user action.** Analysis spends money. It must be a button the user presses, never automatic on opening a paper. Show the user's remaining allowance if the API exposes it; if not, say it is limited.
4. **Paper screen** (`app/paper/[id].tsx`): render `EvidenceSummaryNote` once above the list and `EvidenceStatementCard` per statement and per quantitative result. Keep the on-device brief visually distinct and labelled as such.
5. **Copilot answers** already carry evidence with text (see D-UI-2): route them through the same card so both screens behave identically.
6. **Visual check** on a phone-width web build and a real device: card heights, long sentences, very long DOI links, loading and error states, screen-reader labels, keyboard focus on web, dark mode. Not possible in this environment.

## Decisions needed

- **D-UI-1** project model for analysis (above).
- **D-UI-2 licence consistency.** The evidence endpoint refuses text for non-redistributable licences, but analysis and Copilot responses still include `evidence[].text` excerpts regardless of licence. Two consistent options: apply the same licence gate when building those responses (my recommendation; small backend change plus tests), or document that short excerpts are treated as fair-use quotation and keep them. This is a rights question; I did not change behaviour.
- **D-UI-3** whether to show the quantitative-results `context` when the guard stripped it (current model shows only what survived).

## Known limits of the display

- Sentence spans come from lexical overlap (idf sentence coverage at least 0.4). The sentence shown can be the wrong one or none; the card has a no-match state and the standing caution says so.
- A statement can pass every automatic check and still be wrong (wrong attribution, reversed meaning without a cue word, context-dependent claims; see `backend/tests/fixtures/evidence_limits_register.json`). Showing the sentence is the mitigation: it lets the reader check, it does not make the statement correct.
- Nothing here has been validated against real-world summary accuracy.
