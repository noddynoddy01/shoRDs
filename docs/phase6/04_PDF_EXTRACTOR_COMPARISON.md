# Phase 6 / 04 – PDF extraction: poppler versus layout-aware extractors

## Scope and honesty
- **MEASURED:** poppler `pdftotext` (default reading order and `-layout`) and poppler-render + Tesseract OCR, on a **synthetic corpus of four PDFs I generated** (`docs/phase6/evidence/pdf_corpus/`, fictional content, ground truth in `*.truth.json`). Results: `docs/phase6/evidence/pdf_eval_result.json`. Reproduce: `node scripts/pdf_eval.js run --corpus docs/phase6/evidence/pdf_corpus --ocr --out result.json`.
- **NOT RUN:** GROBID and Docling. Docker and Java exist on the cloud VM, but images, models and packages cannot be downloaded (no route to the registries). An attempt to read their GitHub pages was withheld pending permission, so their licences below are **RECALLED/UNVERIFIED**.
- **NOT RUN:** real-world PDFs. None were supplied with permission. The owner's Downloads folder holds personal documents; I did not open any.
- The scoring code (`backend/eval/pdfExtraction.js`, 7 unit tests in `pdfExtraction.test.js`) knows only the extractor's text output, so GROBID or Docling output can be scored by the same code once they are run.

## Measured table (synthetic, 2 vCPU)
| Document | Extractor | Anchors found / in order | Headings found / in order | Table rows intact | Equations | References | Page breaks kept / anchors on right page | ms |
|---|---|---|---|---|---|---|---|---|
| one-column with tables | poppler default | 1 / 1 | 1 / 1 | **0** (cells all present) | 1 | 1 | yes / n/a | 25 |
| one-column with tables | poppler `-layout` | 1 / 1 | 1 / 1 | **1** | 1 | 1 | yes / n/a | 17 |
| two-column, flowing | poppler default | 0.92 / 0.75 | 0.86 / 0.83 | 0 | 1 | 0.88 | yes / 1 | 27 |
| two-column, flowing | poppler `-layout` | **0.31** / 1 | **0.14** / 1 | 0.2 | 1 | **0.38** | yes / 1 | 26 |
| two-column, scrambled stream | poppler default | 1 / 0.77 | 1 / 0.71 | 0 | 1 | 1 | yes / 0.92 | 27 |
| two-column, scrambled stream | poppler `-layout` | 1 / 0.77 | 0.43 / 1 | 1 | 1 | 0.25 | yes / 0.92 | 24 |
| scanned page (no text layer) | poppler (either mode) | 0 | 0 | 0 | 0 | n/a | – | 13–14 |
| scanned page | poppler render + Tesseract OCR | 1 / 1 | 1 / 1 | 0 (cells all present) | 0.5 | n/a | yes / 1 | ≈ 3000 |

## What this shows (and does not)
1. **No poppler mode wins.** Default order keeps paragraphs and sections together but flattens tables into one cell per line (row integrity 0). `-layout` keeps table rows on one line but interleaves the two columns of ordinary text (anchors found falls to 0.31 on flowing two-column text, heading recall to 0.14). A system that needs both reading order and table relationships cannot get them from one poppler call; it can run both and choose per region, which is work.
2. Page provenance is preserved by poppler (form feeds); scrambled content streams cost some reading order but not page numbers.
3. Scanned PDFs produce nothing without OCR; OCR recovered all anchors and headings on the one page tested, lost half the equations and all table row structure, and costs ≈ 3 s per page on 2 vCPU.
4. These are four small, clean, synthetic documents that I wrote. They show the **kinds** of failure, not their frequency in real papers. They say nothing about GROBID or Docling.

## Candidate comparison (UNVERIFIED rows are from memory; confirm before any decision)
| | poppler pdftotext (+ Tesseract) | GROBID | Docling |
|---|---|---|---|
| Role | text, per-page; separate process | scholarly-PDF → TEI XML (header, body sections, references, figures/tables) | general document conversion (layout model, tables, reading order, formulas) |
| Licence | GPL-2/3 (poppler), Apache-2.0 (Tesseract) – used as an external process, not linked | Apache-2.0 (RECALLED/UNVERIFIED) | MIT (RECALLED/UNVERIFIED) |
| Runtime | native binary, tiny | Java service (Docker usual); several GB of RAM for the deep-learning models (UNVERIFIED) | Python package that downloads layout/table models on first use (UNVERIFIED); GPU optional |
| Fit with this backend | already used; zero new dependency | a sidecar service the Node backend calls over HTTP | a sidecar or batch job; not a Node library |
| Evaluated here | yes, synthetic only | NOT RUN | NOT RUN |

## Recommendation (PROPOSED; nothing bundled)
Keep poppler as a separate process for production now (decision D-5-3 stands). Do not add a layout-aware extractor to production without approval. Next: the owner supplies 10–20 licence-confirmed open-access PDFs with at least a few two-column, table-heavy and equation-heavy ones; GROBID and Docling are run locally against the same scorer; the choice is made on those numbers plus their runtime and memory. JATS XML, where a publisher supplies it, remains better than any PDF extractor and is already the preferred input.
