"use strict";
/**
 * Summary-quality benchmark: paper selection, blinded rating sheets, agreement and comparison. Pure functions: no network, no model calls.
 *
 * What this does and does not give you:
 *  - It turns two sets of summaries (the on-device brief and the backend's cited analysis) for the same papers into blinded rating sheets, and
 *    turns the returned human ratings into agreement statistics, per-system scores, a paired comparison with a confidence interval, and a tally
 *    of recurring failure patterns.
 *  - It does NOT contain any human ratings. Numbers it prints are only evidence about summary quality when they come from real raters on real,
 *    licensed papers (see docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md). Run on made-up ratings it says so: the `kind` of the key is carried
 *    through to the report.
 *
 * Five criteria, each rated 1 to 5 by each rater (anchors in the protocol). Ratings are ordinal, so agreement is the quadratic-weighted kappa
 * (a 2-vs-3 disagreement counts less than a 1-vs-5), reported with exact and within-one-point agreement.
 */

const { permissionsFor } = require("../papers/licensePolicy");

const CRITERIA = Object.freeze([
  { id: "factual_accuracy", label: "Factual accuracy", question: "Is every number, name, direction and claim in the summary stated by the paper? (1 = several wrong or reversed; 5 = all correct)" },
  { id: "completeness", label: "Completeness", question: "Does it include the paper's main question, method, key results and stated limitations? (1 = misses most; 5 = misses nothing a reader needs)" },
  { id: "readability", label: "Readability", question: "Can a researcher in the field read it quickly without confusion? (1 = fragments or noise; 5 = clear and well ordered)" },
  { id: "evidence_traceability", label: "Evidence traceability", question: "Could you check each statement against a specific passage of the paper from what is shown? (1 = nothing is traceable; 5 = every statement points to its passage)" },
  { id: "usefulness", label: "Usefulness", question: "Would you use this to decide whether to read the paper, without opening it first? (1 = no; 5 = yes, with confidence)" }
]);

const FAILURE_TAGS = Object.freeze([
  "WRONG_NUMBER", "REVERSED_RESULT", "OVERCLAIM", "MISSING_LIMITATION", "MISSING_KEY_RESULT", "UNSUPPORTED_STATEMENT",
  "WRONG_ATTRIBUTION", "GENERIC_FILLER", "TRUNCATED_FRAGMENT", "UNREADABLE", "NO_TRACEABLE_SOURCE", "OTHER"
]);

const SYSTEMS = Object.freeze(["device_brief", "backend_analysis"]);
const round = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// ------------------------------------------------------------------------------------------------ seeded randomness
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------------------------------------ selection
/**
 * Turn an OpenAlex `works` response into candidates. A work is kept only if it has what the benchmark needs: a DOI, a title, an abstract,
 * and a recorded licence on its best open-access location. Nothing is guessed.
 */
function candidatesFromOpenAlex(response, stratum) {
  const out = [];
  for (const w of (response && response.results) || []) {
    const doi = w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, "") : null;
    const license = (w.best_oa_location && w.best_oa_location.license) || (w.primary_location && w.primary_location.license) || null;
    const hasAbstract = w.abstract_inverted_index && typeof w.abstract_inverted_index === "object" && Object.keys(w.abstract_inverted_index).length > 0;
    if (!doi || !w.title || !hasAbstract || !license) continue;
    out.push({
      paperId: `doi:${doi.toLowerCase()}`, doi, title: w.title, year: w.publication_year || null, license, stratum,
      field: (w.primary_topic && w.primary_topic.field && w.primary_topic.field.display_name) || null,
      openAlexId: w.id || null, landingPage: (w.best_oa_location && (w.best_oa_location.landing_page_url || w.best_oa_location.pdf_url)) || `https://doi.org/${doi}`
    });
  }
  return out;
}

/**
 * Licence-gated, stratified selection. `evalCorpus` must be "yes" (CC0, public domain, CC BY) unless `allowReview` is set, in which case
 * share-alike and no-derivatives items are included for a person to review. Unknown, NonCommercial and "free to read" licences are never included.
 * Round-robin across strata after a seeded shuffle, so no stratum dominates and the draw is reproducible.
 */
