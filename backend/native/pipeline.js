"use strict";
/**
 * The native research-intelligence pipeline (Phase 5B prototype): Stage A -> B -> C -> D -> E.
 *
 *   A documentIntelligence  text -> sections, chunks with provenance, quality report
 *   B structuredExtraction  chunks -> 12 fields of cited, quote-anchored claims (no summary yet)
 *   C hierarchical          section summaries -> claims -> method/result links -> paper-level representation
 *   D brief                 representation -> 9-section brief (missing information is "unavailable")
 *   E validation            existing claim guard on every statement + production validator as a second gate
 *
 * NOT wired into the production analysis path: nothing in llm/, app.js or runtime.js requires this module. It is run by
 * scripts/native_run_local.js and by tests. The licence gate is respected here too: full text is processed only when the caller states
 * `fullTextAllowed:true` (production decides that with papers/licensePolicy.js); otherwise the paper is treated as abstract-only.
 *
 * The result never contains raw model text. `options.onRaw` (used only by the local evaluation harness) receives it instead.
 */
const { fromPlainText, fromStructured, fromChunks } = require("./documentIntelligence");
const { extractAll } = require("./structuredExtraction");
const { summariseSections, buildRepresentation } = require("./hierarchical");
const { generateBrief, SECTIONS, REASON_TEXT } = require("./brief");
const { validateDraft, productionGate } = require("./validation");
const { PROMPT_VERSION } = require("./prompts");

const PIPELINE_VERSION = "native-pipeline-0.1";

const sum = (a) => a.reduce((n, x) => n + x, 0);

async function runNativePipeline({ model, input, fullTextAllowed = false, options = {} }) {
  if (!model || typeof model.callMessages !== "function") throw new Error("a model adapter is required");
  const concurrency = options.concurrency || 1;
  const onRaw = typeof options.onRaw === "function" ? options.onRaw : null;
  const timing = {};
  const t = (name, t0) => { timing[name] = Date.now() - t0; };

  // ---- A
  let t0 = Date.now();
  const doc = input.chunks !== undefined
    ? fromChunks(input.paperId, input.chunks, { title: input.title })
    : input.plainText !== undefined
      ? fromPlainText(input.plainText, { paperId: input.paperId, title: input.title })
      : fromStructured(input, { abstractOnly: !fullTextAllowed });
  const hadBody = input.plainText !== undefined || input.chunks !== undefined ? doc.quality.coverage === "FULL_TEXT" : Boolean((input.sections && input.sections.length) || (input.tables && input.tables.length));
  const licenceDowngrade = !fullTextAllowed && hadBody; // the paper has a body, but the caller did not confirm that the licence allows processing it
  const effective = licenceDowngrade || doc.quality.coverage === "ABSTRACT_ONLY" ? "ABSTRACT_ONLY" : "FULL_TEXT";
  t("A", t0);

  // ---- B
  t0 = Date.now();
  const b = await extractAll({ model, chunks: doc.chunks, coverage: effective, concurrency, onRaw });
  t("B", t0);

  // ---- C
  t0 = Date.now();
  const c = await summariseSections({ model, chunks: doc.chunks, coverage: effective, concurrency, onRaw });
  const representation = buildRepresentation({ fields: b.fields, sections: c.sections, title: doc.doc.title, coverage: effective });
  t("C", t0);

  // ---- D
  t0 = Date.now();
  const d = await generateBrief({ model, representation, onRaw });
  t("D", t0);

  // ---- E
  t0 = Date.now();
  const scoped = effective === "ABSTRACT_ONLY" ? doc.chunks.filter((x) => x.section === "ABSTRACT") : doc.chunks;
  const v = validateDraft({ draft: d.draft, chunks: scoped, tableUncertain: doc.quality.flags.some((f) => f.code === "TABLE_STRUCTURE_LOST") });
  const gate = options.productionGate === false ? null : productionGate({ sections: v.sections, chunks: scoped });
  t("E", t0);

  const withheldBySection = {};
  for (const w of v.withheld) withheldBySection[w.section] = (withheldBySection[w.section] || 0) + 1;
  const brief = SECTIONS.map((s) => {
    const statements = v.sections[s.key] || [];
    if (statements.length) return { key: s.key, label: s.label, status: "AVAILABLE", statements };
    const reason = d.unavailable[s.key] || (withheldBySection[s.key] ? "NO_SUPPORTED_STATEMENT" : "NOT_STATED");
    return { key: s.key, label: s.label, status: "UNAVAILABLE", reason, text: REASON_TEXT[reason] || REASON_TEXT.NOT_STATED, statements: [] };
  });

  const calls = [...b.calls, ...c.calls, ...(d.call ? [d.call] : [])];
  const known = calls.filter((x) => typeof x.costUsd === "number");
  return {
    status: "NATIVE_PROTOTYPE", // never VERIFIED: the checks below are automatic and lexical
    provenance: {
      pipelineVersion: PIPELINE_VERSION, promptVersion: PROMPT_VERSION, contentHash: doc.contentHash,
      models: [...new Set(calls.map((x) => x.model).filter(Boolean))], providers: [...new Set(calls.map((x) => x.provider).filter(Boolean))],
      coverageRequested: hadBody ? "FULL_TEXT" : "ABSTRACT_ONLY", coverageUsed: effective, licenceDowngrade
    },
    document: { title: doc.doc.title, quality: doc.quality, chunkCount: doc.chunks.length },
    brief,
    representation: {
      claimCount: representation.claims.length, claims: representation.claims, methodResultLinks: representation.methodResultLinks,
      unlinkedResults: representation.unlinkedResults, possibleContradictions: representation.possibleContradictions, sectionSummaries: representation.sectionSummaries
    },
    validation: { ...v.stats, withheld: v.withheld, note: v.note, productionGate: gate },
    diagnostics: {
      stageMs: timing, totalMs: sum(Object.values(timing)),
      modelCalls: calls.length, failedCalls: calls.filter((x) => x.ok === false).length,
      tokens: { input: sum(calls.map((x) => (x.usage && x.usage.inputTokens) || 0)), output: sum(calls.map((x) => (x.usage && x.usage.outputTokens) || 0)), unmeasuredCalls: calls.filter((x) => !x.usage).length },
      costUsd: known.length ? Math.round(sum(known.map((x) => x.costUsd)) * 1e6) / 1e6 : null, costUnmeasuredCalls: calls.length - known.length,
      skippedFields: b.skipped, extractionDrops: Object.fromEntries(Object.entries(b.fields).map(([k, v2]) => [k, v2.dropped])), perCall: calls.map(({ usage, ...rest }) => ({ ...rest, tokens: usage || null }))
    }
  };
}

/** Plain-text rendering for the local CLI. Statements are followed by their source passages; nothing is rendered without one. */
function renderText(result) {
  const out = [`${result.document.title || "(untitled)"}`, `[${result.status}] coverage: ${result.provenance.coverageUsed} | models: ${result.provenance.models.join(", ") || "n/a"}`, ""];
  for (const s of result.brief) {
    out.push(`## ${s.label}`);
    if (s.status === "UNAVAILABLE") out.push(s.text);
    else for (const st of s.statements) {
      out.push(`- ${st.text}${st.qualifiers ? `  (note: ${st.qualifiers.join(", ")})` : ""}`);
      for (const e of st.evidence.slice(0, 2)) out.push(`    source ${e.chunkId}: "${e.quote.slice(0, 160)}"`);
    }
    out.push("");
  }
  out.push(result.validation.note);
  return out.join("\n");
}

module.exports = { runNativePipeline, renderText, PIPELINE_VERSION };
