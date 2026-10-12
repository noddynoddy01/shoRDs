"use strict";
/**
 * Canonical paper identity (server side). One paper has exactly one identity, whatever form the caller supplies.
 *
 * Hierarchy (unchanged from services/deduplication.ts, the identity strategy already used by the app):
 *     DOI  ->  PMID  ->  arXiv id  ->  normalised title + first author + year
 * Canonical forms:   doi:10.1038/nature14539   pmid:25719670   arxiv:1706.03762   title:<title>-<author>-<year>
 *
 * Differences from the earlier frontend-only function, made so that "the same paper" can never get two identities:
 *   - arXiv version suffixes are stripped ("1706.03762v5" and "1706.03762" are one paper; the version belongs to the content
 *     hash, not to the identity);
 *   - a DataCite arXiv DOI (10.48550/arXiv.1706.03762) maps to the arXiv identity (it is the same paper);
 *   - the title form requires an explicit year and an alphanumeric-only title (no random fallback id, no default year);
 *   - input is validated strictly: anything that is not one of these four forms is rejected, never "best-effort" accepted.
 *
 * services/deduplication.ts implements the same function; backend/tests/node/paperIdentity.test.js checks the two agree
 * on a shared corpus.
 */

const MAX_ID_CHARS = 200;
const DOI_RE = /^10\.\d{4,9}\/[a-z0-9\/._\-]+$/;
const PMID_RE = /^\d{1,9}$/;
const ARXIV_NEW_RE = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD_RE = /^[a-z\-]+(\.[a-z]{2})?\/\d{7}$/;
const TITLE_ID_RE = /^title:[a-z0-9 ]{6,50}-[a-z]{0,40}-\d{4}$/;

/** Anchored pattern every canonical id must match; safe to use for input validation of route params. */
const CANONICAL_ID_RE = /^(doi:10\.\d{4,9}\/[a-z0-9\/._\-]+|pmid:\d{1,9}|arxiv:(\d{4}\.\d{4,5}|[a-z\-]+(\.[a-z]{2})?\/\d{7})|title:[a-z0-9 ]{6,50}-[a-z]{0,40}-\d{4})$/;

function normalizeTitleString(rawTitle) {
  if (typeof rawTitle !== "string") return "";
  let clean = rawTitle.trim().replace(/\.pdf$/i, "");
  clean = clean.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // drop accents: "Résumé" == "Resume"
  clean = clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return clean;
}

function normalizeAuthorName(authorStr) {
  if (typeof authorStr !== "string" || !authorStr.trim()) return "scholar";
  return authorStr.split(",")[0].trim().toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "") || "scholar";
}

/** A "." or ".." path segment would let a DOI steer the path of the provider URL it is interpolated into (e.g. /works/doi:10.1/../../x). */
const hasDotSegment = (s) => s.split("/").some((seg) => seg === "." || seg === "..");

function normalizeDoi(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  s = s.replace(/[^a-z0-9\/._\-]/g, ""); // same stripping as the frontend function, so existing ids stay stable
  return DOI_RE.test(s) && s.length <= 150 && !hasDotSegment(s) ? s : null;
}

function normalizePmid(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().toLowerCase().replace(/^pmid:?\s*/, "");
  return PMID_RE.test(s) ? s : null;
}

function normalizeArxiv(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(https?:\/\/)?(www\.)?arxiv\.org\/(abs|pdf|html)\//, "").replace(/\.pdf$/, "").replace(/^arxiv:\s*/, "");
  s = s.replace(/v\d+$/, "");
  return ARXIV_NEW_RE.test(s) || ARXIV_OLD_RE.test(s) ? s : null;
}

/** DataCite DOIs for arXiv papers carry the arXiv id: 10.48550/arxiv.1706.03762 */
function arxivFromDoi(doi) {
  const m = /^10\.48550\/arxiv\.(.+)$/.exec(doi || "");
  return m ? normalizeArxiv(m[1]) : null;
}

