"use strict";
/**
 * Stage E of the native engine: evidence mapping and validation, using the EXISTING shoRDs claim guard (llm/claimGuard.js) unchanged.
 *
 * Every statement of the draft brief is checked against the chunks it cites:
 *   - numbers: every number must appear in the cited text (whole-number match),
 *   - direction and negation: a statement that reverses the cited sentence is withheld,
 *   - strength: an overclaim ("proves", "always", "state-of-the-art" ...) that the evidence does not use is withheld,
 *   - dropped hedge / dropped scope limit: kept, but flagged with a qualifier,
 *   - attribution: a statement whose source is earlier cited work is never presented as the paper's own result.
 * A statement that passes is labelled SUPPORTED_BY_AUTOMATIC_CHECK, never "verified" or "proven": the checks are lexical and numeric and
 * cannot establish that a statement is correct. A statement that fails is withheld (not shown) and listed with its reason code.
 *
 * Second gate: the finished brief is also mapped to the production intelligence shape and run through the production
 * `validateIntelligence`, so that anything the native engine shows would also have been accepted by the production validator.
 */
const { checkStatement, buildEvidenceIndex, STRONG } = require("../llm/claimGuard");
const { SECTIONS } = require("./brief");

const CHECK_NOTE = "Automatic consistency checks (numbers, direction, negation, strength, scope, attribution). They are not proof that a statement is correct; read the cited passages.";

function validateDraft({ draft, chunks, tableUncertain = false }) {
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));
  const index = buildEvidenceIndex(chunks);
  const sections = {};
  const withheld = [];
  const stats = { checked: 0, supported: 0, withheld: 0, qualifiers: 0 };
  for (const s of SECTIONS) {
    const kept = [];
    for (const st of draft[s.key] || []) {
      stats.checked += 1;
      const citedIds = [...new Set(st.citations.map((c) => c.chunkId))];
      const g = checkStatement({ text: st.text, citedIds, chunksById: byId, index });
      const citedText = citedIds.map((id) => (byId.get(id) || {}).text || "").join("\n");
      let reason = null, detail = null;
      if (!g.ok) { reason = g.reason; detail = g.detail || null; }
      else if (STRONG && STRONG.test(st.text) && !STRONG.test(citedText)) reason = "UNSUPPORTED_CONCLUSION";
      else if (st.attribution === "CITED_PRIOR_WORK" && ["majorFindings", "quantitativeResults", "keyContributions", "inBrief"].includes(s.key)) reason = "CITED_PRIOR_WORK_NOT_THIS_PAPERS_RESULT";
      if (reason) {
        stats.withheld += 1;
        withheld.push({ section: s.key, reason, detail, claimIds: st.claimIds, textPreview: st.text.slice(0, 120) });
        continue;
      }
      const quals = g.qualifiers.slice();
      if (tableUncertain && citedIds.some((id) => (byId.get(id) || {}).sourceType === "TABLE")) quals.push("TABLE_STRUCTURE_UNCERTAIN"); // the extractor could not recover the table's columns
      stats.supported += 1;
      stats.qualifiers += quals.length;
      kept.push({
        text: st.text, claimIds: st.claimIds, attribution: st.attribution,
        check: "SUPPORTED_BY_AUTOMATIC_CHECK",
        ...(quals.length ? { qualifiers: quals } : {}),
        evidence: st.citations.map((c) => ({ chunkId: c.chunkId, quote: c.quote })),
        evidenceSpans: g.spans
      });
    }
    sections[s.key] = kept;
  }
  return { sections, withheld, stats, note: CHECK_NOTE };
}

/** Map a validated native brief to the production intelligence shape (llm/intelligence.js) so the production validator can judge it too. */
function toIntelligenceShape(sections) {
  const item = (st) => ({ text: st.text.slice(0, 600), evidence: [...new Set(st.evidence.map((e) => e.chunkId))].slice(0, 6), basis: "STATED" });
  const first = (k) => (sections[k] && sections[k][0] ? item(sections[k][0]) : null);
  const list = (k) => (sections[k] || []).map(item);
  const quant = (sections.quantitativeResults || []).map((st) => {
    const m = st.text.match(/[-+−]?\d[\d,]*\.?\d*\s?(?:%|percent|points?|seconds?|ms|x|×)?/);
    return m ? { metric: st.text.slice(0, 80), value: m[0].trim(), context: st.text.slice(0, 300), evidence: [...new Set(st.evidence.map((e) => e.chunkId))].slice(0, 6) } : null;
  }).filter(Boolean);
  return {
    tldr: first("inBrief"), researchProblem: first("researchProblem"), motivation: first("whyItMatters"), methodology: first("proposedMethod"),
    architecture: null, dataset: null, experimentalSetup: null, findings: first("majorFindings"), novelty: null, whyItMatters: first("whyItMatters"),
    practicalImplications: null, futureWork: first("futureDirections"),
    contributions: list("keyContributions"), techniques: [], strengths: [], limitations: list("limitations"), assumptions: [],
    quantitativeResults: quant, keywords: []
  };
}

/** Run the production validator over the mapped brief. `kept` here counts statements the production gate also accepts. */
function productionGate({ sections, chunks }) {
  const { validateIntelligence } = require("../llm/intelligence"); // lazy: loads the production module only when this gate runs
  const shaped = toIntelligenceShape(sections);
  const r = validateIntelligence(shaped, chunks);
  return { accepted: r.kept !== undefined ? r.kept : null, dropped: r.dropped !== undefined ? r.dropped : null, reasons: r.reasons || {}, validatorVersion: "llm/intelligence.validateIntelligence" };
}

module.exports = { validateDraft, toIntelligenceShape, productionGate, CHECK_NOTE };