function selectBenchmarkPapers(candidates, { total = 50, seed = 1, allowReview = false } = {}) {
  const rand = rng(seed);
  const seen = new Set();
  const excluded = [];
  const eligible = [];
  for (const c of candidates) {
    if (!c || !c.paperId || seen.has(c.paperId)) { if (c && seen.has(c.paperId)) excluded.push({ paperId: c.paperId, reason: "DUPLICATE" }); continue; }
    seen.add(c.paperId);
    const perm = permissionsFor(c.license);
    const ok = perm.evalCorpus === "yes" || (allowReview && perm.evalCorpus === "review");
    if (ok) eligible.push({ ...c, licenseNormalised: perm.license.normalised, licenseDecision: perm.evalCorpus });
    else excluded.push({ paperId: c.paperId, license: perm.license.normalised, reason: `LICENSE_${perm.evalCorpus.toUpperCase()}` });
  }
  const strata = [...new Set(eligible.map((c) => c.stratum || "unspecified"))].sort();
  const queues = Object.fromEntries(strata.map((s) => [s, shuffled(eligible.filter((c) => (c.stratum || "unspecified") === s), rand)]));
  const selected = [];
  while (selected.length < total && strata.some((s) => queues[s].length)) {
    for (const s of strata) {
      if (selected.length >= total) break;
      const next = queues[s].shift();
      if (next) selected.push(next);
    }
  }
  const perStratum = Object.fromEntries(strata.map((s) => [s, selected.filter((c) => (c.stratum || "unspecified") === s).length]));
  return { selected, excluded, perStratum, shortfall: Math.max(0, total - selected.length), seed };
}

// ------------------------------------------------------------------------------------------------ rendering a backend analysis
const FIELD_LABELS = [
  ["tldr", "In brief"], ["researchProblem", "Problem"], ["motivation", "Motivation"], ["methodology", "Method"], ["architecture", "Architecture"],
  ["dataset", "Data"], ["experimentalSetup", "Setup"], ["findings", "Findings"], ["novelty", "Novelty"], ["whyItMatters", "Why it matters"],
  ["practicalImplications", "Practical implications"], ["futureWork", "Future work"]
];
const LIST_LABELS = [["contributions", "Contributions"], ["techniques", "Techniques"], ["strengths", "Strengths"], ["limitations", "Limitations"], ["assumptions", "Assumptions"]];

/**
 * Flatten a backend `intelligence` object to text for raters. Each statement ends with its evidence ids so the traceability criterion can be
 * judged; `passages` maps those ids to the cited text (pass `chunksById` only for papers whose licence allows showing the text).
 */
function renderIntelligenceText(intelligence, chunksById = null) {
  if (!intelligence || typeof intelligence !== "object") return { text: "", passages: {} };
  const lines = [];
  const used = new Set();
  const cite = (ev) => { (ev || []).forEach((e) => used.add(e)); return ev && ev.length ? ` [${ev.join(", ")}]` : " [no source]"; };
  for (const [k, label] of FIELD_LABELS) if (intelligence[k] && intelligence[k].text) lines.push(`${label}: ${intelligence[k].text}${cite(intelligence[k].evidence)}`);
  for (const [k, label] of LIST_LABELS) for (const it of intelligence[k] || []) if (it && it.text) lines.push(`${label}: ${it.text}${cite(it.evidence)}`);
  for (const r of intelligence.quantitativeResults || []) lines.push(`Result: ${r.metric}: ${r.value}${r.context ? ` (${r.context})` : ""}${cite(r.evidence)}`);
  const passages = {};
  if (chunksById) for (const id of used) if (chunksById[id]) passages[id] = chunksById[id];
  return { text: lines.join("\n"), passages };
}

// ------------------------------------------------------------------------------------------------ CSV
/**
 * One CSV cell. Text that starts with = + - @ (or a tab or carriage return) would be run as a formula by Excel or Sheets, and the text here comes
 * from papers and model output, which nobody controls: it is prefixed with an apostrophe so the sheet shows it as text (OWASP "CSV injection").
 */
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] === undefined ? "" : r[i]])));
}

// ------------------------------------------------------------------------------------------------ rating plan
const SHEET_COLUMNS = ["unit_id", "paper_title", "paper_link", "summary_text", "evidence_passages", ...CRITERIA.map((c) => c.id), "failure_tags", "notes"];

/**
 * @param items [{paperId, title, link, license, summaries: {device_brief: {text, passages?}, backend_analysis: {text, passages?}}}]
 * Each (paper, system) pair is one blinded unit. Every rater rates every unit, in a different order; the key maps unit ids back to systems.
 */
