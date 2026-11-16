"use strict";
/**
 * Deterministic, offline checks on a generated summary against its source text. No model calls, no network, no dependencies.
 *
 * What each check is for (and what it cannot tell you):
 *   numberGrounding  Every number in the summary must appear in the source. Catches invented or altered figures. It cannot
 *                    tell whether a real number is attached to the right claim.
 *   copying          Longest run of consecutive words copied verbatim, and the share of summary n-grams absent from the source.
 *                    LLM summaries of scientific text have been reported to be more extractive than human ones (Lyu and Ke,
 *                    arXiv 2512.23206), and long verbatim runs are also a copyright risk. Neither number says the summary is bad.
 *   length           Word count against a limit. The same study reports that most models overshoot requested lengths.
 *   readability      Flesch reading ease and Flesch-Kincaid grade, with a syllable heuristic. A rough guide, not a quality score.
 *
 * These do NOT measure whether a summary is faithful in meaning, complete, or useful. They are a cheap regression gate that sits
 * beside human review, not in place of it.
 */

const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*/g) || []);

/** Numbers as they appear, without surrounding units: "94.2%" -> "94.2", "3.5x" -> "3.5", "1,024" -> "1024". */
function extractNumbers(text) {
  const out = [];
  const re = /(?<![A-Za-z0-9.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![A-Za-z0-9]*\d)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const whole = m[1].replace(/,/g, "");
    out.push(m[2] ? `${whole}.${m[2]}` : whole);
  }
  return out;
}

/** Spelled-out quantities that would otherwise hide a changed figure ("a threefold increase") are out of scope; see header. */
function numberGrounding(source, summary, { ignoreBelow = 0 } = {}) {
  const src = new Set(extractNumbers(source));
  const used = extractNumbers(summary).filter((n) => Number(n) >= ignoreBelow);
  const ungrounded = [...new Set(used.filter((n) => !src.has(n)))];
  return { total: used.length, grounded: used.length - used.filter((n) => !src.has(n)).length, ungrounded };
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

function copying(source, summary) {
  const s = words(source);
  const t = words(summary);
  const novel = {};
  for (const n of [1, 2, 3]) {
    const have = new Set(ngrams(s, n));
    const grams = ngrams(t, n);
    novel[n] = grams.length ? grams.filter((g) => !have.has(g)).length / grams.length : null;
  }
  // Longest common contiguous word run, found by extending matches from every shared word.
  const index = new Map();
  s.forEach((w, i) => { if (!index.has(w)) index.set(w, []); index.get(w).push(i); });
  let longest = 0;
  for (let i = 0; i < t.length; i++) {
    for (const j of index.get(t[i]) || []) {
      let k = 0;
      while (i + k < t.length && j + k < s.length && t[i + k] === s[j + k]) k++;
      if (k > longest) longest = k;
    }
  }
  return { novelUnigrams: novel[1], novelBigrams: novel[2], novelTrigrams: novel[3], longestVerbatimRun: longest };
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function readability(summary) {
  const sentences = String(summary).split(/(?<=[.!?])\s+/).filter((x) => /[A-Za-z]/.test(x));
  const ws = words(summary).filter((w) => /[a-z]/.test(w));
  if (!sentences.length || !ws.length) return { fleschReadingEase: null, fleschKincaidGrade: null };
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const wps = ws.length / sentences.length;
  const spw = syl / ws.length;
  return { fleschReadingEase: Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10, fleschKincaidGrade: Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10 };
}

/**
 * @param {{source:string, summary:string}} c
 * @param {{maxWords?:number, maxVerbatimRun?:number, maxUngroundedNumbers?:number}} [limits]
 *   The default limits are this project's starting points, not values taken from the literature; tune them against human review.
 */
function evaluateSummary(c, { maxWords = 120, maxVerbatimRun = 12, maxUngroundedNumbers = 0 } = {}) {
  const wordCount = words(c.summary).length;
  const numbers = numberGrounding(c.source, c.summary);
  const copy = copying(c.source, c.summary);
  const read = readability(c.summary);
  const failures = [];
  if (!wordCount) failures.push("EMPTY_SUMMARY");
  if (numbers.ungrounded.length > maxUngroundedNumbers) failures.push("UNGROUNDED_NUMBER");
  if (copy.longestVerbatimRun > maxVerbatimRun) failures.push("LONG_VERBATIM_RUN");
  if (wordCount > maxWords) failures.push("TOO_LONG");
  return { wordCount, numbers, copy, readability: read, failures, passed: failures.length === 0 };
}

module.exports = { evaluateSummary, numberGrounding, copying, readability, extractNumbers, words };
