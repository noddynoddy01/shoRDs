"use strict";
/**
 * Evidence selection: which stored chunks of a paper go to the model, and validation of any chunk reference a caller supplies.
 *
 * Evidence TEXT is never accepted from a client. It always comes from the server's own store (papers/paper_chunks). A client
 * may at most name chunk ids to focus a question, and every id must (a) be well formed, (b) name THIS paper, and (c) exist in
 * the stored chunk set of this paper. Anything else is rejected, so a client cannot make shoRDs present text it wrote as
 * evidence from a paper.
 */

const { parseChunkId } = require("../papers/identity");

const DEFAULT_MAX_CONTEXT_CHARS = 120000;
const MAX_REQUESTED_CHUNKS = 40;

class EvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
    this.httpStatus = 400;
  }
}

/**
 * @param {string} paperId canonical id of the paper being queried
 * @param {unknown} requested value of the caller's `chunkIds`
 * @param {Array<{chunkId:string}>} stored the chunks stored for that paper
 * @returns {string[]} the validated ids
 */
function validateChunkIds(paperId, requested, stored) {
  if (requested === undefined || requested === null) return [];
  if (!Array.isArray(requested)) throw new EvidenceError("INVALID_CHUNK_IDS", "`chunkIds` must be an array of chunk id strings.");
  if (requested.length > MAX_REQUESTED_CHUNKS) throw new EvidenceError("TOO_MANY_CHUNKS", `At most ${MAX_REQUESTED_CHUNKS} chunk ids may be requested.`);
  const known = new Set(stored.map((c) => c.chunkId));
  const seen = new Set();
  for (const raw of requested) {
    const parsed = parseChunkId(raw);
    if (!parsed) throw new EvidenceError("MALFORMED_CHUNK_ID", "A chunk id is malformed.");
    if (parsed.paperId !== paperId) throw new EvidenceError("EVIDENCE_PAPER_MISMATCH", "A chunk id does not belong to the requested paper.");
    if (!known.has(raw)) throw new EvidenceError("UNKNOWN_CHUNK", "A chunk id does not exist for this paper.");
    seen.add(raw);
  }
  return [...seen];
}

const STOP = new Set("the and for are was were with that this from have has had not but can will which their there been than then into onto over under such these those they them its our out how what when where who why does did".split(" "));
const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9.%]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t.length >= 3 && !STOP.has(t));

/** Lexical relevance (BM25-style) of chunks to a question; returns chunks within the character budget, in reading order. */
function selectForQuestion(chunks, query, { maxChars = DEFAULT_MAX_CONTEXT_CHARS, maxChunks = 24 } = {}) {
  if (chunks.length === 0) return { chunks: [], omitted: 0, truncated: false };
  const q = new Set(tokenize(query));
  const docs = chunks.map((c) => {
    const toks = tokenize(`${c.heading || ""} ${c.text}`);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { c, tf, len: toks.length || 1 };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const k1 = 1.4;
  const b = 0.75;
  const scored = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg));
    }
    return { c: d.c, score };
  });
  scored.sort((x, y) => y.score - x.score || x.c.ordinal - y.c.ordinal);
  const picked = [];
  let total = 0;
  for (const s of scored) {
    if (picked.length >= maxChunks) break;
    if (total + s.c.text.length > maxChars) continue;
    if (s.score === 0 && picked.length >= 3) break; // do not pad the context with irrelevant text
    picked.push(s.c);
    total += s.c.text.length;
  }
  picked.sort((x, y) => x.ordinal - y.ordinal);
  return { chunks: picked, omitted: chunks.length - picked.length, truncated: picked.length < chunks.length };
}

const CATEGORY_OF = {
  ABSTRACT: "abstract", INTRODUCTION: "intro", BACKGROUND: "intro", RELATED_WORK: "intro",
  METHODOLOGY: "method", EXPERIMENTAL_SETUP: "method", DATASET: "method",
  RESULTS: "results", TABLE: "results", FIGURE: "results",
  DISCUSSION: "discussion", LIMITATIONS: "discussion", CONCLUSION: "discussion", FUTURE_WORK: "discussion"
};
const QUOTA = { abstract: 1, intro: 0.15, method: 0.3, results: 0.3, discussion: 0.2, other: 0.05 };

/** Whole paper when it fits the budget; otherwise a section-balanced selection so no part of the paper is silently dropped. */
function selectForIntelligence(chunks, { maxChars = DEFAULT_MAX_CONTEXT_CHARS } = {}) {
  const total = chunks.reduce((n, c) => n + c.text.length, 0);
  if (total <= maxChars) return { chunks: [...chunks], omitted: 0, truncated: false };
  const byCat = {};
  for (const c of chunks) (byCat[CATEGORY_OF[c.section] || "other"] = byCat[CATEGORY_OF[c.section] || "other"] || []).push(c);
  const picked = new Set();
  let used = 0;
  const take = (c) => {
    if (picked.has(c) || used + c.text.length > maxChars) return false;
    picked.add(c);
    used += c.text.length;
    return true;
  };
  for (const [cat, share] of Object.entries(QUOTA)) {
    const list = byCat[cat] || [];
    const cap = cat === "abstract" ? maxChars : Math.floor(maxChars * share);
    let catUsed = 0;
    for (const c of list) {
      if (catUsed + c.text.length > cap) continue;
      if (take(c)) catUsed += c.text.length;
    }
  }
  for (const c of chunks) take(c); // leftover budget: fill in reading order
  const out = chunks.filter((c) => picked.has(c));
  return { chunks: out, omitted: chunks.length - out.length, truncated: out.length < chunks.length };
}

module.exports = { validateChunkIds, selectForQuestion, selectForIntelligence, EvidenceError, DEFAULT_MAX_CONTEXT_CHARS, MAX_REQUESTED_CHUNKS };
