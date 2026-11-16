"use strict";
/**
 * Claim guard: deterministic, bounded checks of one model statement against the evidence it cites. Shared by
 *   - the production validator (backend/llm/intelligence.js), where a failed check DROPS the statement, and
 *   - the offline faithfulness evaluator (backend/eval/faithfulness.js), where the same primitives only LABEL claims.
 * Keeping one copy of the rules means the evaluator measures the code that runs in production.
 *
 * What it checks (all against the CITED chunks only):
 *   NUMBER   every number written in the statement must be written in the cited chunks (whole-number match);
 *   REVERSAL the best-matching cited sentence says the opposite: a flipped direction (increase/decrease, rises/falls, higher/lower ...) or a
 *            flipped negation, when the statement and that sentence share most of their content words. The overlap used for the direction
 *            test ignores the direction words themselves (a reversed statement by definition does not repeat the evidence's direction word);
 *   ORDER    a "from X to Y" (or "X -> Y", "to Y from X") whose two numbers are the cited text's pair in the opposite order: both numbers
 *            are in the evidence, so the NUMBER check passes, but the statement reports the change backwards;
 *   OVERCLAIM a strong word ("proves", "guarantees", "always", "never", "state-of-the-art" ...) that no cited text contains;
 *   HEDGE    the best-matching cited sentence hedges ("may", "suggests") and the statement does not: kept, but flagged;
 *   SCOPE    the best-matching cited sentence limits its claim ("only", "single", "solely") and the statement does not: kept, but flagged.
 *
 * What it cannot do: understand meaning. A paraphrase that flips meaning without any of these cues passes; a faithful statement whose
 * wording trips a rule is dropped (for example "five-fold" against "5-fold"). Rates of both errors are UNMEASURED until the human
 * benchmark in docs/evaluation/HUMAN_BENCHMARK.md has been rated. Every drop is counted by reason in the analysis metadata so the
 * false-drop rate can be watched in production.
 */

const STOP = new Set(("a an the and or but of in on at to for from by with as is are was were be been being this that these those it its their there then than " +
  "which who whom whose we our us they them he she his her you your i also can may might could would should will shall do does did done have has had not no " +
  "such into over under about between among both each other more most less least very so if when while where how what why however thus").split(" "));
const ABBREV = /(?:\bet al|\bFig|\bFigs|\bEq|\bEqs|\bTab|\bRef|\bvs|\bi\.e|\be\.g|\bcf|\bapprox|\bca|\bDr|\bProf|\bNo|\bSec)\.$/;

const stem = (w) => (w.length > 5 ? w.replace(/(?:ing|ed|ly|es|s)$/, "") : w.length > 4 ? w.replace(/s$/, "") : w);
const contentTokens = (s) => (String(s).toLowerCase().match(/[a-z][a-z0-9-]*|\d+(?:\.\d+)?/g) || []).filter((t) => !STOP.has(t) && !/^\d/.test(t)).map(stem);

/** Sentence segmentation with positions in the original string. Abbreviations ("et al.", "Fig.") and decimals do not end a sentence. */
function segment(text) {
  const out = [];
  const re = /[.!?]["')\]]?(?:\s+|$)/g;
  let start = 0;
  let m;
  const push = (end) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (t) { const s = start + lead + (raw.trim().length - t.length); out.push({ start: s, end: s + t.length, text: t }); }
  };
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const before = text.slice(start, m.index + 1);
    const next = text.charAt(end);
    if (ABBREV.test(before) || (next && /[a-z]/.test(next))) continue; // abbreviation, or a lowercase continuation
    push(end);
    start = end;
  }
  if (start < text.length) push(text.length);
  return out;
}


