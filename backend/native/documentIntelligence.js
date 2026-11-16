"use strict";
/**
 * Stage A of the native engine: document intelligence.
 *
 * Input is either the structured document the production extractor already produces for JATS/HTML papers (fromStructured), or
 * plain text produced from a PDF by an external extractor (fromPlainText; the zero-dependency backend cannot parse PDF binaries,
 * see papers/extract.js). Output is the same structured document + evidence chunks the production chunker emits, plus
 *   - page provenance (when the text carries page breaks),
 *   - a quality report that says what was found, what is missing and what was NOT preserved (equations, figures, table layout).
 *
 * Everything here is heuristic and rule-based. It has been exercised only on the fictional fixture papers (backend/tests/node/
 * nativeDocument.test.js); its behaviour on real PDFs is NOT RUN. A weak extraction is reported as such, never repaired by guessing.
 */
const { chunkDocument, documentContentHash } = require("../papers/chunker");
const { normalizeSectionName, cleanText } = require("../papers/extract");

const STANDARD_HEADINGS = /^(?:abstract|introduction|background|related work|prior work|preliminaries|methods?|methodology|materials and methods|approach|model|architecture|dataset|data|experiments?|experimental (?:setup|results|evaluation)|implementation details|evaluation|results|results and discussion|findings|analysis|discussion|limitations?|threats to validity|conclusions?|conclusion and future work|future work|summary|references|bibliography|acknowledge?ments?|appendix)$/i;
const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2}){0,2})[.)]?\s+([A-Z][A-Za-z0-9 ,:&\-/()']{1,78})$/;

const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

function removeRunningHeaders(pages) {
  if (pages.length < 2) return { pages, removed: 0 };
  const count = new Map();
  for (const p of pages) for (const l of new Set(p.map((x) => x.trim()).filter((x) => x && x.length < 60))) count.set(l, (count.get(l) || 0) + 1);
  // a short line that is on at least 60% of the pages (and on every page of a two-page text) is a running header/footer
  const repeated = new Set([...count].filter(([, n]) => n >= (pages.length < 3 ? pages.length : Math.max(3, Math.ceil(pages.length * 0.6)))).map(([l]) => l));
  let removed = 0;
  const out = pages.map((p) => p.filter((l) => {
    const t = l.trim();
    if (repeated.has(t) || /^\d{1,4}$/.test(t) || /^page \d+( of \d+)?$/i.test(t)) { removed += 1; return false; }
    return true;
  }));
  return { pages: out, removed };
}

function isHeading(line, prevBlank) {
  const t = line.trim();
  if (!t || t.length > 80 || /[.,;:]$/.test(t) && !/^\d/.test(t)) return null;
  if (STANDARD_HEADINGS.test(t)) return { heading: t, level: 1 };
  const m = NUMBERED_HEADING.exec(t);
  if (m && prevBlank && t.split(/\s+/).length <= 9 && !/[.!?]$/.test(t)) return { heading: m[2].trim(), level: m[1].split(".").length };
  const m2 = /^(?:\d{1,2}(?:\.\d{1,2})*[.)]?\s+)?(abstract|introduction|related work|methods?|methodology|results|discussion|conclusions?|limitations?|references|future work)$/i.exec(t);
  return m2 && prevBlank ? { heading: m2[1], level: 1 } : null;
}

function looksLikeEquation(line) {
  const t = line.trim();
  if (t.length < 3 || t.length > 120) return false;
  const sym = (t.match(/[=+\-*/^_<>≤≥∑∏∫√∂∇±×·\\{}|]/g) || []).length;
  const letters = (t.match(/[A-Za-z]{4,}/g) || []).length; // real words suggest prose, not a formula
  return /=/.test(t) && sym / t.length > 0.12 && letters === 0;
}

/**
 * @param {string} text   plain text of a paper; "\f" (form feed) separates pages, as pdftotext writes it
 * @param {{paperId:string, title?:string}} opts
 */
function fromPlainText(text, opts) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").replace(/([a-z])-\n([a-z])/g, "$1$2"); // repair end-of-line hyphenation
  let pages = raw.split("\f").map((p) => p.split("\n"));
  if (pages.length > 1 && pages[pages.length - 1].every((l) => !l.trim())) pages = pages.slice(0, -1);
  const hdr = removeRunningHeaders(pages);
  pages = hdr.pages;

  let titleLines = [];
  let abstract = "";
  const sections = [];
  const tables = [];
  let cur = null; // {heading, level, paragraphs:[], paragraphPages:[]}
  let para = [];
  let paraPage = 1;
  let inRefs = false;
  let refCount = 0;
  let equationLines = 0;
  let sawAbstractHeading = false;
  let prevBlank = true;
  let gotHeading = false;
  let tableTake = null;

  const flushPara = () => {
    if (!para.length) return;
    const t = cleanText(para.join(" "));
    para = [];
    if (!t) return;
    if (inRefs) return;
    if (cur) { cur.paragraphs.push(t); cur.paragraphPages.push(paraPage); }
    else if (!gotHeading) titleLines.push(t);
  };
  const flushTable = () => {
    if (!tableTake) return;
    const rows = tableTake.rows;
    const hasDigit = rows.some((r) => r.some((x) => /\d/.test(x)));
    if (rows.length >= 1 && hasDigit) tables.push({ caption: tableTake.caption, headers: rows.length > 1 ? rows[0] : [], rows: rows.length > 1 ? rows.slice(1) : rows, page: tableTake.page });
    tableTake = null;
  };

  pages.forEach((lines, pi) => {
    for (const line of lines) {
      const page = pi + 1;
      const t = line.trim();
      if (tableTake) {
        if (!t) { flushTable(); prevBlank = true; continue; }
        if (tableTake.rows.length < 14 && t.length <= 70 && !/[.!?]$/.test(t)) { tableTake.rows.push(/\s{2,}|\t/.test(line) ? t.split(/\s{2,}|\t/).map((x) => x.trim()).filter(Boolean) : [t]); continue; } // a line without column gaps stays ONE cell: cell positions are not guessed
        flushTable();
      }
      if (!t) { flushPara(); prevBlank = true; continue; }
      const h = isHeading(line, prevBlank);
      if (h) {
        flushPara();
        gotHeading = true;
        const std = normalizeSectionName(h.heading);
        if (/^abstract$/i.test(h.heading)) { sawAbstractHeading = true; cur = { heading: "Abstract", level: 1, paragraphs: [], paragraphPages: [], isAbstract: true }; sections.push(cur); inRefs = false; }
        else if (std === "REFERENCES" && /^(references|bibliography)$/i.test(h.heading)) { inRefs = true; cur = null; }
        else { inRefs = false; cur = { heading: h.heading, level: h.level, paragraphs: [], paragraphPages: [] }; sections.push(cur); }
        prevBlank = false;
        continue;
      }
      if (inRefs) { if (/^\[?\d{1,3}[\].]\s/.test(t)) refCount += 1; prevBlank = false; continue; }
      if (/^table\s+\d+[.:]/i.test(t) && cur) { flushPara(); tableTake = { caption: cleanText(t).slice(0, 300), rows: [], page }; prevBlank = false; continue; }
      if (looksLikeEquation(line)) { equationLines += 1; prevBlank = false; continue; }
      if (!para.length) paraPage = page;
      para.push(t);
      prevBlank = false;
    }
    flushPara();
    flushTable();
    prevBlank = true;
  });
  flushPara();
  flushTable();

  const abs = sections.find((s) => s.isAbstract);
  abstract = abs ? abs.paragraphs.join(" ") : "";
  const body = sections.filter((s) => !s.isAbstract && s.paragraphs.length);
  const title = (opts.title || titleLines[0] || "").slice(0, 300);
  const doc = { title, abstract, sections: body.map((s) => ({ heading: s.heading, level: s.level, paragraphs: s.paragraphs })), tables: tables.map(({ caption, headers, rows }) => ({ caption, headers, rows })), figures: [] };
  const paraPages = sections.filter((x) => x.paragraphs.length).flatMap((s) => s.paragraphs.map((p, i) => ({ n: norm(p), page: s.paragraphPages[i] })));
  return finish(opts.paperId, doc, { paraPages, tablePages: tables.map((t) => ({ caption: t.caption, page: t.page })), plain: { hadPages: pages.length > 1, removedRunningLines: hdr.removed, equationLines, referenceEntries: refCount, sawAbstractHeading, rawChars: raw.length } });
}

