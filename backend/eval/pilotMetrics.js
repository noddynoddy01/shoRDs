"use strict";
/**
 * Measurements for the real-model pilot (Phase 6): what each system did with one real paper, taken from the pipeline's own records.
 *
 * Everything here is AUTOMATIC and says what happened, not whether it was good:
 *   - counts of what was extracted, rejected, shown, withheld or unavailable;
 *   - "number coverage": how many of the numbers written in the paper's abstract/results/tables appear anywhere in the brief
 *     (a coverage figure, not an accuracy figure: a brief can repeat the right numbers and still say the wrong thing);
 *   - "ungrounded numbers": numbers in the brief that are not written in the paper at all (should be zero after the guard);
 *   - time, tokens and throughput exactly as reported by the run (null when the server did not report them).
 * Quality (factual accuracy, completeness, methodology, limitations, traceability, readability) is judged ONLY by the blinded human
 * rating in nativeCompare.js. Nothing here is a verdict on a model.
 */
const { guardNumbers } = require("../llm/claimGuard");
const { SECTIONS } = require("../native/brief");

const KEY_SECTIONS = new Set(["ABSTRACT", "RESULTS", "TABLE", "CONCLUSION", "DISCUSSION"]);
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const mean = (a) => (a.length ? a.reduce((n, x) => n + x, 0) / a.length : null);

/** statements: [{text, evidence:[chunkId]}] across sections (sectionsFromValidated shape) */
function numberCoverage(sections, chunks) {
  const source = new Set(chunks.filter((c) => KEY_SECTIONS.has(c.section)).flatMap((c) => guardNumbers(c.text)));
  const everything = new Set(chunks.flatMap((c) => guardNumbers(c.text)));
  const brief = new Set();
  for (const s of SECTIONS) for (const st of (sections && sections[s.key]) || []) for (const n of guardNumbers(st.text)) brief.add(n);
  const preserved = [...source].filter((n) => brief.has(n));
  const ungrounded = [...brief].filter((n) => !everything.has(n));
  return { sourceNumbers: source.size, preservedInBrief: preserved.length, coverage: source.size ? round(preserved.length / source.size) : null, briefNumbers: brief.size, ungroundedNumbers: ungrounded, missingFromBrief: [...source].filter((n) => !brief.has(n)).slice(0, 40) };
}

function citedChunks(sections) {
  const ids = new Set();
  for (const s of SECTIONS) for (const st of (sections && sections[s.key]) || []) for (const id of st.evidence || []) ids.add(id);
  return ids;
}

function throughput(calls) {
  const t = calls.map((c) => c.serverTimings).filter(Boolean);
  const gen = t.map((x) => x.generatedPerSecond).filter(Number.isFinite);
  const pre = t.map((x) => x.promptPerSecond).filter(Number.isFinite);
  return { callsWithServerTimings: t.length, generatedTokensPerSecondMean: round(mean(gen), 2), promptTokensPerSecondMean: round(mean(pre), 2) };
}

