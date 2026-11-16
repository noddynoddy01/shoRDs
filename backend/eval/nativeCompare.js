"use strict";
/**
 * Phase 5C evaluation framework: blinded comparison of THREE systems on identical papers and identical output requirements.
 *
 *   A_claude_baseline     the current production Claude brief (rendered from its stored `intelligence` object)
 *   B_open_weight_direct  one open-weight model, one prompt, whole brief at once (native/directBaseline.js)
 *   C_native_pipeline     the multi-stage shoRDs pipeline (native/pipeline.js) with the same or another model
 *
 * It extends, and does not replace, eval/summaryBenchmark.js (two systems, five criteria): it reuses its criteria definitions, CSV
 * helpers, quadratic-weighted kappa and bootstrap interval, and adds three criteria the Phase 5 brief asks for (quantitative accuracy,
 * methodology understanding, limitation identification) and a third system.
 *
 * Fair presentation: every system is rendered into the SAME nine-section layout, with passages shown the same way, with no model name,
 * no status label and no length-based hints, and the units are shuffled per rater. Length is reported as a confound, never as quality.
 *
 * Nothing here contains a rating. Output computed from `kind` starting with SYNTHETIC is machinery output, never a finding.
 * Pure functions: no network, no model call.
 */
const sb = require("./summaryBenchmark");
const { permissionsFor } = require("../papers/licensePolicy");
const { SECTIONS } = require("../native/brief");
const { guardNumbers } = require("../llm/claimGuard");

const COMPARE_SYSTEMS = Object.freeze(["A_claude_baseline", "B_open_weight_direct", "C_native_pipeline"]);

const EXTRA_CRITERIA = Object.freeze([
  { id: "quantitative_accuracy", label: "Quantitative accuracy", question: "Are the reported numbers, units, metrics and the groups they compare exactly those of the paper (own results, not cited work)? (1 = several wrong or mis-attributed; 5 = all exact)" },
  { id: "methodology_understanding", label: "Methodology understanding", question: "Does the summary show what was actually done, with the settings that matter, and connect the method to the results? (1 = misunderstood or missing; 5 = precise and connected)" },
  { id: "limitation_identification", label: "Limitation identification", question: "Does it state the limitations the authors state (and no invented ones)? (1 = none or invented; 5 = complete and faithful; if the paper states none, 5 means it says so)" }
]);
// usefulness keeps its production id; its label in this study is "Research usefulness"
const CRITERIA = Object.freeze([...sb.CRITERIA, ...EXTRA_CRITERIA]);
const SHEET_COLUMNS = ["unit_id", "paper_title", "paper_link", "summary_text", "evidence_passages", ...CRITERIA.map((c) => c.id), "failure_tags", "notes"];

// ---------------------------------------------------------------------------------------------------------- rendering
/** Same layout for all systems. sections: { key: [{text, evidence:[chunkId...]}] } ; unavailable sections are written out. */
function renderSections(sections) {
  const lines = [];
  const used = new Set();
  for (const s of SECTIONS) {
    const items = (sections && sections[s.key]) || [];
    lines.push(`${s.label}:`);
    if (!items.length) lines.push("  Unavailable.");
    for (const it of items) {
      (it.evidence || []).forEach((e) => used.add(e));
      lines.push(`  - ${it.text}${it.evidence && it.evidence.length ? ` [${it.evidence.join(", ")}]` : " [no source]"}`);
    }
  }
  return { text: lines.join("\n"), usedIds: used };
}

/** Map the production `intelligence` object (system A) onto the nine sections. Fields the production schema does not have stay empty. */
function sectionsFromIntelligence(intel) {
  const one = (f) => (f && f.text ? [{ text: f.text, evidence: f.evidence || [] }] : []);
  const many = (l) => (l || []).filter((x) => x && x.text).map((x) => ({ text: x.text, evidence: x.evidence || [] }));
  return {
    inBrief: one(intel.tldr), researchProblem: one(intel.researchProblem), whyItMatters: one(intel.whyItMatters || intel.motivation),
    proposedMethod: one(intel.methodology).concat(one(intel.architecture)), keyContributions: many(intel.contributions), majorFindings: one(intel.findings),
    quantitativeResults: (intel.quantitativeResults || []).map((r) => ({ text: `${r.metric}: ${r.value}${r.context ? ` (${r.context})` : ""}`, evidence: r.evidence || [] })),
    limitations: many(intel.limitations), futureDirections: one(intel.futureWork)
  };
}