const DIRECTION_PAIRS = [
  [["increase", "increased", "increases", "increasing", "rise", "rises", "rose", "risen", "rising", "grew", "grow", "grows", "growing", "grown", "gain", "gained", "gains", "gaining",
    "improve", "improved", "improves", "improving", "higher", "more", "better", "faster", "outperform", "outperforms", "outperformed", "outperforming", "climb", "climbs", "climbed", "climbing",
    "boost", "boosts", "boosted", "boosting", "raise", "raises", "raised", "raising", "surge", "surges", "surged", "jump", "jumps", "jumped"],
   ["decrease", "decreased", "decreases", "decreasing", "reduce", "reduced", "reduces", "reducing", "drop", "drops", "dropped", "dropping", "decline", "declines", "declined", "declining",
    "fall", "falls", "fell", "fallen", "falling", "loss", "lost", "lose", "loses", "losing", "degrade", "degraded", "degrades", "degrading", "worsen", "worsened", "worsens", "worsening",
    "lower", "lowers", "lowered", "lowering", "fewer", "less", "worse", "slower", "underperform", "underperforms", "underperformed", "underperforming",
    "shrink", "shrinks", "shrank", "shrunk", "shrinking", "plunge", "plunges", "plunged", "diminish", "diminishes", "diminished"]]
];
const NEGATION = /\b(?:not|no|never|without|cannot|can't|neither|nor|fails?|failed|unable|lacks?|lacked|n't)\b/i;
const STRONG = /\b(?:prove[sd]?|proof|guarantee[sd]?|always|never|all|every|definitively|state-of-the-art|first|best|solves?|solved|eliminates?|eliminated|conclusively)\b/i;
const HEDGE = /\b(?:may|might|could|suggest(?:s|ed)?|possibly|appears?|preliminary|tentative|perhaps|likely|seems?)\b/i;

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z']+/g) || []);
const hasAny = (set, list) => list.some((w) => set.has(w));

function directionConflict(claimText, evidenceText) {
  const c = words(claimText);
  const e = words(evidenceText);
  for (const [up, down] of DIRECTION_PAIRS) {
    if (hasAny(c, up) && !hasAny(c, down) && hasAny(e, down) && !hasAny(e, up)) return true;
    if (hasAny(c, down) && !hasAny(c, up) && hasAny(e, up) && !hasAny(e, down)) return true;
  }
  return false;
}

/** Stems of every direction word: removed from the claim's content words when the direction test looks for the sentence the claim is about. */
const DIRECTION_STEMS = new Set(DIRECTION_PAIRS.flatMap(([up, down]) => [...up, ...down]).map(stem));

/**
 * Ordered numeric changes written in `s`: [{from, to}] with the number tokens of guardNumbers.
 *   "from X to Y" (up to two unit words after X), "X -> Y" / "X → Y", and "to Y from X" (reported as from X to Y).
 * A range ("ranging from 10 to 20") has the same shape and is treated the same way; reordering a range is rare and still a change of statement.
 */
const NUM_RE = "-?\\d+(?:[.,]\\d+)*";
const FROM_TO = new RegExp(`\\bfrom\\s+(${NUM_RE})(?:\\s*[%\\u00b0]|\\s+[A-Za-z%/]+(?:\\s+[A-Za-z%/]+)?)?\\s+to\\s+(${NUM_RE})`, "gi");
const ARROW = new RegExp(`(${NUM_RE})\\s*[%\\u00b0]?\\s*(?:->|\\u2192|\\u27f6|=>)\\s*(${NUM_RE})`, "g");
const TO_FROM = new RegExp(`\\bto\\s+(${NUM_RE})(?:\\s*[%\\u00b0]|\\s+[A-Za-z%/]+(?:\\s+[A-Za-z%/]+)?)?\\s+from\\s+(${NUM_RE})`, "gi");
function orderedChanges(s) {
  const text = String(s).replace(/[\u2212\u2012\u2013]/g, "-");
  const out = [];
  for (const m of text.matchAll(FROM_TO)) out.push({ from: m[1], to: m[2] });
  for (const m of text.matchAll(ARROW)) out.push({ from: m[1], to: m[2] });
  for (const m of text.matchAll(TO_FROM)) out.push({ from: m[2], to: m[1] });
  return out;
}

/** True when a change written in the claim appears in the evidence only in the opposite order (both numbers are in the evidence). */
function orderConflict(claimText, evidenceText) {
  const claim = orderedChanges(claimText);
  if (!claim.length) return false;
  const have = orderedChanges(evidenceText);
  if (!have.length) return false;
  const key = (c) => `${c.from}\u0000${c.to}`;
  const seen = new Set(have.map(key));
  return claim.some((c) => c.from !== c.to && !seen.has(key(c)) && seen.has(key({ from: c.to, to: c.from })));
}

function idfOf(passages) {
  const df = new Map();
  for (const p of passages) for (const t of p.tokens) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, passages.length);
  return (t) => Math.log(1 + (n + 0.5) / ((df.get(t) || 0) + 0.5));
}

