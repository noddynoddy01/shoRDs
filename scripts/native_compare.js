#!/usr/bin/env node
"use strict";
/**
 * Three-system evaluation driver (Phase 5C). Local files only; no network; no model call except the free stub in `demo`.
 *
 *   node scripts/native_compare.js demo  --out DIR                       # machinery check on the FICTIONAL fixture paper; output is labelled SYNTHETIC
 *   node scripts/native_compare.js assemble --captures DIR --claude backend_analyses.json --out items.json [--model stub|http://127.0.0.1:PORT/v1 --model-name NAME]
 *                                                                        # runs B and C on the EXACT excerpts Claude saw (capture files), adds A from the Claude analyses
 *   node scripts/native_compare.js plan  --items items.json --out DIR    # blinded rating sheets for real papers
 *   node scripts/native_compare.js score --key DIR/key.json --ratings a.csv,b.csv [--out report.json]
 *
 * items.json = [{paperId,title,link,license,systems:{A_claude_baseline?:{sections,passages}, B_open_weight_direct?:{...}, C_native_pipeline?:{...}}}]
 * (sections: { inBrief:[{text,evidence:[chunkId]}], ... } as produced by eval/nativeCompare.js helpers.) The baseline A comes from the Phase 4 raw-capture
 * files of the real Claude run (docs/ops/BENCHMARK_PREPARATION_2026-11-04.md); this script never calls Claude.
 */
const fs = require("fs");
const path = require("path");
const C = require("../backend/eval/nativeCompare");
const sb = require("../backend/eval/summaryBenchmark");

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

