"use strict";
/**
 * Claim-level faithfulness evaluation of a summary against the paper it summarises. Offline and deterministic by default; an
 * optional `judge` (a model or a person, supplied by the caller, never created here) can be plugged in for the semantic decision.
 *
 *   summary --split--> claims --find--> best supporting passage(s) in the source --classify--> SUPPORTED | PARTIAL | UNSUPPORTED | CONTRADICTED
 *
 * What the default method is: a LEXICAL PROXY. It scores how much of a claim's content (weighted by how rare each word is in the
 * paper) appears in its best-matching passage, then applies rules for the failures that matter most: a number that is not in the
 * paper, a flipped direction (increase/decrease, higher/lower ...), a flipped negation, an overclaim ("proves", "always") and a dropped
 * hedge ("may", "suggests"). It CANNOT understand meaning: a paraphrase that shares few words looks unsupported, and a fluent claim
 * that reuses the paper's words but is attached to the wrong finding can look supported. Every classification is therefore reported
 * with the exact evidence passage and its position, so a person can check it, and `needsReview` marks the ones a proxy should not decide.
 *
 * A sentence is one claim even when it holds two assertions joined by ";" or "and": splitting would leave fragments with no subject.
 * The weakest assertion is not isolated, though an invented number anywhere in the sentence is still caught.
 *
 * Thresholds below are this project's starting values, not figures from the literature. Tune them against human ratings
 * (docs/evaluation/HUMAN_BENCHMARK.md) before relying on the numbers.
 */

const { extractNumbers } = require("./summaryMetrics");
const { segment, contentTokens, directionConflict, idfOf, bestWindows, NEGATION, STRONG, HEDGE, CONTRADICTION_OVERLAP, NEGATION_OVERLAP } = require("../llm/claimGuard"); // one copy of the rules, shared with production

const THRESHOLDS = Object.freeze({ supported: 0.7, partial: 0.45, contradictionOverlap: CONTRADICTION_OVERLAP, negationOverlap: NEGATION_OVERLAP });
const LIMITS = Object.freeze({ maxClaims: 200, maxClaimChars: 2000, maxPassages: 5000, maxSourceChars: 3_000_000 });
const STATUS = Object.freeze({ SUPPORTED: "SUPPORTED", PARTIAL: "PARTIAL", UNSUPPORTED: "UNSUPPORTED", CONTRADICTED: "CONTRADICTED" });

/** @returns {Array<{id:string,text:string,start:number,end:number,kind:"CLAIM"|"NON_CLAIM"}>} positions index into the summary string */
function splitClaims(summary) {
  const s = String(summary || "").slice(0, LIMITS.maxClaims * LIMITS.maxClaimChars);
  return segment(s).slice(0, LIMITS.maxClaims).map((x, i) => {
    const toks = contentTokens(x.text);
    const nonClaim = /\?\s*$/.test(x.text) || toks.length < 3 || /^(?:in summary|overall|to summari[sz]e|in conclusion)[,:]?$/i.test(x.text);
    return { id: `c${i + 1}`, text: x.text.slice(0, LIMITS.maxClaimChars), start: x.start, end: x.end, kind: nonClaim ? "NON_CLAIM" : "CLAIM" };
  });
}

const SECTION_RE = /^(?:\d+(?:\.\d+)*\.?\s*)?(abstract|introduction|background|related work|methods?|methodology|materials and methods|experiments?|experimental setup|results?|results and discussion|discussion|limitations?|conclusions?|future work)\s*:?\s*$/i;

/**
 * @param {string|Array<{chunkId:string,text:string,section?:string}>} source a plain text, or the stored evidence chunks
 * @returns {Array<{chunkId:string,start:number,end:number,text:string,section:string,tokens:Set<string>}>} passages; positions are within their chunk
 */
function buildPassages(source) {
  const chunks = typeof source === "string" ? [{ chunkId: "source", text: source }] : source;
  const passages = [];
  let total = 0;
  for (const c of chunks) {
    const text = String(c.text || "");
    total += text.length;
    if (total > LIMITS.maxSourceChars) break;
    let section = c.section || "unlabelled";
    // headings are recognised line by line, so one heading line never becomes a passage of its own
    const lineStarts = [];
    let pos = 0;
    for (const line of text.split("\n")) { lineStarts.push([pos, line]); pos += line.length + 1; }
    for (const [lineStart, line] of lineStarts) {
      const h = SECTION_RE.exec(line.trim());
      if (h) { section = h[1].toLowerCase().replace(/^materials and methods$|^methodology$|^methods?$/, "methods").replace(/^experiments?$|^experimental setup$/, "experiments").replace(/^results? and discussion$/, "results"); continue; }
      for (const seg of segment(line)) {
        if (passages.length >= LIMITS.maxPassages) break;
        passages.push({ chunkId: c.chunkId, start: lineStart + seg.start, end: lineStart + seg.end, text: seg.text, section, tokens: new Set(contentTokens(seg.text)) });
      }
    }
  }
  return passages;
}