/** Best window (one passage or two adjacent passages of the same chunk) for a claim, by idf-weighted coverage of the claim's words. */
function bestWindows(claimTokens, passages, idf, only = null) {
  if (!claimTokens.size) return [];
  const total = [...claimTokens].reduce((n, t) => n + idf(t), 0) || 1;
  const wins = [];
  for (let i = 0; i < passages.length; i += 1) {
    if (only && passages[i].chunkId !== only) continue;
    const one = [passages[i]];
    const two = i + 1 < passages.length && passages[i + 1].chunkId === passages[i].chunkId && (!only || passages[i + 1].chunkId === only) ? [passages[i], passages[i + 1]] : null;
    for (const w of [one, two]) {
      if (!w) continue;
      let hit = 0;
      for (const t of claimTokens) if (w.some((p) => p.tokens.has(t))) hit += idf(t);
      wins.push({ passages: w, score: hit / total, size: w.length });
    }
  }
  wins.sort((a, b) => b.score - a.score || a.size - b.size);
  return wins;
}


/**
 * The numbers written in `s` as whole tokens ("12.50" is one token). A "-" directly after a letter is a hyphen, not a sign
 * ("IL-6" and "IL6" are both 6), a "-" after a digit is a range dash ("10-20" is 10 and 20), and the Unicode minus is the ASCII minus.
 * Separators are not normalised: "1,024" and "1024" are different tokens (a documented limitation).
 */
function guardNumbers(s) {
  const text = String(s).replace(/[\u2212\u2012\u2013]/g, "-");
  const out = [];
  const re = /-?\d+(?:[.,]\d+)*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let tok = m[0];
    if (tok[0] === "-" && m.index > 0 && /[\da-z]/i.test(text[m.index - 1])) tok = tok.slice(1);
    out.push(tok);
  }
  return out;
}

/** Strong words that production drops when no cited text contains them. Narrower than the evaluator's list on purpose: "all", "every", "first"
 *  and "best" are common in faithful statements, and a drop is costlier than a label. */
const RUNTIME_STRONG = /\b(?:prove[sd]?|proof|guarantee[sd]?|always|never|definitively|conclusively|state-of-the-art|solves?|solved|eliminates?|eliminated)\b/i;
const SCOPE_LIMIT = /\b(?:only|solely|single|merely|exclusively)\b/i;
const CONTRADICTION_OVERLAP = 0.5;
const NEGATION_OVERLAP = 0.6;
const GUARD_LIMITS = Object.freeze({ maxSentencesPerChunk: 400, maxCitedChars: 200000 });

/**
 * Sentences of every chunk, with the idf weights of the words over all of them. Built once per analysis.
 * @param {Array<{chunkId:string,text:string}>} chunks
 */
function buildEvidenceIndex(chunks) {
  const byChunk = new Map();
  const all = [];
  for (const c of chunks) {
    const text = String(c.text || "");
    const list = [];
    for (const seg of segment(text).slice(0, GUARD_LIMITS.maxSentencesPerChunk)) {
      const p = { chunkId: c.chunkId, start: seg.start, end: seg.end, text: seg.text, tokens: new Set(contentTokens(seg.text)) };
      list.push(p);
      all.push(p);
    }
    byChunk.set(c.chunkId, list);
  }
  return { byChunk, idf: idfOf(all) };
}

/** The passage of a window that covers most of the claim's (idf-weighted) words. */
function sentenceOf(win, claimTokens, idf) {
  let top = win.passages[0];
  let topScore = -1;
  for (const p of win.passages) {
    let hit = 0;
    for (const t of claimTokens) if (p.tokens.has(t)) hit += idf(t);
    if (hit > topScore) { top = p; topScore = hit; }
  }
  return top;
}

const SPAN_MIN_COVERAGE = 0.4;
const MAX_SPANS = 3;

/**
 * The sentences, one per cited chunk at most, that best support `text`: [{chunkId, start, end}], offsets into the chunk text. Offsets only,
 * no text, so the response carries no paper wording; the text is served separately and only where the licence allows it
 * (GET /api/v1/papers/:id/evidence/:chunkId). Empty when no sentence covers at least 40% of the statement's (idf-weighted) words.
 */
function evidenceSpansFor(text, citedIds, index) {
  const tokens = new Set(contentTokens(text));
  if (!tokens.size) return [];
  const spans = [];
  for (const id of citedIds) {
    const passages = index.byChunk.get(id) || [];
    const total = [...tokens].reduce((n, t) => n + index.idf(t), 0) || 1;
    let top = null;
    let topScore = 0;
    for (const p of passages) {
      let hit = 0;
      for (const t of tokens) if (p.tokens.has(t)) hit += index.idf(t);
      if (hit / total > topScore) { top = p; topScore = hit / total; }
    }
    if (top && topScore >= SPAN_MIN_COVERAGE) spans.push({ chunkId: id, start: top.start, end: top.end, coverage: Math.round(topScore * 100) / 100 });
  }
  return spans.sort((a, b) => b.coverage - a.coverage).slice(0, MAX_SPANS);
}