/** Map a native pipeline / direct baseline result (validated sections) to the neutral shape. */
function sectionsFromValidated(validatedSections) {
  const out = {};
  for (const s of SECTIONS) out[s.key] = (validatedSections[s.key] || []).map((st) => ({ text: st.text, evidence: [...new Set(st.evidence.map((e) => e.chunkId))] }));
  return out;
}

// ----------------------------------------------------------------------------------------------------- blinded plan
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * @param items [{paperId,title,link,license, systems:{A_claude_baseline?:{sections, passages}, B_...?, C_...?}}]  passages: {chunkId: text}
 * Each (paper, system) with a non-empty summary is one blinded unit; every rater rates every unit in a different order.
 */
function buildComparisonPlan(items, { raters = ["rater_a", "rater_b"], seed = 1, kind = "HUMAN_RATED_STUDY" } = {}) {
  if (raters.length < 2) throw new Error("at least two independent raters are required");
  const rand = sb.rng(seed);
  const units = [];
  for (const it of items) for (const system of COMPARE_SYSTEMS) {
    const s = it.systems && it.systems[system];
    if (!s) continue;
    const r = renderSections(s.sections);
    if (![...Object.values(s.sections || {})].some((l) => l && l.length)) continue;
    units.push({ it, system, text: r.text, usedIds: r.usedIds, passages: s.passages || {} });
  }
  const order = shuffled(units.map((_, i) => i), rand).map((n, i) => ({ n, id: `U${String(i + 1).padStart(4, "0")}` }));
  const idOf = new Map(order.map((x) => [x.n, x.id]));
  const key = { kind, seed, createdFor: raters, units: {} };
  const rows = units.map((u, i) => {
    const unit_id = idOf.get(i);
    key.units[unit_id] = { paperId: u.it.paperId, system: u.system, license: u.it.license || null, chars: u.text.length };
    const allow = permissionsFor(u.it.license).redistributeText === "yes";
    const passages = allow ? [...u.usedIds].filter((id) => u.passages[id]).map((id) => `[${id}] ${u.passages[id]}`).join("\n") : "(the licence does not allow showing the passages here; open the paper)";
    return { unit_id, paper_title: u.it.title, paper_link: u.it.link || "", summary_text: u.text, evidence_passages: passages };
  });
  const sheets = {};
  for (const r of raters) sheets[r] = sb.toCsv(shuffled(rows, sb.rng(seed + r.split("").reduce((a, c) => a + c.charCodeAt(0), 0))), SHEET_COLUMNS);
  return { key, sheets, unitCount: units.length, systemsPresent: COMPARE_SYSTEMS.filter((s) => units.some((u) => u.system === s)) };
}

// -------------------------------------------------------------------------------------------------------- statistics
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const round = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const PAIRS = [["B_open_weight_direct", "A_claude_baseline"], ["C_native_pipeline", "A_claude_baseline"], ["C_native_pipeline", "B_open_weight_direct"]];