const evidenceOf = (win) => win.passages.map((p) => ({ chunkId: p.chunkId, start: p.start, end: p.end, text: p.text, section: p.section }));

function classify(claim, passages, allText, idf, judgeResult) {
  const toks = new Set(contentTokens(claim.text));
  const wins = bestWindows(toks, passages, idf);
  const best = wins[0];
  const evidenceText = best ? best.passages.map((p) => p.text).join(" ") : "";
  const score = best ? Math.round(best.score * 1000) / 1000 : 0;
  const flags = [];
  const claimNumbers = extractNumbers(claim.text);
  const sourceNumbers = new Set(extractNumbers(allText));
  const evidenceNumbers = new Set(extractNumbers(evidenceText));
  const fabricated = claimNumbers.filter((n) => !sourceNumbers.has(n));
  const misplaced = claimNumbers.filter((n) => sourceNumbers.has(n) && !evidenceNumbers.has(n));
  if (fabricated.length) flags.push({ code: "NUMBER_NOT_IN_SOURCE", detail: [...new Set(fabricated)] });
  if (misplaced.length) flags.push({ code: "NUMBER_NOT_IN_EVIDENCE", detail: [...new Set(misplaced)] });

  let status = score >= THRESHOLDS.supported ? STATUS.SUPPORTED : score >= THRESHOLDS.partial ? STATUS.PARTIAL : STATUS.UNSUPPORTED;
  if (best && score >= THRESHOLDS.contradictionOverlap && directionConflict(claim.text, evidenceText)) { flags.push({ code: "DIRECTION_MISMATCH" }); status = STATUS.CONTRADICTED; }
  else if (best && score >= THRESHOLDS.negationOverlap && NEGATION.test(claim.text) !== NEGATION.test(evidenceText)) { flags.push({ code: "NEGATION_MISMATCH" }); status = STATUS.CONTRADICTED; }
  if (status === STATUS.SUPPORTED || status === STATUS.PARTIAL) {
    if (STRONG.test(claim.text) && !STRONG.test(evidenceText)) { flags.push({ code: "OVERCLAIM" }); status = STATUS.PARTIAL; }
    if (HEDGE.test(evidenceText) && !HEDGE.test(claim.text)) { flags.push({ code: "HEDGE_DROPPED" }); status = STATUS.PARTIAL; }
    if (misplaced.length) status = STATUS.PARTIAL;
  }
  if (fabricated.length) status = STATUS.UNSUPPORTED; // a figure that is nowhere in the paper outranks everything else, including a judge

  const heuristicStatus = status;
  let judged = null;
  if (judgeResult && Object.prototype.hasOwnProperty.call(STATUS, judgeResult.label) && !fabricated.length) { status = judgeResult.label; judged = { label: judgeResult.label, rationale: String(judgeResult.rationale || "").slice(0, 500) }; }

  const second = wins.find((w) => w !== best && w.passages[0] !== best.passages[0] && w.score >= THRESHOLDS.partial);
  const needsReview = status === STATUS.CONTRADICTED || (status === STATUS.PARTIAL && !flags.length) || (heuristicStatus === STATUS.UNSUPPORTED && score >= 0.3 && !fabricated.length) || (judged !== null && judged.label !== heuristicStatus);
  return {
    id: claim.id, text: claim.text, start: claim.start, end: claim.end, status, heuristicStatus, judge: judged,
    method: judged ? "JUDGE_WITH_LEXICAL_PROXY" : "LEXICAL_PROXY", score, flags, needsReview,
    evidence: best && score > 0 ? [...evidenceOf(best).map((e) => ({ ...e, score })), ...(second ? [{ ...evidenceOf(second)[0], score: Math.round(second.score * 1000) / 1000 }] : [])] : []
  };
}

/**
 * @param {{source: string|Array<{chunkId:string,text:string,section?:string}>, summary?: string, claims?: Array<{text:string, cites?:string[]}>}} input
 *   Give either `summary` (split into claims here) or `claims` (the engine's own statements, with the chunk ids they cite).
 * @param {{judge?: (arg:{claim:string, evidence:object[]}) => Promise<{label:string, rationale?:string}>}} [opts]
 */