/** @param {{paperId:string,title?:string,abstract?:string,sections?:Array,tables?:Array,figures?:Array}} paper structured document from papers/extract.js */
function fromStructured(paper, opts = {}) {
  const doc = { title: paper.title || "", abstract: paper.abstract || "", sections: paper.sections || [], tables: paper.tables || [], figures: paper.figures || [] };
  return finish(paper.paperId, doc, { paraPages: [], tablePages: [], plain: null, abstractOnly: opts.abstractOnly });
}

/**
 * Build the Stage A result from chunks that already exist: the exact excerpts a production run (or a benchmark capture file) gave to a model.
 * Used by the evaluation so every system reads IDENTICAL source material with identical chunk ids.
 */
function fromChunks(paperId, chunks, { title = "" } = {}) {
  const list = chunks.map((c, i) => ({ chunkId: c.chunkId, paperId, ordinal: c.ordinal || i + 1, section: c.section || "OTHER", heading: c.heading || "", sourceType: c.sourceType || (c.section === "ABSTRACT" ? "ABSTRACT" : "FULL_TEXT"), text: String(c.text || ""), textHash: c.textHash || "", charCount: String(c.text || "").length, page: null }));
  const abstractOnly = !list.some((c) => c.sourceType !== "ABSTRACT");
  const doc = { title, abstract: "", sections: [], tables: list.filter((c) => c.sourceType === "TABLE").map(() => ({})), figures: list.filter((c) => c.sourceType === "FIGURE").map(() => ({})) };
  return { paperId, doc, chunks: list, contentHash: documentContentHash(list), truncated: false, droppedSections: [], quality: assess(doc, list, { paraPages: [], tablePages: [], plain: null }, abstractOnly) };
}