function analyseComparison(key, ratingsByRater, { seed = 1 } = {}) {
  const raters = Object.keys(ratingsByRater);
  if (raters.length < 2) throw new Error("two raters are required to measure agreement");
  const [RA, RB] = raters;
  const problems = [];
  const parsed = {};
  for (const r of raters) {
    parsed[r] = {};
    for (const row of ratingsByRater[r]) {
      const u = key.units[row.unit_id];
      if (!u) { problems.push(`${r}: unknown unit ${row.unit_id}`); continue; }
      const scores = {};
      let ok = true;
      for (const c of CRITERIA) {
        const v = Number(row[c.id]);
        if (!Number.isInteger(v) || v < 1 || v > 5) { ok = false; problems.push(`${r}: ${row.unit_id} ${c.id} is not an integer 1-5`); break; }
        scores[c.id] = v;
      }
      if (!ok) continue;
      const tags = String(row.failure_tags || "").split(/[;,|]/).map((t) => t.trim().toUpperCase()).filter(Boolean);
      for (const t of tags) if (!sb.FAILURE_TAGS.includes(t)) problems.push(`${r}: ${row.unit_id} unknown tag ${t}`);
      parsed[r][row.unit_id] = { scores, tags: tags.filter((t) => sb.FAILURE_TAGS.includes(t)) };
    }
  }
  const common = Object.keys(key.units).filter((id) => raters.every((r) => parsed[r][id]));
  const agreement = {};
  for (const c of CRITERIA) {
    const wk = sb.weightedKappa(common.map((id) => parsed[RA][id].scores[c.id]), common.map((id) => parsed[RB][id].scores[c.id]));
    agreement[c.id] = { ...wk, reliable: wk.kappa !== null && wk.kappa >= sb.RELIABLE_KAPPA };
  }
  const perSystem = {};
  for (const sys of COMPARE_SYSTEMS) {
    const ids = common.filter((id) => key.units[id].system === sys);
    if (!ids.length) continue;
    const scores = {};
    for (const c of CRITERIA) { const per = ids.map((id) => mean(raters.map((r) => parsed[r][id].scores[c.id]))); scores[c.id] = { mean: round(mean(per)), sd: round(sd(per)), n: per.length }; }
    const allMeans = CRITERIA.map((c) => scores[c.id].mean);
    const unsafe = ids.filter((id) => raters.some((r) => parsed[r][id].scores.factual_accuracy <= 2 || parsed[r][id].scores.quantitative_accuracy <= 2)).length;
    const tagCounts = {};
    for (const id of ids) for (const t of new Set(raters.flatMap((r) => parsed[r][id].tags))) tagCounts[t] = (tagCounts[t] || 0) + 1;
    perSystem[sys] = { units: ids.length, scores, overallMean: round(mean(allMeans)), factuallyUnsafe: { count: unsafe, rate: round(unsafe / ids.length) }, failureTags: Object.fromEntries(Object.entries(tagCounts).sort((x, y) => y[1] - x[1])), meanChars: round(mean(ids.map((id) => key.units[id].chars)), 0) };
  }
  const papers = [...new Set(common.map((id) => key.units[id].paperId))];
  const comparisons = {};
  for (const [x, y] of PAIRS) {
    if (!perSystem[x] || !perSystem[y]) continue;
    const per = {};
    for (const c of CRITERIA) {
      const diffs = [];
      for (const p of papers) {
        const ux = common.find((id) => key.units[id].paperId === p && key.units[id].system === x);
        const uy = common.find((id) => key.units[id].paperId === p && key.units[id].system === y);
        if (ux && uy) diffs.push(mean(raters.map((r) => parsed[r][ux].scores[c.id] - parsed[r][uy].scores[c.id])));
      }
      per[c.id] = sb.bootstrapMeanCI(diffs, { seed });
    }
    comparisons[`${x}_minus_${y}`] = per;
  }
  const synthetic = /^SYNTHETIC/.test(key.kind || "");
  return {
    kind: key.kind || "UNKNOWN", note: synthetic ? `This analysis is of "${key.kind}" data. It is NOT evidence about summary quality.` : null,
    raters, unitsRated: common.length, papers: papers.length, agreement, perSystem, comparisons, problems,
    decision: decide({ papers: papers.length, agreement, comparisons, perSystem, synthetic }),
    limitations: [
      "Ratings measure what these raters judged on these papers; they are not a measure of truth.",
      "A criterion with weighted kappa below 0.6 is not interpretable until the guidelines are clarified and the rating repeated.",
      "A paired interval that includes 0 means the data show no difference; it does not show that there is none.",
      "Length is a confound: meanChars is reported per system and a longer summary is never counted as a better one."
    ]
  };
}

/**
 * Pre-declared decision rule (fixed BEFORE any rating exists, so it cannot be tuned to a result). A system X "may replace" baseline A only if
 *  - at least 50 papers were rated and every criterion used below has weighted kappa >= 0.6,
 *  - on factual_accuracy and quantitative_accuracy the lower bound of the paired 95% interval of (X - A) is >= -0.25 (non-inferiority margin of a quarter point), and
 *  - X's rate of factually unsafe summaries is not above A's rate by more than 0.05.
 * "Superior" additionally needs the lower bound > 0 on those two criteria. Anything else is reported as "not shown".
 */
