# Summary-quality benchmark: results

**There are no results.** No papers were collected, no summaries were rated, no agreement was computed. The sandbox I work in cannot reach OpenAlex or any scholarly source, no raters were available, and I will not invent ratings or present synthetic test data as findings.

What exists: the complete, tested pipeline (`scripts/summary_benchmark.js collect|device|plan|score`, `backend/eval/summaryBenchmark.js`, 7 tests) and the protocol (`SUMMARY_BENCHMARK_PROTOCOL.md`): 50 papers across 6 fields, licence gate in code, five criteria, two blinded independent raters, quadratic-weighted kappa with a 0.6 reliability flag, failure-tag tally, device-brief vs backend-analysis comparison with bootstrap intervals.

Limitations of any future result from this design: CC BY open-access papers are not a random sample of the literature; 50 papers support large differences only; two raters give a rough kappa; the backend analysis depends on prompt version `2026.3-intel` and the model used on the run date and must be re-run when either changes; the study judges summaries against the paper, not whether the paper is right.

**Hypotheses the study should test (not findings):** (1) the device brief, being extractive and rule-based, is more faithful per sentence but less complete and less readable than the backend analysis; (2) the backend analysis has more unsupported statements and overclaims, which the claim guard now partly removes; (3) evidence traceability is much higher for the backend analysis. I have no data for any of these.

Recommendation: do the study before making any public claim about accuracy. Cost: rater time plus about 50 normal analyses on the production key (set a spend cap first).