function pageOf(chunk, paraPages) {
  if (!paraPages.length) return null;
  const n = norm(chunk.text);
  const find = (needle) => { const p = paraPages.find((x) => x.n.includes(needle)); return p ? p.page : null; };
  const a = find(n.slice(0, 50));
  const b = find(n.slice(-50));
  if (a === null && b === null) return null;
  return { start: a === null ? b : a, end: b === null ? a : b };
}

function finish(paperId, doc, extra) {
  const abstractOnly = Boolean(extra.abstractOnly) || (doc.sections.length === 0 && doc.tables.length === 0);
  const { chunks, truncated, droppedSections } = chunkDocument(paperId, doc, { abstractOnly });
  for (const c of chunks) {
    if (c.sourceType === "TABLE") {
      const tp = extra.tablePages.find((t) => c.heading && t.caption && t.caption.startsWith(c.heading.slice(0, 40)));
      c.page = tp ? { start: tp.page, end: tp.page } : null;
    } else c.page = pageOf(c, extra.paraPages);
  }
  return { paperId, doc, chunks, contentHash: documentContentHash(chunks), truncated, droppedSections, quality: assess(doc, chunks, extra, abstractOnly) };
}

function assess(doc, chunks, extra, abstractOnly) {
  const present = new Set(chunks.filter((c) => c.sourceType === "FULL_TEXT").map((c) => c.section));
  const wanted = ["INTRODUCTION", "METHODOLOGY", "RESULTS", "CONCLUSION", "LIMITATIONS"];
  const bodyChars = chunks.filter((c) => c.sourceType === "FULL_TEXT").reduce((n, c) => n + c.charCount, 0);
  const allText = chunks.map((c) => c.text).join(" ");
  const flags = [];
  const garbled = allText.length ? ((allText.match(/[�\u0000-\u0008]/g) || []).length + (allText.match(/[^\p{L}\p{N}\s.,;:!?()[\]%'"\-+=/<>_°µ±×–—−·&]/gu) || []).length) / allText.length : 0;
  if (abstractOnly) flags.push({ code: "NO_BODY_TEXT", severity: "HIGH", note: "only the abstract is available; every other part of the brief is unavailable" });
  else {
    if (bodyChars < 3000) flags.push({ code: "SHORT_TEXT", severity: "HIGH", note: `only ${bodyChars} characters of body text` });
    if (!present.has("METHODOLOGY")) flags.push({ code: "NO_METHODS_SECTION", severity: "MEDIUM", note: "no section recognised as methods" });
    if (!present.has("RESULTS")) flags.push({ code: "NO_RESULTS_SECTION", severity: "MEDIUM", note: "no section recognised as results" });
    if (!present.has("LIMITATIONS")) flags.push({ code: "NO_LIMITATIONS_SECTION", severity: "INFO", note: "no dedicated limitations section (limitations may still be stated elsewhere)" });
  }
  if (garbled > 0.05) flags.push({ code: "GARBLED_TEXT", severity: "HIGH", note: `${(garbled * 100).toFixed(1)}% unusual characters` });
  if (extra.plain) {
    if (extra.plain.equationLines > 0) flags.push({ code: "EQUATIONS_NOT_PRESERVED", severity: "MEDIUM", note: `${extra.plain.equationLines} formula lines were set aside, not interpreted` });
    flags.push({ code: "FIGURE_CONTENT_NOT_READ", severity: "INFO", note: "figures are not interpreted by this stage" });
    if (!extra.plain.sawAbstractHeading) flags.push({ code: "NO_ABSTRACT_HEADING", severity: "MEDIUM", note: "no 'Abstract' heading found; the abstract may be missing or merged into the body" });
    if (doc.tables.length) flags.push({ code: "TABLE_LAYOUT_HEURISTIC", severity: "INFO", note: "table rows were recovered from text lines, not from the page layout" });
    if (doc.tables.some((t) => t.rows.some((r) => r.length < 2))) flags.push({ code: "TABLE_STRUCTURE_LOST", severity: "MEDIUM", note: "some table rows have no recoverable column positions; a number in them may not be tied to its row or column label" });
  }
  const poor = flags.some((f) => f.severity === "HIGH");
  return {
    coverage: abstractOnly ? "ABSTRACT_ONLY" : "FULL_TEXT", poorExtraction: poor, flags,
    sectionsFound: [...present], sectionsMissing: wanted.filter((w) => !present.has(w)),
    counts: { chunks: chunks.length, bodyChars, tables: doc.tables.length, figures: doc.figures.length, equationLinesSetAside: extra.plain ? extra.plain.equationLines : null, referenceEntries: extra.plain ? extra.plain.referenceEntries : null, runningLinesRemoved: extra.plain ? extra.plain.removedRunningLines : null },
    pageProvenance: chunks.some((c) => c.page) ? "PER_CHUNK" : "NOT_AVAILABLE"
  };
}

module.exports = { fromPlainText, fromStructured, fromChunks, isHeading, looksLikeEquation };
