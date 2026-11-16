# ACM SIGMOBILE and shoRDs: research strategy and roadmap

Status 2026-11-03. Written from public web pages and paper abstracts only. No ACM account was used and no paywalled or member-only content was read. Every statement is tagged:

- **[V]** verified on a page or abstract named in the sources list at the end, and what the page said is stated
- **[S]** seen only in a secondary source (a news item or aggregator); treat as likely, not confirmed
- **[R]** my recommendation or inference, not a research finding
- **[U]** not verified; stated so nobody builds on it

## 1. Bottom line

1. **SIGMOBILE is a mobile computing and wireless systems community, not a summarisation or scholarly-search community.** **[V]** Its scope is "mobility of systems, users, data and computing"; its conferences are MobiCom, MobiHoc, MobiSys, SenSys, UbiComp, HotMobile and others. The MobiCom 2025 summer-round LLM papers listed on its programme page are about running or serving models on devices (collaborative training on phones, mixture-of-experts serving, LLM-driven app exploration); none is about text, reading or summarisation. **[V]** (The extract I read listed six papers; I did not confirm that is the whole programme.)
2. **So SIGMOBILE cannot supply shoRDs' summarisation benchmarks, citation intelligence or recommendation methods.** **[R]** Those come from NLP and information-retrieval communities (section 5). Using SIGMOBILE for them would be adding something because it is available.
3. **Where it does give real value: measurement discipline and mobile constraints.** **[R]** shoRDs is an Expo app reaching phones, web and desktop. The questions SIGMOBILE papers answer (memory, latency, energy, offline behaviour, privacy of on-device processing) decide whether an "on-device" or "offline" shoRDs feature is feasible. One measurement study found a 3B-parameter model leaves little room on an 8 GB phone and that mobile deployments took over 30 seconds to give a meaningful output, against under 10 seconds for cloud APIs (section 4). **[V]** shoRDs' current cloud design is therefore the right default, and on-device features should wait for evidence. **[R]**
4. **Membership is not needed to read the research.** **[V]** The ACM Digital Library has been open access since 1 January 2026 per UKSG's report; the sigmobile.org membership page lists GetMobile, proceedings through the Member Value Plus programme, discounted registration, a members' announcement list and priority student travel grants, and does not say membership includes general Digital Library access. Membership's real benefits to shoRDs are community access and event discounts.
5. **Implemented now (low risk, tested, not wired into the product):** a licence gate for any stored paper text, and an offline summary-quality checker. See section 7.

## 2. Access and licensing (what shoRDs may do)

| Point | Status |
|---|---|
| The Digital Library became open access on 1 January 2026, with a free Basic edition and a Premium edition with extra tools | **[V]** UKSG, 21 Jan 2026 |
| New articles carry an author-chosen licence, CC BY or CC BY-NC-ND; CC BY allows commercial reuse including LLM training, CC BY-NC-ND does not | **[S]** AI Weekly summarising a Communications of the ACM opinion piece; ACM's own pages could not be fetched here |
| Licence of the pre-2026 back catalogue, and any rule on text mining or AI training | **[U]** not found; ACM's author-rights FAQ does not address text mining or AI training |
| ACM is consulting on licensing its corpus to LLM developers; no agreement announced | **[S]** same source, dated July 2026 |
| Membership gives unrestricted Digital Library access | **[U]** and not assumed; the membership page says only "Member Value Plus" gives proceedings access |

**Rules shoRDs follows. [R]** (1) The licence recorded on each paper is the authority, never the publisher's brand or "it is open access". Open access means free to read; reuse depends on the licence. (2) No ACM or other paper text is stored for evaluation, redistributed or used for training unless the paper's own licence clearly allows it; unknown means no. (3) Summaries shown to a user at their request are unchanged behaviour and are not decided here. (4) Training on any paper text needs a human decision, even under CC BY, because whether training is covered is a legal question this project has not settled.

### 2.1 What the licence texts say (second pass, 2026-11-03)

Read from Creative Commons' own deeds. The deeds are plain-language summaries that Creative Commons says have no legal value; the licence text governs. **None of this is a legal conclusion.**