function buildRatingPlan(items, { raters = ["rater_a", "rater_b"], seed = 1, kind = "HUMAN_RATED_STUDY" } = {}) {
  if (raters.length < 2) throw new Error("at least two independent raters are required");
  const rand = rng(seed);
  const units = [];
  for (const it of items) {
    for (const system of SYSTEMS) {
      const s = it.summaries && it.summaries[system];
      if (!s || !s.text || !String(s.text).trim()) continue;
      units.push({ item: it, system, text: s.text, passages: s.passages || {} });
    }
  }
  const ids = shuffled(units.map((_, i) => i), rand).map((n, i) => ({ n, id: `U${String(i + 1).padStart(4, "0")}` }));
  const byIndex = new Map(ids.map((x) => [x.n, x.id]));
  const key = { kind, seed, createdFor: raters, units: {} };
  const rowsOf = units.map((u, i) => {
    const unit_id = byIndex.get(i);
    key.units[unit_id] = { paperId: u.item.paperId, system: u.system, license: u.item.license || null };
    const allowText = permissionsFor(u.item.license).redistributeText === "yes";
    const passages = allowText ? Object.entries(u.passages).map(([id, t]) => `[${id}] ${t}`).join("\n") : "(the licence does not allow showing the passages here; open the paper)";
    return { unit_id, paper_title: u.item.title, paper_link: u.item.link || "", summary_text: u.text, evidence_passages: u.system === "backend_analysis" ? passages : "(none shown: this summary does not cite passages)" };
  });
  const sheets = {};
  for (const r of raters) sheets[r] = toCsv(shuffled(rowsOf, rng(seed + r.split("").reduce((a, c) => a + c.charCodeAt(0), 0))), SHEET_COLUMNS);
  return { key, sheets, unitCount: units.length, pairsPerPaper: SYSTEMS.length };
}

// ------------------------------------------------------------------------------------------------ statistics
/** Quadratic-weighted Cohen's kappa for two raters on an ordinal scale. null when undefined (all ratings identical on one value). */
function weightedKappa(a, b, { min = 1, max = 5 } = {}) {
  if (a.length !== b.length) throw new Error("both raters must rate the same units");
  const n = a.length;
  const k = max - min + 1;
  if (!n) return { n: 0, kappa: null, exact: null, withinOne: null };
  const obs = Array.from({ length: k }, () => new Array(k).fill(0));
  const ra = new Array(k).fill(0), rb = new Array(k).fill(0);
  let exact = 0, within = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - min, y = b[i] - min;
    obs[x][y] += 1; ra[x] += 1; rb[y] += 1;
    if (a[i] === b[i]) exact++;
    if (Math.abs(a[i] - b[i]) <= 1) within++;
  }
  const w = (i, j) => ((i - j) ** 2) / ((k - 1) ** 2);
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { num += w(i, j) * obs[i][j] / n; den += w(i, j) * (ra[i] * rb[j]) / (n * n); }
  return { n, kappa: den === 0 ? null : round(1 - num / den), exact: round(exact / n), withinOne: round(within / n) };
}

function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; }
function sd(xs) { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }
function bootstrapMeanCI(values, { seed = 1, reps = 2000, level = 0.95 } = {}) {
  if (values.length < 2) return { mean: round(mean(values)), low: null, high: null, n: values.length };
  const rand = rng(seed);
  const means = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(((1 - level) / 2) * reps)], hi = means[Math.min(reps - 1, Math.floor((1 - (1 - level) / 2) * reps))];
  return { mean: round(mean(values)), low: round(lo), high: round(hi), n: values.length };
}

const RELIABLE_KAPPA = 0.6;

/**
 * @param key  the key from buildRatingPlan
 * @param ratingsByRater  { raterName: [rows parsed from the returned CSV] }
 */