/** System C (multi-stage pipeline) result -> flat record */
function summarisePipeline(result, chunks, sections) {
  const d = result.diagnostics;
  const calls = d.perCall || [];
  const stageB = calls.filter((c) => c.stage === "B");
  const dropReasons = {};
  for (const per of Object.values(d.extractionDrops || {})) for (const [k, v] of Object.entries(per || {})) dropReasons[k] = (dropReasons[k] || 0) + v;
  const claimsKept = stageB.reduce((n, c) => n + (c.kept || 0), 0);
  const withheldReasons = {};
  for (const w of result.validation.withheld) withheldReasons[w.reason] = (withheldReasons[w.reason] || 0) + 1;
  const cited = citedChunks(sections);
  return {
    system: "C_native_pipeline",
    coverageUsed: result.provenance.coverageUsed, licenceDowngrade: result.provenance.licenceDowngrade,
    sectionsDetected: result.document.quality.sectionsFound, sectionsMissing: result.document.quality.sectionsMissing, extractionFlags: result.document.quality.flags.map((f) => f.code),
    chunks: chunks.length,
    extraction: { fieldCalls: stageB.length, failedFieldCalls: stageB.filter((c) => c.ok === false).length, claimsKept, claimsRejected: Object.values(dropReasons).reduce((n, x) => n + x, 0), rejectedByReason: dropReasons, skippedFields: d.skippedFields },
    representation: { claimsAfterDedupe: result.representation.claimCount, methodResultLinks: result.representation.methodResultLinks.length, unlinkedResults: result.representation.unlinkedResults.length, possibleContradictions: result.representation.possibleContradictions.length },
    brief: { statementsChecked: result.validation.checked, statementsShown: result.validation.supported, statementsWithheld: result.validation.withheld.length, withheldByReason: withheldReasons, productionGate: result.validation.productionGate, sectionsAvailable: result.brief.filter((s) => s.status === "AVAILABLE").length, unavailableSections: result.brief.filter((s) => s.status === "UNAVAILABLE").map((s) => ({ section: s.key, reason: s.reason })) },
    evidence: { distinctPassagesCited: cited.size, passagesAvailable: chunks.length },
    numbers: numberCoverage(sections, chunks),
    time: { stageMs: d.stageMs, totalMs: d.totalMs },
    calls: { total: d.modelCalls, failed: d.failedCalls, truncated: calls.filter((c) => c.truncated).length },
    tokens: { ...d.tokens, measured: d.tokens.unmeasuredCalls === 0 },
    throughput: throughput(calls),
    costUsd: d.costUsd, costStatus: d.costUnmeasuredCalls === 0 && d.costUsd !== null ? "MEASURED_OR_FREE_LOCAL" : "NOT_MEASURED"
  };
}

/** System B (one-shot) result -> flat record */
function summariseDirect(result, chunks, sections, wallMs) {
  const v = result.validation;
  const call = result.call || {};
  const withheldReasons = {};
  for (const w of (v && v.withheld) || []) withheldReasons[w.reason] = (withheldReasons[w.reason] || 0) + 1;
  const cited = citedChunks(sections || {});
  return {
    system: "B_open_weight_direct", ok: Boolean(result.ok), failure: result.ok ? null : result.category,
    chunks: chunks.length, chunksCutToFitOnePrompt: result.chunksCut || 0, anchoringRejectedByReason: result.anchoringDrops || {},
    brief: v ? { statementsChecked: v.stats.checked, statementsShown: v.stats.supported, statementsWithheld: v.stats.withheld, withheldByReason: withheldReasons, sectionsAvailable: SECTIONS.filter((s) => (v.sections[s.key] || []).length).length } : null,
    evidence: { distinctPassagesCited: cited.size, passagesAvailable: chunks.length },
    numbers: sections ? numberCoverage(sections, chunks) : null,
    time: { totalMs: wallMs }, calls: { total: 1, failed: result.ok ? 0 : 1, truncated: call.truncated ? 1 : 0 },
    tokens: call.usage ? { input: call.usage.inputTokens, output: call.usage.outputTokens, measured: true } : { input: null, output: null, measured: false },
    throughput: throughput([call]),
    costUsd: typeof call.costUsd === "number" ? call.costUsd : null
  };
}

const f = (x, d = "n/a") => (x === null || x === undefined ? d : String(x));
const cell = (x) => String(x).replace(/\|/g, "/");

/**
 * records: [{ paper:{paperId,title,licence}, run:{model,revision,quantization,runtime,hardware,startedAt}, B:summariseDirect(...), C:summarisePipeline(...) }]
 * Returns markdown. Measured values come from the run; nothing is estimated here.
 */