/** Sentences of the cited chunks that contain every number of `value` (for a quantitative result): [{chunkId, start, end}]. */
function numericSpansFor(value, citedIds, index) {
  const nums = guardNumbers(value);
  if (!nums.length) return [];
  const spans = [];
  for (const id of citedIds) {
    const hit = (index.byChunk.get(id) || []).find((p) => { const have = new Set(guardNumbers(p.text)); return nums.every((n) => have.has(n)); });
    if (hit) spans.push({ chunkId: id, start: hit.start, end: hit.end });
  }
  return spans.slice(0, MAX_SPANS);
}

/**
 * @param {{text:string, citedIds:string[], chunksById:Map<string,{text:string}>, index:ReturnType<typeof buildEvidenceIndex>}} a
 * @returns {{ok:true, qualifiers:string[], spans:Array<{chunkId:string,start:number,end:number,coverage:number}>} | {ok:false, reason:"STATEMENT_NUMBER_NOT_IN_EVIDENCE"|"REVERSED_MEANING"|"OVERCLAIM", detail?:any}}
 */
function checkStatement({ text, citedIds, chunksById, index }) {
  const citedText = citedIds.map((id) => String((chunksById.get(id) || {}).text || "")).join("\n").slice(0, GUARD_LIMITS.maxCitedChars);

  const nums = guardNumbers(text);
  if (nums.length) {
    const have = new Set(guardNumbers(citedText));
    const missing = nums.filter((n) => !have.has(n));
    if (missing.length) return { ok: false, reason: "STATEMENT_NUMBER_NOT_IN_EVIDENCE", detail: [...new Set(missing)] };
  }

  if (orderConflict(text, citedText)) return { ok: false, reason: "REVERSED_MEANING", detail: "ORDER" };

  if (RUNTIME_STRONG.test(text) && !RUNTIME_STRONG.test(citedText)) return { ok: false, reason: "OVERCLAIM" };

  const claimTokens = new Set(contentTokens(text));
  const passages = citedIds.flatMap((id) => index.byChunk.get(id) || []);
  const best = bestWindows(claimTokens, passages, index.idf)[0];
  const qualifiers = [];
  if (best) {
    // Polarity, hedge and scope are judged on the single best sentence of the window, not on the pair: a negation or a hedge in the
    // neighbouring sentence says nothing about this statement.
    const evidenceText = sentenceOf(best, claimTokens, index.idf).text;
    if (best.score >= CONTRADICTION_OVERLAP && directionConflict(text, evidenceText)) return { ok: false, reason: "REVERSED_MEANING", detail: "DIRECTION" };
    // The direction word of a reversed statement is, by definition, absent from the sentence it reverses, so it lowers the overlap that the test above
    // needs. Look for the sentence the statement is about WITHOUT its direction words, and test that sentence as well.
    const aboutTokens = new Set([...claimTokens].filter((t) => !DIRECTION_STEMS.has(t)));
    if (aboutTokens.size >= 1 && aboutTokens.size < claimTokens.size) {
      const about = bestWindows(aboutTokens, passages, index.idf)[0];
      if (about && about.score >= CONTRADICTION_OVERLAP && directionConflict(text, sentenceOf(about, aboutTokens, index.idf).text)) return { ok: false, reason: "REVERSED_MEANING", detail: "DIRECTION" };
    }
    if (best.score >= NEGATION_OVERLAP && NEGATION.test(text) !== NEGATION.test(evidenceText)) return { ok: false, reason: "REVERSED_MEANING", detail: "NEGATION" };
    if (best.score >= CONTRADICTION_OVERLAP && HEDGE.test(evidenceText) && !HEDGE.test(text)) qualifiers.push("HEDGE_DROPPED");
    if (best.score >= CONTRADICTION_OVERLAP && SCOPE_LIMIT.test(evidenceText) && !SCOPE_LIMIT.test(text)) qualifiers.push("SCOPE_LIMIT_DROPPED");
  }
  return { ok: true, qualifiers, spans: evidenceSpansFor(text, citedIds, index) };
}

module.exports = {
  checkStatement, buildEvidenceIndex, guardNumbers, orderedChanges, orderConflict, DIRECTION_STEMS, evidenceSpansFor, numericSpansFor, segment, contentTokens, stem, directionConflict, idfOf, bestWindows,
  NEGATION, STRONG, HEDGE, SCOPE_LIMIT, RUNTIME_STRONG, CONTRADICTION_OVERLAP, NEGATION_OVERLAP, STOP
};
