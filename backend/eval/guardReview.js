"use strict";
/**
 * Manual review kit for the evidence guard (finding F1). It answers the question the synthetic regression cases cannot: on REAL model output for
 * REAL papers, how often does the guard keep a statement a careful reader finds unsupported (miss), and drop one the reader finds supported
 * (false drop)?
 *
 * Flow (all offline; no model call, no spend):
 *   1. The owner runs one normal analysis per chosen paper and saves the model's raw JSON, the chunks it was shown and the paper's licence.
 *   2. `make` runs each statement through the SAME validator production uses, one at a time, and writes a reviewer sheet that does NOT show the
 *      guard's verdict, plus a private key with the verdicts. Papers whose licence does not allow internal evaluation are refused.
 *   3. One or two people read the cited passages and label each statement (SUPPORTED / PARTIAL / UNSUPPORTED / CONTRADICTED / NOT_A_CLAIM).
 *   4. `score` joins labels and verdicts and reports misses, false drops and the share of kept statements that are unsupported, with 95% Wilson
 *      intervals and honest warnings about sample size.
 * Nothing here changes the guard. Results describe the papers, model and prompt version reviewed, not summaries in general.
 */

const { validateIntelligence, SINGLE_FIELDS, LIST_FIELDS, INTEL_PROMPT_VERSION } = require("../llm/intelligence");
const { permissionsFor } = require("../papers/licensePolicy");
const { toCsv, parseCsv, rng } = require("./summaryBenchmark");
const { cohenKappa } = require("./agreement");

const VERDICTS = Object.freeze(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONTRADICTED", "NOT_A_CLAIM"]);
const SHEET_COLUMNS = ["unit_id", "paper_title", "paper_link", "statement", "cited_passages", "human_verdict", "human_notes"];
const MAX_PASSAGE_CHARS = 1500;
const round = (x, d = 3) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Wilson score interval for k of n (95%). Honest at small n, unlike the normal approximation. */
function wilson(k, n, z = 1.96) {
  if (!n) return { rate: null, low: null, high: null, n: 0, k };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: round(p), low: round(Math.max(0, c - h)), high: round(Math.min(1, c + h)), n, k };
}

/** Every statement and quantitative result in the raw model JSON, as separate units. */
function unitsFromModelOutput(model) {
  const units = [];
  if (!model || typeof model !== "object") return units;
  for (const f of SINGLE_FIELDS) if (model[f] && typeof model[f] === "object") units.push({ field: f, kind: "statement", raw: model[f] });
  for (const f of LIST_FIELDS) if (Array.isArray(model[f])) model[f].slice(0, 8).forEach((raw) => { if (raw && typeof raw === "object") units.push({ field: f, kind: "statement", raw }); });
  if (Array.isArray(model.quantitativeResults)) model.quantitativeResults.slice(0, 30).forEach((raw) => { if (raw && typeof raw === "object") units.push({ field: "quantitativeResults", kind: "result", raw }); });
  return units;
}

const textOf = (u) => (u.kind === "result" ? `${u.raw.metric}: ${u.raw.value}${u.raw.context ? ` (${u.raw.context})` : ""}` : String(u.raw.text || ""));

/** What production does with this one statement: KEPT or DROPPED (with the reason), the qualifiers, and how many source sentences it pointed to. */
function judgeUnit(u, chunks) {
  const parsed = u.kind === "result" ? { quantitativeResults: [u.raw] } : LIST_FIELDS.includes(u.field) ? { [u.field]: [u.raw] } : { [u.field]: u.raw };
  const v = validateIntelligence(parsed, chunks);
  const out = u.kind === "result" ? v.intelligence.quantitativeResults[0] : LIST_FIELDS.includes(u.field) ? v.intelligence[u.field][0] : v.intelligence[u.field];
  if (!out) return { verdict: "DROPPED", reason: Object.keys(v.reasons)[0] || "UNKNOWN", qualifiers: [], spans: 0 };
  return { verdict: "KEPT", reason: null, qualifiers: out.qualifiers || [], spans: (out.evidenceSpans || []).length };
}

/**
 * @param {{paper:{paperId:string,title:string,license:string|null,doi?:string,sourceUrl?:string}, chunks:Array<{chunkId:string,text:string,section?:string}>, modelOutput:object}} input
 * @returns {{sheet:string, key:object, units:number}}
 */