function pilotReportMarkdown(records, meta = {}) {
  const out = [];
  out.push(`# Real-model pilot report`, "", `Generated by scripts/native_pilot.js. **Automatic measurements only. No quality judgement is made here**: factual accuracy, completeness, methodology, limitations, traceability and readability need the blinded human rating (nativeCompare.js).`, "");
  out.push(`- Model: ${f(meta.model)} · revision: ${f(meta.revision)} · quantisation: ${f(meta.quantization)} · runtime: ${f(meta.runtime)}`);
  out.push(`- Hardware: ${f(meta.hardware && meta.hardware.summary)} (full record in hardware.json)`, `- Papers: ${records.length}`, "");
  for (const r of records) {
    out.push(`## ${cell(r.paper.title || r.paper.paperId)}`, `Paper: ${r.paper.paperId} · licence: ${f(r.paper.licence && r.paper.licence.spdx)} (confirmed by ${f(r.paper.licence && r.paper.licence.confirmedBy)}) · text used: ${r.C ? r.C.coverageUsed : "n/a"}`, "");
    out.push(`| measurement | B one-shot | C multi-stage |`, `|---|---|---|`);
    const row = (name, b, c) => out.push(`| ${name} | ${f(b)} | ${f(c)} |`);
    row("run ok", r.B && r.B.ok, r.C && r.C.calls.failed === 0 ? "yes" : r.C ? `${r.C.calls.failed} failed call(s)` : "n/a");
    row("sections available (of 9)", r.B && r.B.brief && r.B.brief.sectionsAvailable, r.C && r.C.brief.sectionsAvailable);
    row("statements shown", r.B && r.B.brief && r.B.brief.statementsShown, r.C && r.C.brief.statementsShown);
    row("statements withheld by the guard", r.B && r.B.brief && r.B.brief.statementsWithheld, r.C && r.C.brief.statementsWithheld);
    row("claims rejected at extraction (not in a given passage)", r.B && JSON.stringify(r.B.anchoringRejectedByReason), r.C && r.C.extraction.claimsRejected);
    row("claims extracted (stage B kept)", "n/a", r.C && r.C.extraction.claimsKept);
    row("distinct passages cited", r.B && r.B.evidence.distinctPassagesCited, r.C && r.C.evidence.distinctPassagesCited);
    row("number coverage (source numbers present in brief)", r.B && r.B.numbers && r.B.numbers.coverage, r.C && r.C.numbers.coverage);
    row("ungrounded numbers in brief", r.B && r.B.numbers && r.B.numbers.ungroundedNumbers.length, r.C && r.C.numbers.ungroundedNumbers.length);
    row("model calls", r.B && r.B.calls.total, r.C && r.C.calls.total);
    row("truncated calls", r.B && r.B.calls.truncated, r.C && r.C.calls.truncated);
    row("input tokens (measured)", r.B && r.B.tokens.input, r.C && r.C.tokens.input);
    row("output tokens (measured)", r.B && r.B.tokens.output, r.C && r.C.tokens.output);
    row("total latency (ms)", r.B && r.B.time.totalMs, r.C && r.C.time.totalMs);
    row("generation speed (tok/s, server-reported)", r.B && r.B.throughput.generatedTokensPerSecondMean, r.C && r.C.throughput.generatedTokensPerSecondMean);
    row("inference cost (USD)", r.B && r.B.costUsd, r.C && r.C.costUsd);
    out.push("");
    if (r.C) {
      out.push(`Stage latency (C, ms): ${Object.entries(r.C.time.stageMs).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
      out.push(`Sections detected: ${r.C.sectionsDetected.join(", ") || "none"}; missing: ${r.C.sectionsMissing.join(", ") || "none"}. Extraction flags: ${r.C.extractionFlags.join(", ") || "none"}.`);
      out.push(`Unavailable sections (C): ${r.C.brief.unavailableSections.map((s) => `${s.section} (${s.reason})`).join(", ") || "none"}.`);
      out.push(`Guard withheld (C) by reason: ${JSON.stringify(r.C.brief.withheldByReason)}; production validator: ${JSON.stringify(r.C.brief.productionGate)}.`);
      if (r.C.numbers.missingFromBrief.length) out.push(`Source numbers not in the brief (first ${r.C.numbers.missingFromBrief.length}): ${r.C.numbers.missingFromBrief.join(", ")}.`);
      out.push("");
    }
  }
  out.push("## How to read this", "", "A higher number of shown statements or a higher number coverage is not a better brief. Withheld and rejected counts show how much a model said that the passages did not support; they are not errors of the guard unless a person reads the withheld text and finds it faithful (use the F1 review kit for that). Tokens, latency and throughput are what the run recorded; where a value says n/a the server did not report it.", "");
  return out.join("\n");
}

module.exports = { numberCoverage, summarisePipeline, summariseDirect, pilotReportMarkdown, throughput };
