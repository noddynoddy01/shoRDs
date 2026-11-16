"use strict";
/**
 * Metrics for comparing PDF text extractors against a hand-written ground truth (Phase 6).
 *
 * Input to every metric is just the extractor's TEXT output (pages separated by form feed, as pdftotext writes them) and a ground-truth
 * record. Nothing here knows which extractor produced the text, so poppler, GROBID, Docling, OCR or any later tool is scored by the same code.
 *
 * ground truth = {
 *   id, pages, scanned?,
 *   anchors:   [{ text, page }]               // the first words of each paragraph, in the correct reading order
 *   headings:  [string]                       // section headings in order
 *   tables:    [{ rows: [[cell, ...], ...] }] // every cell as it should be read
 *   equations: [string]
 *   references: number                        // number of reference entries
 * }
 *
 * What the scores mean, and do not mean: they say how well the TEXT preserves order, headings, table rows, equations, references and page
 * numbers for the documents in the ground truth. A synthetic or small ground truth says nothing about the extractor on other layouts.
 */
const norm = (s) => String(s).normalize("NFKC").replace(/[­​]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const squash = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, "");
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/** length of the longest increasing subsequence of `a` (patience sorting) */
function lis(a) {
  const tails = [];
  for (const x of a) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;
  }
  return tails.length;
}

function pagesOf(text) { return String(text).split("\f").filter((p, i, arr) => !(i === arr.length - 1 && !p.trim())); }

/** Position of `needle` in the squashed text (searching from `from`), or -1. */
function find(hay, needle, from = 0) { return hay.indexOf(squash(needle), from); }

function readingOrder(text, truth) {
  const hay = squash(text);
  const pos = truth.anchors.map((a) => find(hay, a.text));
  const found = pos.filter((p) => p >= 0);
  // order score: of the anchors that are found at all, the fraction that stay in truth order (longest increasing subsequence)
  return { anchors: truth.anchors.length, found: found.length, recall: round(found.length / truth.anchors.length), inOrder: found.length ? round(lis(found) / found.length) : null };
}

function pageProvenance(text, truth) {
  const pages = pagesOf(text).map(squash);
  if (pages.length <= 1 && truth.pages > 1) return { pageBreaksPreserved: false, pagesInOutput: pages.length, pagesInTruth: truth.pages, anchorsOnCorrectPage: null };
  let ok = 0, seen = 0;
  for (const a of truth.anchors) {
    if (!a.page) continue; // page 0 = the page of this anchor is not part of the ground truth
    const idx = pages.findIndex((p) => p.includes(squash(a.text)));
    if (idx >= 0) { seen += 1; if (idx + 1 === a.page) ok += 1; }
  }
  return { pageBreaksPreserved: pages.length === truth.pages, pagesInOutput: pages.length, pagesInTruth: truth.pages, anchorsOnCorrectPage: seen ? round(ok / seen) : null };
}

/** Headings found as their own line (so a section detector could see them), and in order. */
function headings(text, truth) {
  const lines = String(text).split(/\r?\n/).map((l) => squash(l.replace(/^\s*\d+(\.\d+)*\.?\s+/, "")));
  const idx = truth.headings.map((h) => lines.findIndex((l) => l === squash(h.replace(/^\d+(\.\d+)*\.?\s+/, ""))));
  const found = idx.filter((i) => i >= 0);
  return { headings: truth.headings.length, foundAsOwnLine: found.length, recall: round(found.length / truth.headings.length), inOrder: found.length ? round(lis(found) / found.length) : null };
}

/**
 * Tables: a row is "intact" when all of its cells appear on ONE line of the output, in order (the column relationships are readable).
 * cellRecall is the fraction of cells that appear anywhere. A table read column by column or cell by cell has cellRecall 1 and rowIntegrity 0.
 */
function tables(text, truth) {
  const lines = String(text).split(/\r?\n/).map(squash);
  const all = squash(text);
  let rows = 0, intact = 0, cells = 0, cellHit = 0;
  for (const t of truth.tables || []) {
    for (const row of t.rows) {
      rows += 1;
      const cs = row.map(squash).filter(Boolean);
      cells += cs.length;
      cellHit += cs.filter((c) => all.includes(c)).length;
      const ok = lines.some((l) => { let p = 0; return cs.every((c) => { const i = l.indexOf(c, p); if (i < 0) return false; p = i + c.length; return true; }); });
      if (ok) intact += 1;
    }
  }
  return rows ? { rows, rowIntegrity: round(intact / rows), cells, cellRecall: round(cellHit / cells) } : null;
}

function equations(text, truth) {
  const all = squash(text);
  const eq = truth.equations || [];
  if (!eq.length) return null;
  const hit = eq.filter((e) => all.includes(squash(e))).length;
  return { equations: eq.length, preserved: hit, recall: round(hit / eq.length) };
}

function references(text, truth) {
  if (!truth.references) return null;
  const n = (String(text).match(/^\s*\[\d{1,3}\]/gm) || []).length;
  return { expected: truth.references, markersFound: n, recall: round(Math.min(n, truth.references) / truth.references) };
}

/** Scanned documents: how much text came out per page, and token recall against the ground-truth text (OCR quality). */
function scanned(text, truth, groundTruthText) {
  const pages = Math.max(1, truth.pages);
  const chars = String(text).replace(/\s/g, "").length;
  const out = { charsPerPage: Math.round(chars / pages), textLayerPresent: chars > 200 * pages };
  if (groundTruthText) {
    const want = [...new Set(norm(groundTruthText).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))];
    const have = new Set(norm(text).split(/[^\p{L}\p{N}]+/u));
    out.wordRecall = want.length ? round(want.filter((w) => have.has(w)).length / want.length) : null;
  }
  return out;
}

/** All metrics for one (extractor, document) pair. */
function score(text, truth, extra = {}) {
  return {
    id: truth.id, textChars: String(text).length,
    readingOrder: readingOrder(text, truth), headings: headings(text, truth), tables: tables(text, truth), equations: equations(text, truth),
    references: references(text, truth), pages: pageProvenance(text, truth), scanned: truth.scanned ? scanned(text, truth, extra.groundTruthText) : null
  };
}

module.exports = { score, readingOrder, headings, tables, equations, references, pageProvenance, scanned, lis, squash, pagesOf };