| Licence | What the deed says | Status |
|---|---|---|
| CC BY 4.0 | Share and adapt for any purpose, including commercial, with attribution, a link to the licence and a note of changes. Says nothing about AI training | **[V]** deed |
| CC BY-SA 4.0 | As CC BY, but adaptations must be shared under the same or a compatible licence | **[V]** deed |
| CC BY-NC 4.0 | No use primarily intended for commercial advantage or monetary compensation | **[V]** deed |
| CC BY-ND 4.0 | Share verbatim with credit; do not distribute adaptations | **[V]** deed |
| CC BY-NC-ND 4.0 | Both the NC and ND restrictions | **[V]** by combination of the two deeds above; its own deed was not read |
| CC BY-NC-SA 4.0 | NC plus ShareAlike | **[U]** deed not read; treated as NC for the gate |
| CC0 | Free reuse; no warranties; other rights (patent, privacy) unaffected | **[V]** deed |
| Where a copyright exception applies, the licence conditions are not triggered | **[V]** CC FAQ. The FAQ's answers specifically about AI training could not be read, so how this applies to training is **[U]** |
| ACM's author-rights page on text mining, AI use, or which CC licence applies to which papers | **[V] that the page is silent**; other ACM pages did not load. Licence for the pre-2026 catalogue remains **[U]** |

