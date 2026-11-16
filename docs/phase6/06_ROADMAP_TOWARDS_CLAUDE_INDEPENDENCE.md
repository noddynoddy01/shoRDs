# Phase 6 / 06 – Updated roadmap towards a Claude-independent production engine

Current truth: a native pipeline exists, is tested with stubs and a fake server, and has never been run with a real language model on a real paper. Claude remains the production default and the fallback. No claim of parity is supported.

| Step | What | Owner input | Gate to proceed |
|---|---|---|---|
| 1 | Run `Probe-Hardware.ps1`; approve and install portable llama.cpp (+ Node if missing); fetch **Qwen3-8B Q4_K_M** (5.03 GB) | approvals A–B in `09` now; C–F only after the probe has been read, machine | probe shows ≥ ~9.5 GB available RAM (else Qwen3-4B); gpt-oss-20b only later and only with ≥ 12.5 GB available |
| 2 | Three licence-confirmed papers, pilot (`server`, `run`) | the three papers and licence records | pipeline completes, stages and tokens recorded; failures listed |
| 3 | Read pilot failures; fix extraction/section problems; re-run | none | no unsafe statements survive the guard on the three papers |
| 4 | PDF extractors on 10–20 real PDFs (poppler vs GROBID vs Docling) | PDFs with permission | extractor chosen on measured numbers; approval before bundling |
| 5 | Blinded B-vs-C human rating on the pilot set | two raters | informs prompt/pipeline design only |
| 6 | Full benchmark: native vs Claude, ≥ 50 papers, two raters, kappa ≥ 0.6, pre-declared rule | Phase 4 budget ($25 STANDARD, local-only), raters, papers | rule in `nativeCompare.decide` met, or not; reported either way |
| 7 | Shadow mode in production (native computes, Claude serves) | approval, deploy | no regressions; spend and licence controls intact |
| 8 | Switch default per paper class where the rule is met; Claude stays fallback | approval | rollback tested |

Open items carried over: Anthropic Console spend limit (owner), Phase 4 benchmark items, the legacy FastAPI cluster decision, and the decision to commit this uncommitted work (nothing from Phases 2–6 is committed or deployed; the owner's `D:\shords` has none of it).
Fine-tuning is not on this path: no training on Claude outputs, and nothing to fine-tune on until the base model has been measured.