function analyseRatings(key, ratingsByRater, { seed = 1 } = {}) {
  const raters = Object.keys(ratingsByRater);
  if (raters.length < 2) throw new Error("two raters are required to measure agreement");
  const [A, B] = raters;
  const problems = [];
  const parsed = {};
  for (const r of raters) {
    parsed[r] = {};
    for (const row of ratingsByRater[r]) {
      const u = key.units[row.unit_id];
      if (!u) { problems.push(`${r}: unknown unit ${row.unit_id}`); continue; }
      const scores = {};
      let complete = true;
      for (const c of CRITERIA) {
        const v = Number(row[c.id]);
        if (!Number.isInteger(v) || v < 1 || v > 5) { complete = false; problems.push(`${r}: ${row.unit_id} ${c.id} is not an integer 1-5`); break; }
        scores[c.id] = v;
      }
      if (!complete) continue;
      const tags = String(row.failure_tags || "").split(/[;,|]/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      for (const t of tags) if (!FAILURE_TAGS.includes(t)) problems.push(`${r}: ${row.unit_id} unknown tag ${t}`);
      parsed[r][row.unit_id] = { scores, tags: tags.filter((t) => FAILURE_TAGS.includes(t)) };
    }
  }
  const common = Object.keys(key.units).filter((id) => raters.every((r) => parsed[r][id]));
  const missing = Object.keys(key.units).length - common.length;

  const agreement = {};
  for (const c of CRITERIA) {
    const a = common.map((id) => parsed[A][id].scores[c.id]);
    const b = common.map((id) => parsed[B][id].scores[c.id]);
    const wk = weightedKappa(a, b);
    agreement[c.id] = { ...wk, reliable: wk.kappa !== null && wk.kappa >= RELIABLE_KAPPA };
  }

  const perSystem = {};
  for (const sys of SYSTEMS) {
    const ids = common.filter((id) => key.units[id].system === sys);
    const scores = {};
    for (const c of CRITERIA) {
      const per = ids.map((id) => mean(raters.map((r) => parsed[r][id].scores[c.id])));
      scores[c.id] = { mean: round(mean(per)), sd: round(sd(per)), n: per.length };
    }
    // The costly outcome: a summary a careful reader would not rely on for facts.
    const unsafe = ids.filter((id) => raters.some((r) => parsed[r][id].scores.factual_accuracy <= 2)).length;
    const tagCounts = {};
    for (const id of ids) for (const t of new Set(raters.flatMap((r) => parsed[r][id].tags))) tagCounts[t] = (tagCounts[t] || 0) + 1;
    perSystem[sys] = { units: ids.length, scores, factuallyUnsafe: { count: unsafe, rate: ids.length ? round(unsafe / ids.length) : null }, failureTags: Object.fromEntries(Object.entries(tagCounts).sort((x, y) => y[1] - x[1])) };
  }

  // Paired by paper: backend minus device, mean of the two raters, with a bootstrap interval over papers.
  const papers = [...new Set(common.map((id) => key.units[id].paperId))];
  const comparison = {};
  for (const c of CRITERIA) {
    const diffs = [];
    for (const p of papers) {
      const d = common.find((id) => key.units[id].paperId === p && key.units[id].system === "device_brief");
      const b = common.find((id) => key.units[id].paperId === p && key.units[id].system === "backend_analysis");
      if (d && b) diffs.push(mean(raters.map((r) => parsed[r][b].scores[c.id] - parsed[r][d].scores[c.id])));
    }
    comparison[c.id] = { backendMinusDevice: bootstrapMeanCI(diffs, { seed }) };
  }

  const limitations = [
    "Ratings measure what these raters judged on these papers; they are not a measure of truth.",
    "Agreement below 0.6 on a criterion means that criterion's scores should not be used until the guidelines are clarified and the rating repeated.",
    "A paired interval that includes 0 means the data do not show a difference; it does not show that there is none.",
    "Only papers whose licence allows evaluation use are included; the sample is not representative of all literature."
  ];
  if (papers.length < 50) limitations.push(`Only ${papers.length} papers (${common.length} rated units), fewer than the planned 50: intervals are wide.`);
  return {
    kind: key.kind || "UNKNOWN",
    // Anything marked SYNTHETIC (tests, demos) is machinery output, never a finding about summaries.
    note: /^SYNTHETIC/.test(key.kind || "") ? `This analysis is of "${key.kind}" data. It is NOT evidence about summary quality.` : null,
    raters, unitsRated: common.length, unitsMissingFromAtLeastOneRater: missing, papers: papers.length,
    agreement, perSystem, comparison, problems, limitations
  };
}

module.exports = {
  CRITERIA, FAILURE_TAGS, SYSTEMS, SHEET_COLUMNS, RELIABLE_KAPPA,
  candidatesFromOpenAlex, selectBenchmarkPapers, renderIntelligenceText, buildRatingPlan, analyseRatings,
  weightedKappa, bootstrapMeanCI, toCsv, parseCsv, rng
};