function decide({ papers, agreement, comparisons, perSystem, synthetic }) {
  const out = { rule: "non-inferiority margin 0.25 on factual_accuracy and quantitative_accuracy; unsafe-rate increase <= 0.05; >= 50 papers; kappa >= 0.6", results: {} };
  if (synthetic) return { ...out, verdict: "NOT_EVIDENCE_SYNTHETIC_DATA" };
  for (const x of ["B_open_weight_direct", "C_native_pipeline"]) {
    const cmp = comparisons[`${x}_minus_A_claude_baseline`];
    if (!cmp) { out.results[x] = "NO_BASELINE_COMPARISON"; continue; }
    const crit = ["factual_accuracy", "quantitative_accuracy"];
    const reliable = crit.every((c) => agreement[c] && agreement[c].reliable);
    const lo = crit.map((c) => (cmp[c] && cmp[c].low !== undefined ? cmp[c].low : null));
    const unsafeUp = (perSystem[x].factuallyUnsafe.rate || 0) - (perSystem.A_claude_baseline.factuallyUnsafe.rate || 0);
    if (papers < 50) out.results[x] = "NOT_SHOWN_TOO_FEW_PAPERS";
    else if (!reliable) out.results[x] = "NOT_SHOWN_RATERS_NOT_RELIABLE";
    else if (lo.some((v) => v === null)) out.results[x] = "NOT_SHOWN_NO_INTERVAL";
    else if (unsafeUp > 0.05) out.results[x] = "NOT_ACCEPTABLE_MORE_UNSAFE_SUMMARIES";
    else if (lo.every((v) => v > 0)) out.results[x] = "SUPERIOR_ON_ACCURACY";
    else if (lo.every((v) => v >= -0.25)) out.results[x] = "NON_INFERIOR_ON_ACCURACY";
    else out.results[x] = "NOT_SHOWN_NON_INFERIOR";
  }
  return out;
}

// ------------------------------------------------------------------------------------------ automatic (non-human) metrics
/**
 * Machine-checkable measures computed identically for every system from its statements and the paper's chunks. They support, and never replace,
 * the human ratings. All use the existing guard's number rule, so "numerical error" means "a number in a statement that is not in the passages
 * it cites", which is a proxy for a wrong number, not a proof of one.
 */
function automaticMetrics(sections, chunks) {
  const byId = new Map(chunks.map((c) => [c.chunkId, c.text]));
  let statements = 0, noCitation = 0, numericStatements = 0, numberNotInCited = 0, unknownCitation = 0;
  let chars = 0;
  for (const s of SECTIONS) for (const it of (sections && sections[s.key]) || []) {
    statements += 1; chars += it.text.length;
    const ev = it.evidence || [];
    if (!ev.length) noCitation += 1;
    const known = ev.filter((id) => byId.has(id));
    if (ev.length && !known.length) unknownCitation += 1;
    const nums = guardNumbers(it.text);
    if (nums.length) {
      numericStatements += 1;
      const have = new Set(guardNumbers(known.map((id) => byId.get(id)).join(" ")));
      if (!nums.every((n) => have.has(n))) numberNotInCited += 1;
    }
  }
  const sectionsAvailable = SECTIONS.filter((s) => ((sections && sections[s.key]) || []).length).length;
  return { statements, statementsWithoutCitation: noCitation, statementsWithUnknownCitation: unknownCitation, numericStatements, numericStatementsWithNumberNotInCitedText: numberNotInCited, sectionsAvailable, sectionsTotal: SECTIONS.length, chars };
}

/** Operational summary per system from per-paper run records [{system, totalMs, costUsd|null, tokens:{input,output}, failed}] */
function operationalSummary(runs) {
  const out = {};
  for (const sys of COMPARE_SYSTEMS) {
    const r = runs.filter((x) => x.system === sys);
    if (!r.length) continue;
    const ms = r.map((x) => x.totalMs).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
    const costs = r.map((x) => x.costUsd).filter((c) => typeof c === "number");
    out[sys] = { papers: r.length, failed: r.filter((x) => x.failed).length, latencyMs: { mean: round(mean(ms), 0), p50: q(0.5), p95: q(0.95) }, costUsdPerPaper: costs.length === r.length ? round(mean(costs), 5) : null, costMeasuredFor: `${costs.length}/${r.length}`, meanInputTokens: round(mean(r.map((x) => (x.tokens && x.tokens.input) || 0)), 0), meanOutputTokens: round(mean(r.map((x) => (x.tokens && x.tokens.output) || 0)), 0) };
  }
  return out;
}

module.exports = { COMPARE_SYSTEMS, CRITERIA, SHEET_COLUMNS, renderSections, sectionsFromIntelligence, sectionsFromValidated, buildComparisonPlan, analyseComparison, decide, automaticMetrics, operationalSummary };