The gate (`backend/papers/licensePolicy.js`) now reports four separate permissions, because a licence can allow one and not another: **inference** (send text to a model for one requester; advisory only, never "no", because the product's behaviour is not decided here), **evaluation corpus** (keep text and derived outputs in an internal set), **training data**, and **redistribution**. Results are `yes`, `review` or `no`, each with a stated basis and the deed URL; a result is "review" wherever the answer turns on law outside the licence. CC0 and public domain are the only automatic yes for training; CC BY is `review` for training because the deed is silent and the answer depends on law. Unknown, missing or unparseable licences are `no` for evaluation, training and redistribution.

## 3. SIGMOBILE: what it is and what it offers

- **Events [V]**: MobiCom 2026, 26 to 30 October 2026, Austin; MobiSys 2026, 21 to 25 June 2026, Cambridge UK; MobiSys 2027 in Ho Chi Minh City (June 2027 per the workshops page).
- **Student and early-career programmes [V]**: MobiCom Student Research Competition (poster session) and student travel grant; MobiSys student travel grant, Rising Stars Forum and ASSET Symposium (amounts and eligibility not stated on the pages read). Priority student travel grants for student members.
- **Other resources [V, listed on the SIG page]**: GetMobile (quarterly, with peer-reviewed papers), a Mobility Tech Pack (an annotated reading list for newcomers; contents not read), a YouTube channel of conference talks, community grants, awards including a Rockstar Award (early-career).
- **Review rules worth knowing [V, MobiSys]**: LLM-generated text in a submission must be identified; hidden text aimed at LLM reviewers is prohibited; single-blind review.

## 4. Research findings relevant to shoRDs

Only the abstract or summary was read. None of these is a SIGMOBILE paper unless stated. "Use" is my recommendation.

| Finding | Source and caveat | Use for shoRDs **[R]** |
|---|---|---|
| Only models under about 4B parameters ran on a Pixel 8; compressed Llama 3.2 variants gave no meaningful answers; mobile latency over 30 s vs under 10 s for cloud; phone memory is the main bottleneck | Yan and Ding, arXiv 2504.00002, preprint, no peer-reviewed venue named; small study | Keep summarisation in the cloud. Do not market offline summarisation. Revisit when a measured model clears a quality bar on shoRDs' own cases |
| An NPU-offload system reports up to 22.4x faster prefill and 30.7x less energy than baselines on Qualcomm phones | Xu et al., ASPLOS 2025 (not SIGMOBILE); figures are the authors' own | Evidence that on-device prefill is improving quickly; watch it, build nothing yet |
| LLM summaries of paper abstracts were more extractive than human ones (about 33 to 40% novel words vs about 46%), mostly overshot requested length, and were harder to read; authors advise human oversight | Lyu and Ke, arXiv 2512.23206, abstracts only, smaller open models | Turned into the checks in section 7: copying, length, readability |
| A 137K-example instruction set over 54 scientific tasks (extraction, summarisation, QA, claim verification, classification); gains largest on extraction and attribution, weaker on summarisation | Wadden et al., arXiv 2406.07835; per-dataset licences are in its dataset card, not checked | Source of task definitions for an evaluation set after a licence check; not a source of training data without review |
| Semantic Scholar offers a free API (lookup, citations, recommendations) and monthly datasets with TLDRs and embeddings; high volume needs a free key under terms of use; abstracts only where licensing allows | Kinney et al., arXiv 2301.10140 | Candidate source for citation graph and related-paper features, subject to its terms of use, which have not been read in full |
| A German consortium runs twelve shared tasks in scholarly document processing | Abu Ahmad et al., arXiv 2509.22141; task names not visible in the abstract | Where to find community-agreed task definitions and metrics; follow the Scholarly Document Processing workshop |

## 5. How established communities organise and find work

- **Shared tasks are how fields agree on definitions and metrics** **[V]**: for scholarly document processing the NFDI4DS consortium alone runs twelve. **[R]** shoRDs should evaluate against a published task definition where one exists, so results can be compared and challenged.
- **Open scholarly graphs are the discovery infrastructure** **[V]**: Semantic Scholar's graph covers 225 million papers and 2.8 billion citation edges per its paper, with a recommendations endpoint. **[R]** shoRDs should consume open graphs and be explicit about coverage rather than build its own index.
- **Venue workshops carry the early ideas** **[V]**: MobiSys 2027 has an "Emerging Ideas" track for early-stage work, and workshop papers are published in the Digital Library. **[R]** The equivalent for scholarly document processing is the SDP workshop, which sits in the NLP community, not SIGMOBILE.
- Other practices (reading-list curation, award-based surfacing, artefact evaluation) exist; I did not verify how SIGMOBILE applies them. **[U]**

## 6. Opportunities for shoRDs

| Area | Opportunity | Basis | Priority |
|---|---|---|---|
| Summary quality | Regression gate on every prompt or model change using the checks in section 7; extend with human-rated samples | [V] study above; implemented | Now |
| Evidence extraction | Evaluate against extraction and claim-verification task definitions from SciRIFF after licence review | [V] | Next |
| Citation intelligence | Prototype related-paper and citation-context features on the Semantic Scholar API; check its terms first | [V] platform; [R] use | Next |
| Discovery and recommendation | Start with the open graph's recommendations; do not build embeddings or a ranker before there is usage data to evaluate against | [R] | Later |
| Mobile reading UX | Offline reading of already-retrieved papers and summaries (cache what the user already opened); no on-device model | [R] from section 4 | Next |
| On-device summarisation | Trigger: a model under about 4B parameters meets shoRDs' own quality checks on a mid-range phone within an agreed latency. Until measured, do not build | [R] | Later, measured |
| Privacy | "Your paper text never leaves your device" is not claimable today because analysis is server-side. Be accurate in copy and policy | [R] | Now (wording) |
| Evaluation of mobile load | Measure shoRDs' own time to first useful result on a low-end phone and slow network; this is the kind of measurement SIGMOBILE papers model | [R] | Next |

## 7. Implemented in this change (local project files; nothing pushed)

| File | Purpose |
|---|---|
| `backend/papers/licensePolicy.js` | Parses licence strings (OpenAlex, Europe PMC, Creative Commons URLs) and answers, per paper, whether its text may enter an evaluation set, be used for training, or be redistributed: yes, review or no. Unknown, missing, non-commercial and no-derivatives licences never pass automatically; training is only an automatic yes for CC0 and public domain |
| `backend/eval/summaryMetrics.js` | Offline checks on a summary against its source: numbers must appear in the source; longest verbatim run and novel n-gram share; word count; readability. No model calls |
| `backend/eval/benchmark.js`, `scripts/eval_summaries.js` | Runs the checks over recorded cases, admits only licence-permitted papers, exits non-zero on failure |
| `docs/evaluation/example_cases.json` | Fictional example cases (one faithful, one with an invented figure, one excluded by licence) |
| `backend/tests/node/evalAndLicense.test.js` | 11 tests, added to `npm run test:node`; includes a test that no runtime module imports the evaluation code |

Evidence: the 11 tests pass; breaking the grounding check and the non-commercial rule made 5 of them fail, and restoring the code made all pass; the full unit suite is 365 tests with 364 pass, 0 fail, 1 documented todo (the same todo as before). The command-line tool returned exit 1 on the invented-figure example and 2 with no arguments.

**What these checks do not do.** They do not measure whether a summary is faithful in meaning, complete or useful. The default limits (120 words, 12-word verbatim run, zero unmatched numbers) are my starting values, not figures from the literature. A number that appears in the source but is attached to the wrong claim passes. Spelled-out quantities are not checked. The licence gate relies on the licence string the provider returned being correct.

### 7.1 Second round (2026-11-03, evening): semantic faithfulness, benchmark, gate

| File | Purpose |
|---|---|
| `backend/papers/licensePolicy.js` (rewritten) | The four-permission gate described in 2.1, with a `basis` for every answer and a `notice` that results are policy rules, not legal conclusions |
| `backend/eval/faithfulness.js` | Claim-level checker: splits a summary into claims, finds the best supporting passages in the source, assigns SUPPORTED / PARTIAL / UNSUPPORTED / CONTRADICTED / NOT_A_CLAIM with flags (`NUMBER_NOT_IN_SOURCE`, `NEGATION_MISMATCH`, `OVERCLAIM`, ...) and character-offset evidence spans that can be re-verified. It is a **deterministic lexical proxy**, not a model of meaning; an optional judge hook lets a model be added later |
| `backend/eval/agreement.js`, `backend/eval/benchmarkScoring.js`, `scripts/score_benchmark.js` | Cohen's kappa, confusion matrix, per-label precision and recall, the count of unsafe claims read as supported, inter-rater agreement. A file counts as human-rated only with two raters and no fixture marker |
| `docs/evaluation/HUMAN_BENCHMARK.md`, `benchmark/annotation_template.csv`, `benchmark/dev_fixture.json` | Annotation protocol (selection through the licence gate, two raters plus adjudication, label definitions, scoring, limitations). The fixture is 3 fictional papers / 24 claims written by one engineer and **is not human-rated** |
| `docs/evaluation/INTEGRATION_ASSESSMENT.md` | How the gate and checker relate to the architecture; they stay modular tooling for now |
| `backend/tests/node/faithfulness.test.js`, `benchmarkScoring.test.js`, `evidenceGaps.test.js` | 13, 5 and 4 tests (the last has 3 `todo` tests pinning gaps found in production validation) |

Evidence: full unit suite 391 tests, 387 pass, 0 fail, 4 todo; integration suite 190 pass, 0 skipped. The checker labelled four hand-written probe cases correctly (altered number, invented number, reversed result, inflated scope); that is four examples, not a measured rate. There is **no human-rated data**, so no accuracy figure for the checker exists.

Finding from probing production validation (`backend/llm/intelligence.js`): narrative statements are not number-checked, so a statement that alters a number is kept. Details and options in `docs/ops/P0_CODE_REVIEW_2026-11-03.md`.

The product is unchanged: nothing in the running application calls this code.

## 8. Roadmap

**Now (done or immediate)**
1. Licence gate and summary checker (done, section 7).
2. Run the checker over recorded outputs from the live prompts whenever a prompt, model or chunking change is proposed; record results in the pre-merge verification. Needs recorded outputs; no paid calls are made by the tool.
3. Check copy and privacy text for any claim implying on-device processing.

**Next (about 1 to 2 months; each needs a short design note)**
1. A small human-rated set (20 to 30 papers across fields, licence-permitted, rated for faithfulness and usefulness) so the automatic limits can be tuned. Without it the thresholds stay guesses.
2. Citation and related-paper prototype on the Semantic Scholar API; read its terms of use; no caching of abstracts beyond what the terms and each paper's licence allow.
3. Offline reading of already-retrieved content in the mobile and web apps (UI: a clear "available offline" state; storage limits shown).
4. Measure shoRDs on a low-end phone and slow network and record the numbers in the observability plan.

**Later (each has a trigger)**
- On-device summarisation: only when the trigger in section 6 is met.
- Own recommendation ranking: only with real usage data to evaluate against.
- Collaboration or publication: see section 9.

**Architecture and UI effects.** Architecture: keep the AI gateway design; add the licence gate in front of any feature that stores or exports paper text; keep evaluation code out of the runtime path (enforced by a test). UI/UX: show licence and source beside every paper (the data is already stored); show coverage honestly (abstract-only vs full text); design offline states before any on-device claim.

## 9. Events, programmes, collaboration

| Item | Date or status | Fit |
|---|---|---|
| MobiSys 2027 paper deadlines | abstract 27 Nov 2026, paper 4 Dec 2026, decision 6 Mar 2027, camera-ready 14 Apr 2027 [V] | **Not recommended for a full paper now**: shoRDs has no measured mobile result to report, and about four weeks is too short to produce one honestly |
| MobiSys 2027 "Emerging Ideas" track | same deadlines; reviews favour originality over maturity [V] | Possible only if there is a genuinely mobile idea backed by a small measurement (for example reading-and-summarising latency across phones). Decide by early-to-mid November; otherwise skip |
| MobiSys 2027 workshops | proposal deadline not yet announced [V] | Watch for a workshop relevant to mobile AI or accessibility |
| MobiCom Student Research Competition and travel grants | recurring; next call not found [V] | Fits a student-led project with a mobile measurement; check the next MobiCom call |
| Scholarly Document Processing workshop and NFDI4DS tasks | ongoing [V] | Better home for summarisation, evidence extraction and citation work than SIGMOBILE |
| Collaboration | none identified | Authors of the cited papers are reachable through their institutions; no outreach has been made or is proposed without the owner's say |

## 10. Keeping SIGMOBILE useful over time

Quarterly (a short note appended to the project register): read the next MobiCom or MobiSys programme for papers on on-device model quality, energy, offline sync and privacy; check whether the on-device trigger in section 6 has been met; re-check ACM's licence and AI-use position (section 2 items marked [S] and [U]); note upcoming deadlines. Items that never produce a decision after two reviews are dropped.

## 11. What was not done or not verified

- ACM's own pages (open access policy, DL licence terms, copyright policy) could not be fetched; licence statements above rest on UKSG and a secondary summary.
- No ACM Digital Library or SIGMOBILE member area was accessed; no paper full text was read; findings use abstracts or summaries.
- The Mobility Tech Pack, GetMobile contents and the Member Value Plus terms were not read.
- Semantic Scholar's full terms of use, SciRIFF's per-dataset licences and BiomedTLDR's licence (the paper names none) were not checked.
- Frontend and mobile code were not changed. The only mobile measurement is of build artefact sizes (web bundle 918,458 bytes gzipped from a 2026-09-30 build); no device timing, battery or latency measurement was made, and nothing has been tested for on-device summarisation. See `docs/ops/PRODUCT_QUALITY_AUDIT_2026-11-03.md`.
- The BY-NC-SA and BY-NC-ND deeds were not read individually; the Creative Commons FAQ answers on AI training could not be read.
- The checker's accuracy against human judgement is unknown until the benchmark in `docs/evaluation/HUMAN_BENCHMARK.md` is rated.

## Sources

- SIGMOBILE membership: https://sigmobile.org/grav/get-involved/membership
- ACM SIGMOBILE page: https://www.acm.org/special-interest-groups/sigs/sigmobile
- UKSG, "ACM now fully OA": https://www.uksg.org/?p=28483
- AI Weekly on ACM and LLM access: https://aiweekly.co/alerts/acm-to-open-digital-library-to-llms-invites-public-feedback
- ACM author rights FAQ: https://authors.acm.org/author-resources/author-rights-faqs
- MobiCom 2026 call: https://sigmobile.org/mobicom/2026/cfp.html
- MobiCom 2025 programme: https://sigmobile.org/mobicom/2025/program.html
- MobiSys 2026 call: https://www.sigmobile.org/mobisys/2026/call_for_papers/
- MobiSys 2027 call and workshops: https://www.sigmobile.org/mobisys/2027/call_for_papers/ and https://www.sigmobile.org/mobisys/2027/call_for_workshops/
- Yan and Ding, mobile LLM efficiency: https://arxiv.org/abs/2504.00002
- Xu et al., llm.npu (ASPLOS 2025): https://arxiv.org/abs/2407.05858
- Lyu and Ke, extreme scientific summaries: https://arxiv.org/abs/2512.23206
- SciRIFF: https://arxiv.org/abs/2406.07835
- Semantic Scholar Open Data Platform: https://arxiv.org/abs/2301.10140
- NFDI4DS shared tasks: https://arxiv.org/abs/2509.22141
