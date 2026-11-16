# Phase 6 / 02 – Real-model integration, three-paper pilot, one-shot versus multi-stage, cost and latency

> **Phase 6A update:** pilot driver gained `--no-thinking` (Qwen3 hybrid models) and now creates the output folder for `server`/`probe`; both tested (8 tests in `nativePilot.test.js`). A self-contained kit (`shords-pilot-kit.zip`) was built from the computed require-closure of the driver and run from its extracted copy against a fake local server (protocol only). The pilot itself is still **NOT RUN**.

## 1. What is IMPLEMENTED and TESTED (protocol level only)

The Phase 5 pipeline (A document intelligence → B quote-anchored extraction → C hierarchical merge → D nine-section brief → E claim guard plus production `validateIntelligence`) is unchanged. A real local model enters through the same single call site, `invoke()`, via `createOpenAiCompatibleAdapter`. Changes, all additive:

- `backend/native/modelAdapter.js`: `timeoutMs`; `reasoningHeadroomTokens` (extra output budget for hidden reasoning); `serverTimings` (llama.cpp's own prompt/generation timings are passed through when present). Loopback servers are `FREE_LOCAL`; a remote server still needs allowRemote, a price, https and a key. Spend limits and licence controls are not touched.
- `backend/native/{structuredExtraction,hierarchical,brief,directBaseline}.js`: call metadata now carries `serverTimings` and `truncated`.
- `backend/eval/pilotMetrics.js` and `scripts/native_pilot.js` (`probe`, `server`, `run`, `report`): local only (refuses any non-loopback address), licence-gated (a paper is processed only if a person recorded `licence.confirmedBy` and `permissionsFor()` allows keeping the text and derived outputs; ids starting `pap_fixture` or `fictional` are refused), runs system B (one prompt) and system C (multi-stage) on the **same** chunks with the **same** model, records per paper: sections detected, claims extracted / rejected (with reasons), evidence passages, numerical preservation, missing sections, statements the guard rejected, per-stage and total latency, actual input and output tokens as reported by the server, and writes blinded B-vs-C rating sheets.
- Tests: `nativeAdapter.test.js` (additions) and `nativePilot.test.js` (6 tests). The pilot tests drive the real HTTP path against a **fake llama.cpp server written for the test**. That proves the protocol, the licence gate, the blinding and the report; it proves nothing about any language model's quality.

Full suite after Phase 6: 626 tests, 625 pass, 1 todo (pre-existing), 0 fail.

## 2. Three-paper pilot – NOT RUN

Blockers, in the order they bind:
1. **No model is available here.** The sandbox has no route to Hugging Face, and the 7.8 GB VM could not hold a 20B-class model anyway.
2. **No licence-confirmed real papers are in hand.** Europe PMC search was rate-limited twice and paper sources are not reachable from the sandbox. I will not substitute fictional papers, and I will not use anything whose licence a person has not confirmed. No candidate shortlist exists.
3. The owner's hardware is not yet known.

What the owner supplies (superseded by `08_LOCAL_SETUP_WINDOWS.md` and `09_APPROVAL_CHECKLIST.md`, which give exact PowerShell 5.1 steps, a standalone kit that does not need `D:\shords`, and the first model Qwen3-8B; the list below is the original outline):
1. `node scripts/native_pilot.js probe --out hardware.json`
2. Install llama.cpp (release build for the platform), download the gpt-oss-20b MXFP4 GGUF, start `llama-server` on 127.0.0.1.
3. Pick three open-access papers whose licence permits full-text reuse and derived outputs (CC-BY or CC0 recommended), from different domains: one with straightforward methodology, one with heavy quantitative results, one with complex methodology, limitations and tables. Record each in `papers.json` with `licence.confirmedBy`, `confirmedOn`, `sourceUrl`, `spdx`, `fullTextAllowed: true`. JATS XML is the best input (sections and tables are explicit); plain text works; PDF goes through poppler.
4. `node scripts/native_pilot.js server --base http://127.0.0.1:8080/v1 --model gpt-oss-20b` (checks the server and measures one short generation), then `node scripts/native_pilot.js run --papers papers.json --base … --model gpt-oss-20b --revision <sha> --quant MXFP4 --runtime "llama.cpp b<N>" --hardware hardware.json --out pilot1`.
5. Send back the `pilot1` folder. Nothing in it needs to leave the machine except the report; the rating sheets can be filled in by two people.

## 3. One-shot (B) versus multi-stage (C) – NOT RUN

The kit produces, for the same model, paper, source chunks and criteria: automatic measurements for B and C (claims kept / dropped by the guard, numeric preservation, sections filled, tokens, latency) **and** blinded sheets for human judgement of factual accuracy, completeness, quantitative accuracy, methodology understanding, limitation identification, evidence traceability and readability. Automatic numbers are not quality judgements ("number coverage" is not accuracy). I do not assume C is better; the sheets are built so a rater cannot tell which system wrote which brief. The existing pre-declared decision rule in `nativeCompare.decide` (≥50 papers, kappa ≥ 0.6, non-inferiority or superiority interval, unsafe-statement rate) is unchanged and is **not** met by a three-paper pilot. A pilot can say whether the pipeline runs and where it fails; it cannot say the native system beats Claude.

## 4. Cost and latency

| Item | Value | Label |
|---|---|---|
| Real-model tokens in / out | none | NOT RUN |
| Real-model stage and total latency | none | NOT RUN |
| Cost of a local run | no per-token charge (loopback = FREE_LOCAL); electricity and the owner's time only | PROPOSED (by design), not measured |
| Poppler text extraction, 2-page synthetic PDFs, 2 vCPU | 13–27 ms | MEASURED |
| Tesseract OCR of one scanned page, 2 vCPU | ≈ 3.0 s | MEASURED |
| Paid API calls made this phase | 0 | MEASURED (none made) |
