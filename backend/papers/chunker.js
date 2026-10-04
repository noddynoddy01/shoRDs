"use strict";
/**
 * Semantic chunking: structured document -> evidence chunks.
 *
 * "Semantic" here means the boundaries follow the paper's own structure, not a fixed character window:
 *   - a chunk never spans two sections (a Methods sentence is never glued to a Results sentence);
 *   - paragraphs are the unit; consecutive paragraphs of one section are packed up to a target size;
 *   - a paragraph longer than the maximum is split at sentence boundaries (abbreviations such as "et al." and "Fig." are not
 *     treated as sentence ends);
 *   - each table is one chunk (numeric results stay together with their caption and column names);
 *   - each figure caption is one chunk;
 *   - the abstract is its own chunk(s); references, acknowledgements and similar boilerplate are not evidence and are dropped.
 *
 * Every chunk id is `<canonical paper id>_chunk_<n>`, so a chunk can always be traced to exactly one paper.
 */

const crypto = require("crypto");
const { makeChunkId } = require("./identity");
const { normalizeSectionName } = require("./extract");

const TARGET_CHARS = 1200;
const MAX_CHARS = 2000;
const MIN_TAIL_CHARS = 250;
const TABLE_MAX_CHARS = 3000;
const MAX_CHUNKS = 600;
const MAX_TOTAL_CHARS = 1_500_000;

const ABBREV = /(?:\bet al|\bFig|\bFigs|\bEq|\bEqs|\bTab|\bRef|\bvs|\bi\.e|\be\.g|\bcf|\bapprox|\bca|\bDr|\bProf|\bNo|\bSec|\bp|\bpp)\.$/;

function splitSentences(text) {
  const parts = [];
  let start = 0;
  const re = /[.!?]["')\]]?\s+(?=[A-Z0-9("\[])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const candidate = text.slice(start, m.index + 1).trimEnd();
    if (ABBREV.test(candidate.replace(/["')\]]+$/, ""))) continue;
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  if (start < text.length) parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Split a long paragraph into pieces of at most `max` chars, at sentence boundaries where possible. */
function splitLong(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  for (let s of splitSentences(text)) {
    while (s.length > max) {
      // a single "sentence" longer than max (e.g. a list): hard-split on whitespace
      let cut = s.lastIndexOf(" ", max);
      if (cut < max * 0.5) cut = max;
      if (cur) { out.push(cur); cur = ""; }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (cur && cur.length + 1 + s.length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

function packParagraphs(paragraphs) {
  const pieces = [];
  for (const p of paragraphs) pieces.push(...splitLong(p, MAX_CHARS));
  const chunks = [];
  let cur = "";
  for (const piece of pieces) {
    if (!cur) cur = piece;
    else if (cur.length + 2 + piece.length <= TARGET_CHARS) cur = `${cur}\n\n${piece}`;
    else {
      chunks.push(cur);
      cur = piece;
    }
  }
  if (cur) {
    if (chunks.length && cur.length < MIN_TAIL_CHARS && chunks[chunks.length - 1].length + 2 + cur.length <= MAX_CHARS) chunks[chunks.length - 1] += `\n\n${cur}`;
    else chunks.push(cur);
  }
  return chunks;
}

function tableText(t) {
  const head = t.headers && t.headers.length ? ` Columns: ${t.headers.join(" | ")}.` : "";
  const rows = t.rows.map((r) => r.join(" | ")).join(" ; ");
  const text = `Table${t.caption ? `: ${t.caption}` : ""}.${head} Rows: ${rows}`;
  return text.length > TABLE_MAX_CHARS ? `${text.slice(0, TABLE_MAX_CHARS - 1)}…` : text;
}

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

/**
 * @param {string} paperId canonical paper id
 * @param {{abstract?:string, sections?:Array, tables?:Array, figures?:Array}} doc
 * @param {{abstractOnly?:boolean}} [opts]
 * @returns {{chunks:Array, truncated:boolean, droppedSections:string[]}}
 */
function chunkDocument(paperId, doc, opts = {}) {
  const raw = [];
  const dropped = [];
  if (doc.abstract && doc.abstract.trim()) {
    for (const t of packParagraphs([doc.abstract.trim()])) raw.push({ section: "ABSTRACT", heading: "Abstract", sourceType: "ABSTRACT", text: t });
  }
  if (!opts.abstractOnly) {
    for (const sec of doc.sections || []) {
      const std = normalizeSectionName(sec.leaf || sec.heading);
      if (std === "REFERENCES") {
        dropped.push(sec.heading);
        continue;
      }
      if (std === "ABSTRACT") continue; // already captured from the abstract element
      for (const t of packParagraphs(sec.paragraphs)) raw.push({ section: std, heading: (sec.heading || "").slice(0, 200), sourceType: "FULL_TEXT", text: t });
    }
    for (const tb of doc.tables || []) raw.push({ section: "TABLE", heading: (tb.caption || "Table").slice(0, 200), sourceType: "TABLE", text: tableText(tb) });
    for (const fg of doc.figures || []) raw.push({ section: "FIGURE", heading: "Figure", sourceType: "FIGURE", text: `Figure: ${fg.caption}` });
  }

  const chunks = [];
  let total = 0;
  let truncated = false;
  for (const r of raw) {
    if (chunks.length >= MAX_CHUNKS || total + r.text.length > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    total += r.text.length;
    const ordinal = chunks.length + 1;
    chunks.push({ chunkId: makeChunkId(paperId, ordinal), paperId, ordinal, section: r.section, heading: r.heading, sourceType: r.sourceType, text: r.text, textHash: hash(r.text), charCount: r.text.length });
  }
  return { chunks, truncated, droppedSections: dropped };
}

/** One hash over the whole chunk set; it changes whenever any chunk's text, section or order changes. */
function documentContentHash(chunks) {
  const h = crypto.createHash("sha256");
  for (const c of chunks) h.update(`${c.chunkId}\u0000${c.section}\u0000${c.textHash}\u0001`);
  return h.digest("hex");
}

module.exports = { chunkDocument, documentContentHash, splitSentences, splitLong, packParagraphs, TARGET_CHARS, MAX_CHARS, MAX_CHUNKS };