async function demo(out) {
  const F = require("../backend/tests/node/paperFixtures");
  const { extractJats } = require("../backend/papers/extract");
  const { createStubAdapter } = require("../backend/native/modelAdapter");
  const { runNativePipeline } = require("../backend/native/pipeline");
  const { runDirect } = require("../backend/native/directBaseline");
  const { fromStructured } = require("../backend/native/documentIntelligence");
  const input = { paperId: "pap_fixture", ...extractJats(F.jats()) };
  const stub = createStubAdapter();
  const t0 = Date.now();
  const c = await runNativePipeline({ model: stub, input, fullTextAllowed: true });
  const cMs = Date.now() - t0;
  const doc = fromStructured(input);
  const t1 = Date.now();
  const b = await runDirect({ model: stub, chunks: doc.chunks, coverage: "FULL_TEXT" });
  const bMs = Date.now() - t1;
  const passages = Object.fromEntries(doc.chunks.map((x) => [x.chunkId, x.text]));
  const secC = C.sectionsFromValidated(Object.fromEntries(c.brief.map((s) => [s.key, s.statements])));
  const secB = C.sectionsFromValidated(b.validation.sections);
  const items = [{ paperId: "doi:10.9999/fixture.sparse.2021", title: F.TITLE, link: "", license: "cc-by", systems: { B_open_weight_direct: { sections: secB, passages }, C_native_pipeline: { sections: secC, passages } } }];
  const plan = C.buildComparisonPlan(items, { raters: ["rater_a", "rater_b"], seed: 1, kind: "SYNTHETIC_NOT_EVIDENCE" });
  fs.mkdirSync(out, { recursive: true });
  for (const [r, csv] of Object.entries(plan.sheets)) fs.writeFileSync(path.join(out, `sheet_${r}.csv`), csv);
  fs.writeFileSync(path.join(out, "key.json"), JSON.stringify(plan.key, null, 2));
  const report = {
    label: "SYNTHETIC MACHINERY CHECK on a fictional paper with the free stub (not a language model). NOT evidence about any model.",
    systemsRun: ["B_open_weight_direct", "C_native_pipeline"], systemsNotRun: { A_claude_baseline: "NOT RUN: needs the real Claude run (owner-approved spend) of the Phase 4 benchmark" },
    automatic: { B_open_weight_direct: C.automaticMetrics(secB, doc.chunks), C_native_pipeline: C.automaticMetrics(secC, doc.chunks) },
    operational: C.operationalSummary([{ system: "B_open_weight_direct", totalMs: bMs, costUsd: 0, tokens: { input: 0, output: 0 } }, { system: "C_native_pipeline", totalMs: cMs, costUsd: c.diagnostics.costUsd, tokens: c.diagnostics.tokens }]),
    units: plan.unitCount
  };
  fs.writeFileSync(path.join(out, "demo_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function assemble(capDir, claudeFile, out) {
  const { createStubAdapter, createOpenAiCompatibleAdapter } = require("../backend/native/modelAdapter");
  const { runNativePipeline } = require("../backend/native/pipeline");
  const { runDirect } = require("../backend/native/directBaseline");
  const { fromChunks } = require("../backend/native/documentIntelligence");
  const m = arg("model", "stub");
  if (m !== "stub" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(m)) { console.error("refused: only a local model server is allowed here; paid inference needs an approval."); process.exit(2); }
  const model = m === "stub" ? createStubAdapter() : createOpenAiCompatibleAdapter({ baseUrl: m, model: arg("model-name", "local") });
  const claude = claudeFile ? JSON.parse(fs.readFileSync(claudeFile, "utf8")) : {};
  const items = [], runs = [], auto = {};
  for (const f of fs.readdirSync(capDir).filter((x) => x.endsWith(".json"))) {
    const cap = JSON.parse(fs.readFileSync(path.join(capDir, f), "utf8"));
    if (!cap.textKept || !Array.isArray(cap.chunks)) continue; // licence did not allow keeping the text: the paper is not used
    const id = cap.paper.paperId;
    const chunks = fromChunks(id, cap.chunks).chunks;
    const passages = Object.fromEntries(chunks.map((c) => [c.chunkId, c.text]));
    const systems = {};
    const a = claude[id] && claude[id].intelligence;
    if (a) { systems.A_claude_baseline = { sections: C.sectionsFromIntelligence(a), passages }; auto[`${id}|A`] = C.automaticMetrics(systems.A_claude_baseline.sections, chunks); }
    const t1 = Date.now();
    const d = await runDirect({ model, chunks, coverage: "FULL_TEXT" });
    runs.push({ system: "B_open_weight_direct", paperId: id, totalMs: Date.now() - t1, costUsd: d.call && typeof d.call.costUsd === "number" ? d.call.costUsd : null, tokens: { input: (d.call && d.call.usage && d.call.usage.inputTokens) || 0, output: (d.call && d.call.usage && d.call.usage.outputTokens) || 0 }, failed: !d.ok });
    if (d.ok) { systems.B_open_weight_direct = { sections: C.sectionsFromValidated(d.validation.sections), passages }; auto[`${id}|B`] = { ...C.automaticMetrics(systems.B_open_weight_direct.sections, chunks), withheldByGuard: d.validation.stats.withheld }; }
    const t2 = Date.now();
    const c = await runNativePipeline({ model, input: { paperId: id, title: cap.paper.title, chunks: cap.chunks }, fullTextAllowed: true });
    runs.push({ system: "C_native_pipeline", paperId: id, totalMs: Date.now() - t2, costUsd: c.diagnostics.costUsd, tokens: c.diagnostics.tokens, failed: c.diagnostics.failedCalls > 0 });
    systems.C_native_pipeline = { sections: C.sectionsFromValidated(Object.fromEntries(c.brief.map((s) => [s.key, s.statements]))), passages };
    auto[`${id}|C`] = { ...C.automaticMetrics(systems.C_native_pipeline.sections, chunks), withheldByGuard: c.validation.withheld.length };
    items.push({ paperId: id, title: cap.paper.title || id, link: cap.paper.sourceUrl || "", license: cap.paper.license, systems });
  }
  fs.writeFileSync(out, JSON.stringify(items, null, 2));
  fs.writeFileSync(out.replace(/\.json$/, "") + ".operational.json", JSON.stringify({ perRun: runs, summary: C.operationalSummary(runs), automatic: auto }, null, 2));
  console.log(`papers: ${items.length}; written ${out} (+ .operational.json). Systems per paper: ${items.map((i) => Object.keys(i.systems).length).join(",") || "none"}`);
}

function plan(itemsFile, out) {
  const items = JSON.parse(fs.readFileSync(itemsFile, "utf8"));
  const p = C.buildComparisonPlan(items, { raters: (arg("raters", "rater_a,rater_b")).split(","), seed: Number(arg("seed", 1)), kind: "HUMAN_RATED_STUDY" });
  fs.mkdirSync(out, { recursive: true });
  for (const [r, csv] of Object.entries(p.sheets)) fs.writeFileSync(path.join(out, `sheet_${r}.csv`), csv);
  fs.writeFileSync(path.join(out, "key.json"), JSON.stringify(p.key, null, 2));
  console.log(`units: ${p.unitCount}; systems present: ${p.systemsPresent.join(", ")}; sheets and key written to ${out}. Keep key.json away from the raters.`);
}

function score(keyFile, ratingFiles, outFile) {
  const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const byRater = {};
  ratingFiles.split(",").forEach((f, i) => { byRater[path.basename(f, ".csv").replace(/^sheet_/, "") || `rater_${i}`] = sb.parseCsv(fs.readFileSync(f, "utf8")); });
  const res = C.analyseComparison(key, byRater, { seed: 1 });
  const text = JSON.stringify(res, null, 2);
  if (outFile) fs.writeFileSync(outFile, text);
  console.log(text);
}

const cmd = process.argv[2];
if (cmd === "demo") demo(arg("out", "native_compare_demo")).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "assemble") assemble(arg("captures"), arg("claude"), arg("out", "items.json")).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "plan") plan(arg("items"), arg("out", "native_compare_plan"));
else if (cmd === "score") score(arg("key"), arg("ratings"), arg("out"));
else { console.error("usage: native_compare.js demo|assemble|plan|score (see the header of this file)"); process.exit(2); }