/**
 * @param {{doi?:string, pmid?:string|number, arxivId?:string, title?:string, authors?:string[], authorName?:string, pubYear?:number}} p
 * @returns {string|null} canonical id, or null when the fields do not identify a paper
 */
function canonicalPaperId(p) {
  if (!p || typeof p !== "object") return null;
  const doi = p.doi ? normalizeDoi(p.doi) : null;
  if (doi) {
    const ax = arxivFromDoi(doi);
    return ax ? `arxiv:${ax}` : `doi:${doi}`;
  }
  const pmid = p.pmid !== undefined && p.pmid !== null && p.pmid !== "" ? normalizePmid(p.pmid) : null;
  if (pmid) return `pmid:${pmid}`;
  const ax = p.arxivId ? normalizeArxiv(p.arxivId) : null;
  if (ax) return `arxiv:${ax}`;

  const title = normalizeTitleString(p.title).slice(0, 50).trim();
  const year = Number(p.pubYear);
  if (title.length >= 6 && Number.isInteger(year) && year >= 1500 && year <= 2200) {
    const firstAuthor = normalizeAuthorName(Array.isArray(p.authors) && p.authors.length ? p.authors[0] : p.authorName);
    return `title:${title}-${firstAuthor.slice(0, 40)}-${year}`;
  }
  return null;
}

/** Is this string a canonical paper id exactly as produced by canonicalPaperId? */
function isCanonicalPaperId(id) {
  return typeof id === "string" && id.length <= MAX_ID_CHARS && CANONICAL_ID_RE.test(id) && !hasDotSegment(id);
}

/**
 * Parse a paper reference supplied by a caller into its canonical id. Accepts a canonical id, or a bare DOI / PMID / arXiv
 * id / DOI or arXiv URL. Returns { canonicalId, kind, value } or null.
 */
function parsePaperRef(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > MAX_ID_CHARS) return null;
  if (isCanonicalPaperId(s)) return describe(s);
  const lower = s.toLowerCase();
  const candidates = [
    () => { const d = normalizeDoi(s); return d && /^(10\.|doi:|https?:\/\/(dx\.)?doi\.org\/)/.test(lower) ? canonicalPaperId({ doi: d }) : null; },
    () => { const a = /^(arxiv:|https?:\/\/(www\.)?arxiv\.org\/)/.test(lower) ? normalizeArxiv(s) : null; return a ? `arxiv:${a}` : null; },
    () => { const p = /^pmid:?\s*\d+$/.test(lower) ? normalizePmid(s) : null; return p ? `pmid:${p}` : null; }
  ];
  for (const c of candidates) {
    const id = c();
    if (id && isCanonicalPaperId(id)) return describe(id);
  }
  return null;
}

function describe(canonicalId) {
  const kind = canonicalId.slice(0, canonicalId.indexOf(":"));
  return { canonicalId, kind, value: canonicalId.slice(kind.length + 1) };
}

/** Chunk ids are `<canonical paper id>_chunk_<n>`. Ties every evidence chunk to exactly one paper. */
function makeChunkId(paperId, n) {
  return `${paperId}_chunk_${n}`;
}

/** @returns {{paperId:string, ordinal:number}|null}  null for anything malformed (including ids of the wrong shape). */
function parseChunkId(chunkId) {
  if (typeof chunkId !== "string" || chunkId.length > MAX_ID_CHARS + 16) return null;
  const m = /^(.+)_chunk_([1-9]\d{0,4})$/.exec(chunkId);
  if (!m || !isCanonicalPaperId(m[1])) return null;
  return { paperId: m[1], ordinal: Number(m[2]) };
}

module.exports = {
  CANONICAL_ID_RE,
  TITLE_ID_RE,
  canonicalPaperId,
  isCanonicalPaperId,
  parsePaperRef,
  normalizeDoi,
  normalizePmid,
  normalizeArxiv,
  normalizeTitleString,
  normalizeAuthorName,
  makeChunkId,
  parseChunkId
};