async function evaluateFaithfulness(input, { judge = null } = {}) {
  const passages = buildPassages(input.source);
  const allText = (typeof input.source === "string" ? [{ text: input.source }] : input.source).map((c) => c.text).join("\n");
  const idf = idfOf(passages);
  const given = Array.isArray(input.claims)
    ? input.claims.slice(0, LIMITS.maxClaims).map((c, i) => ({ id: `c${i + 1}`, text: String(c.text || "").slice(0, LIMITS.maxClaimChars), start: 0, end: 0, kind: contentTokens(c.text).length >= 3 ? "CLAIM" : "NON_CLAIM", cites: Array.isArray(c.cites) ? c.cites : [] }))
    : splitClaims(input.summary).map((c) => ({ ...c, cites: [] }));
  const results = [];
  for (const c of given) {
    if (c.kind === "NON_CLAIM") { results.push({ id: c.id, text: c.text, start: c.start, end: c.end, status: "NOT_A_CLAIM", method: "SKIPPED", evidence: [], flags: [], needsReview: false, cites: c.cites }); continue; }
    let jr = null;
    if (judge) {
      const pre = classify(c, passages, allText, idf, null);
      try { jr = await judge({ claim: c.text, evidence: pre.evidence }); } catch (_) { jr = null; } // a failing judge falls back to the proxy; never throws
    }
    const r = classify(c, passages, allText, idf, jr);
    r.cites = c.cites;
    results.push(r);
  }
  const claims = results.filter((r) => r.status !== "NOT_A_CLAIM");
  const count = (s) => claims.filter((r) => r.status === s).length;
  const n = claims.length;
  const rate = (k) => (n ? Math.round((k / n) * 1000) / 1000 : null);

  // evidence coverage: how much of the summary can be tied to a passage; source coverage: which parts of the paper the summary touches
  const withEvidence = claims.filter((r) => r.evidence.length && r.score >= THRESHOLDS.partial).length;
  const sections = {};
  for (const p of passages) { sections[p.section] = sections[p.section] || { passages: 0, referenced: 0 }; sections[p.section].passages += 1; }
  const seen = new Set();
  for (const r of claims) for (const e of r.evidence.slice(0, 1)) { if (r.status === "UNSUPPORTED") continue; const k = `${e.chunkId}:${e.start}`; if (seen.has(k)) continue; seen.add(k); if (sections[e.section]) sections[e.section].referenced += 1; }

  // citations: does each cited chunk really contain support, and is every supported claim cited?
  let cited = 0;
  let citedSupporting = 0;
  let supportedWithCite = 0;
  let supportedClaims = 0;
  let unknownCites = 0;
  const known = new Set(passages.map((p) => p.chunkId));
  for (const r of claims) {
    const toks = new Set(contentTokens(r.text));
    let anySupportingCite = false;
    for (const id of new Set(r.cites || [])) {
      if (!known.has(id)) { unknownCites += 1; continue; }
      cited += 1;
      const w = bestWindows(toks, passages, idf, id)[0];
      if (w && w.score >= THRESHOLDS.partial) { citedSupporting += 1; anySupportingCite = true; }
    }
    if (r.status === "SUPPORTED" || r.status === "PARTIAL") { supportedClaims += 1; if (anySupportingCite) supportedWithCite += 1; }
  }
  const hasCites = claims.some((r) => (r.cites || []).length);
  return {
    method: judge ? "JUDGE_WITH_LEXICAL_PROXY" : "LEXICAL_PROXY",
    thresholds: THRESHOLDS,
    claims: results,
    summary: {
      claims: n, supported: count("SUPPORTED"), partial: count("PARTIAL"), unsupported: count("UNSUPPORTED"), contradicted: count("CONTRADICTED"),
      supportedRate: rate(count("SUPPORTED")), unsupportedRate: rate(count("UNSUPPORTED")), contradictedRate: rate(count("CONTRADICTED")),
      evidenceCoverage: rate(withEvidence), needsReview: claims.filter((r) => r.needsReview).length
    },
    sourceCoverage: { sections, omittedSections: Object.entries(sections).filter(([, v]) => v.referenced === 0).map(([k]) => k) },
    citations: hasCites ? {
      citedChunks: cited, supportingCitations: citedSupporting, unknownChunkIds: unknownCites,
      precision: cited ? Math.round((citedSupporting / cited) * 1000) / 1000 : null,
      recall: supportedClaims ? Math.round((supportedWithCite / supportedClaims) * 1000) / 1000 : null
    } : null
  };
}

/** Checks that every evidence span still points at the exact text it quotes, so a UI can highlight it in the stored chunk. */
function verifyEvidenceSpans(result, source) {
  const chunks = typeof source === "string" ? [{ chunkId: "source", text: source }] : source;
  const byId = new Map(chunks.map((c) => [c.chunkId, c.text]));
  const bad = [];
  for (const c of result.claims) for (const e of c.evidence) { const t = byId.get(e.chunkId); if (typeof t !== "string" || t.slice(e.start, e.end) !== e.text) bad.push({ claim: c.id, chunkId: e.chunkId }); }
  return { ok: bad.length === 0, bad };
}

module.exports = { evaluateFaithfulness, verifyEvidenceSpans, splitClaims, buildPassages, THRESHOLDS, STATUS, LIMITS };
