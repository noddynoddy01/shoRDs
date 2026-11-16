# 5, 6, 7, 8. Architecture, prototype, pipeline and evidence integration

Date 2026-11-04 · code in `backend/native/` (new, isolated) · **Status: IMPLEMENTED and TESTED with the free extractive stub and with faulty/hostile fake models. MEASURED: nothing about model quality. NOT RUN: any real language model, any real paper, any real PDF other than one fictional PDF.**

## 4.1 Diagram

```
                       (a person or the benchmark runner)                                   NOT wired into the production path
                                     │                                                      (no file in llm/, app.js, runtime.js requires native/)
   paper text ──────────────────────▼───────────────────────────────────────────────────────────────────────────────────────────┐
   JATS / HTML (existing extractor)   A  DOCUMENT INTELLIGENCE   documentIntelligence.js                                        │
   pdftotext output (external tool)      sections · chunks with ids · page provenance · quality report                          │
                                         flags: NO_BODY_TEXT SHORT_TEXT GARBLED_TEXT EQUATIONS_NOT_PRESERVED                    │
   licence gate ── fullTextAllowed? ──►   FIGURE_CONTENT_NOT_READ TABLE_STRUCTURE_LOST  (reuses papers/chunker.js unchanged)     │
   (caller, from papers/licensePolicy)   no body / not allowed ⇒ ABSTRACT_ONLY                                                  │
                                     │ chunks                                                                                   │
                                     ▼                                                                                          │
                                      B  STRUCTURED EXTRACTION  structuredExtraction.js                                         │
                                         12 fields: problem · gap · objective · method · dataset · setup · baselines ·          │
                                         contributions · quantitative findings · limitations · future work · assumptions        │
                                         per field: retrieve candidate chunks ─► model ─► keep item only if it cites a given    │
                                         chunk AND the quote is found verbatim in it (else dropped and counted). NO summary.     │
                                     │ anchored claims                                                                          │
                                     ▼                                                                                          │
                                      C  HIERARCHICAL SUMMARISATION  hierarchical.js                                            │
                                         section summaries (long sections: groups ─► merge) + section claims                     │
                                         one claim list (de-duplicated, ids c1..cn, each keeps its citations)                    │
                                         method ↔ result links · possible contradictions (flag for a person)                     │
                                         = PAPER-LEVEL REPRESENTATION                                                           │
                                     │ claims only (raw text is not sent again)                                                 │
                                     ▼                                                                                          │
                                      D  BRIEF  brief.js                                                                        │
                                         In Brief · Research Problem · Why It Matters · Proposed Method · Key Contributions ·    │
                                         Major Findings · Quantitative Results · Limitations · Future Directions                │
                                         a statement must name the claim ids it rests on (else discarded); section with no       │
                                         claim ⇒ "Unavailable: …" with a reason code, never filled in                            │
                                     │ draft                                                                                    │
                                     ▼                                                                                          │
                                      E  EVIDENCE & VALIDATION  validation.js                                                   │
                                         existing llm/claimGuard.checkStatement on every statement (numbers · direction ·       │
                                         negation · overclaim · hedge/scope) + unsupported-conclusion + prior-work attribution   │
                                         withheld statements are listed with a code, not shown                                  │
                                         second gate: production llm/intelligence.validateIntelligence                          │
                                         label: SUPPORTED_BY_AUTOMATIC_CHECK  (never "verified")                                │
                                     │                                                                                          │
                                     ▼                                                                                          │
                          result: brief + evidence (chunkId, quote, spans) + diagnostics   (no raw model text) ◄─────────────────┘

   Every model call in A–E goes through ONE function:  modelAdapter.invoke(model, …)
        ┌───────────────────────────── modelAdapter.js ─────────────────────────────┐
        │ stub (free, offline, NOT a language model)                                  │
        │ openaiCompatible ─ local server (free)  |  remote (refused unless allowRemote + verified price + https + key)
        │ claudeFallback   ─ only from a client already behind aiBudget.guardClient (attestation required)
        │ withSpendLimit   ─ ceiling defaults to $0; worst case reserved before the call; unmeasured cost = worst case
        │ createRouter     ─ ordered providers; a spend/policy refusal is never retried on another paid provider
        └──────────────────────────────────────────────────────────────────────────────┘
        Same call shape as the production client ⇒ can sit behind aiBudget.guardClient unchanged (TESTED against the real gate).
```