function buildReviewPlan(input, { seed = 1 } = {}) {
  const { paper, chunks, modelOutput } = input || {};
  if (!paper || !paper.paperId || !Array.isArray(chunks) || !chunks.length) throw new Error("input needs paper, chunks and modelOutput");
  const perm = permissionsFor(paper.license);
  if (perm.evalCorpus !== "yes") throw new Error(`refused: the licence "${perm.license.normalised}" does not clearly allow keeping this paper's text in an internal evaluation set (${perm.reason}). Choose a paper under CC0, public domain, CC BY or CC BY-SA, or have a person review the licence first.`);
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));
  const units = unitsFromModelOutput(modelOutput).map((u) => ({ ...u, judged: judgeUnit(u, chunks) }));
  if (!units.length) throw new Error("the model output contains no statements");
  const rand = rng(seed);
  const order = units.map((u, i) => ({ u, i, r: rand() })).sort((a, b) => a.r - b.r);
  const rows = [];
  const keyUnits = {};
  order.forEach(({ u }, n) => {
    const id = `S${String(n + 1).padStart(3, "0")}`;
    const cited = (Array.isArray(u.raw.evidence) ? u.raw.evidence : []).filter((c) => byId.has(c));
    rows.push({
      unit_id: id,
      paper_title: paper.title || "",
      paper_link: paper.sourceUrl || (paper.doi ? `https://doi.org/${paper.doi}` : ""),
      statement: textOf(u),
      cited_passages: cited.length ? cited.map((c) => `[${c}] ${String(byId.get(c).text).slice(0, MAX_PASSAGE_CHARS)}`).join("\n\n") : "(the statement cites no passage that exists)",
      human_verdict: "",
      human_notes: ""
    });
    keyUnits[id] = { field: u.field, kind: u.kind, ...u.judged };
  });
  return {
    sheet: toCsv(rows, SHEET_COLUMNS),
    units: rows.length,
    key: { kind: "GUARD_REVIEW_KEY_DO_NOT_SHARE_WITH_REVIEWERS", promptVersion: INTEL_PROMPT_VERSION, paper: { paperId: paper.paperId, title: paper.title || null, license: perm.license.normalised }, seed, units: keyUnits }
  };
}

/** @param sheets array of parsed CSV row arrays, one per reviewer (1 or 2) */
function scoreReview(key, sheets) {
  const problems = [];
  const labels = {};
  const per = sheets.map((rows) => {
    const m = {};
    for (const r of rows) {
      const id = (r.unit_id || "").trim();
      const v = (r.human_verdict || "").trim().toUpperCase();
      if (!id) continue;
      if (!key.units[id]) { problems.push(`unknown unit ${id}`); continue; }
      if (v === "") continue;
      if (!VERDICTS.includes(v)) { problems.push(`${id}: unknown verdict "${v}"`); continue; }
      m[id] = v;
    }
    return m;
  });
  let disputed = 0;
  let unlabelled = 0;
  for (const id of Object.keys(key.units)) {
    const vs = per.map((m) => m[id]).filter(Boolean);
    if (vs.length < per.length) { unlabelled += 1; continue; }
    if (new Set(vs).size > 1) { disputed += 1; continue; }
    labels[id] = vs[0];
  }
  const good = [], bad = [], partial = [];
  const kept = { good: 0, partial: 0, bad: 0 };
  for (const [id, v] of Object.entries(labels)) {
    if (v === "NOT_A_CLAIM") continue;
    const k = key.units[id].verdict === "KEPT";
    if (v === "SUPPORTED") { good.push(id); if (k) kept.good += 1; }
    else if (v === "PARTIAL") { partial.push(id); if (k) kept.partial += 1; }
    else { bad.push(id); if (k) kept.bad += 1; }
  }
  const keptTotal = kept.good + kept.partial + kept.bad;
  const dropReasons = {};
  for (const id of bad.concat(good)) if (key.units[id].verdict === "DROPPED") dropReasons[`${labels[id]}:${key.units[id].reason}`] = (dropReasons[`${labels[id]}:${key.units[id].reason}`] || 0) + 1;
  let agreement = null;
  if (per.length === 2) {
    const both = Object.keys(key.units).filter((id) => per[0][id] && per[1][id]);
    agreement = { n: both.length, exact: round(both.filter((id) => per[0][id] === per[1][id]).length / (both.length || 1)), kappa: both.length ? cohenKappa(both.map((id) => per[0][id]), both.map((id) => per[1][id])).kappa : null };
  }
  const warnings = [];
  if (per.length < 2) warnings.push("Only one reviewer: no agreement can be measured and one person's mistakes go straight into the result.");
  if (bad.length < 30) warnings.push(`Only ${bad.length} unsupported statements were found: the miss rate has a very wide interval.`);
  if (good.length < 30) warnings.push(`Only ${good.length} supported statements: the false-drop rate has a very wide interval.`);
  if (agreement && agreement.kappa !== null && agreement.kappa < 0.6) warnings.push(`Reviewer agreement is low (kappa ${agreement.kappa}): the rubric needs another round before these rates mean anything.`);
  warnings.push("Statements from one paper are not independent, and the papers, model and prompt version are the ones reviewed. These rates do not describe summaries in general.");
  return {
    promptVersion: key.promptVersion,
    paper: key.paper,
    reviewers: per.length,
    units: Object.keys(key.units).length,
    labelled: Object.keys(labels).length,
    disputed,
    unlabelled,
    counts: { supported: good.length, partial: partial.length, unsupportedOrContradicted: bad.length },
    miss: wilson(kept.bad, bad.length),
    falseDrop: wilson(good.length - kept.good, good.length),
    shareOfKeptThatIsUnsupported: wilson(kept.bad, keptTotal),
    shareOfKeptThatIsPartial: wilson(kept.partial, keptTotal),
    keptBreakdown: kept,
    droppedBreakdown: dropReasons,
    agreement,
    problems,
    warnings
  };
}

module.exports = { VERDICTS, SHEET_COLUMNS, wilson, unitsFromModelOutput, judgeUnit, buildReviewPlan, scoreReview, parseCsv };