## 4.2 Files

| File | Role | Tests |
|---|---|---|
| `backend/native/modelAdapter.js` | provider seam, spend limit, router, single call site | `nativeAdapter.test.js` (8) |
| `backend/native/documentIntelligence.js` | Stage A | `nativePipeline.test.js` |
| `backend/native/structuredExtraction.js` | Stage B | same |
| `backend/native/hierarchical.js` | Stage C | same |
| `backend/native/brief.js` | Stage D | same |
| `backend/native/validation.js` | Stage E, production-validator gate | same |
| `backend/native/pipeline.js` | orchestration, rendering | same |
| `backend/native/prompts.js` | versioned prompts (`native-0.1`), production tag escaping | same |
| `backend/native/extractiveStub.js` | the free stand-in "model" | same |
| `backend/native/directBaseline.js` | comparison system B (one prompt, same guard) | same |
| `backend/eval/nativeCompare.js` | three-system blinded comparison, decision rule | `nativeCompare.test.js` (8) |
| `scripts/native_run_local.js`, `scripts/native_compare.js`, `scripts/native_cost_model.js` | local drivers | run by hand (below) |

## 4.3 What each stage guarantees, and the test that shows it

| Guarantee | Test (in `nativePipeline.test.js` unless stated) |
|---|---|
| Every shown statement has ≥1 evidence entry `{chunkId, quote}` and the label `SUPPORTED_BY_AUTOMATIC_CHECK` | "full run on a JATS paper" |
| A claim citing a chunk that was not given, or quoting text not in the chunk, or citing nothing, is dropped and counted | "unknown chunk id or a quote that is not in the chunk" |
| An invented number, an overclaim and a reversed direction are withheld by the **existing** claim guard | "a model that invents a number, reverses a result or overclaims" |
| Garbage, truncated, policy-refused and failing model answers produce "Unavailable", never a crash or a fill-in | "garbage, truncated and policy-refused" |
| Missing information is stated as unavailable | "missing information is stated as unavailable" |
| Without `fullTextAllowed` the engine uses the abstract only (licence gate respected) | "licence gate" |
| Paper text cannot forge a prompt tag | "paper text cannot forge a prompt tag" |
| A cited prior-work result is not shown as this paper's own | "cited prior work" |
| Long sections are summarised in groups and merged; results are linked to the method | "long sections…", "method ↔ result link" |
| The result carries no raw model text | "never contains raw model output" |
| Deterministic for a deterministic model | "deterministic" |
| The existing spend gate fail-closes an unpriced native model, prices it once a person sets a price, honours the kill switch, and with the gate refusing the engine produces nothing rather than bypassing it | `nativeAdapter.test.js` "the production spend gate…" |
| No production file requires `native/`; `native/` names no provider and reads no environment outside the adapter | "isolation" |

## 4.4 Run it yourself

```
node scripts/native_run_local.js --file <paper.txt|paper.pdf|paper.xml> --paper-id demo --full-text-allowed
```
Default model is the stub. `--model http://127.0.0.1:8000/v1 --model-name <name>` points at a local server you start yourself (llama.cpp, vLLM, Ollama). The script **refuses any non-local address**: paid inference needs your approval (see `06_COST_AND_SCALING.md`). `--full-text-allowed` is your statement that the paper's licence permits processing its full text.

Measured on the fictional two-page PDF (stub model, this container): 20 model calls, about 40 ms, 25 statements shown, 0 withheld. These numbers measure plumbing speed, **not** language-model latency.

## 4.5 What is not done (stated plainly)

- No real language model has been called by this pipeline. Prompt quality, JSON compliance, and the 20-to-25-call design are untested on real models.
- PDF handling was exercised on one fictional PDF through `pdftotext` (poppler, GPL: invoked as a separate process). It exposed real limits: table cells lose their columns, equations are set aside, a two-page text needed a header heuristic. Production needs a layout-aware extractor service; its choice is a decision (D-5-3).
- The plain-text section detector is heuristic and has seen only fixtures.
- Retrieval inside Stage B is rule-based (section priority, cue words). Embedding retrieval is PROPOSED.
- The stub's choices (for example it listed "Our contributions are threefold." as a contribution) show why stub output must never be read as quality.
