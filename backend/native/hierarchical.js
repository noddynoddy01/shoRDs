"use strict";
/**
 * Stage C of the native engine: hierarchical summarisation into a paper-level representation.
 *
 *   1. section summaries + section claims (long sections are summarised in groups, then merged: a two-level tree, "hierarchical merging",
 *      not a left-to-right running summary),
 *   2. the claims of Stage B and of the sections are merged into ONE list of claims with ids, de-duplicated, each keeping its citations,
 *   3. methodology <-> result links are built from shared terms (so a result is never shown without the method that produced it),
 *   4. pairs of claims that point in opposite directions are flagged as POSSIBLE contradictions (a flag for a person, not a verdict).
 * The brief (Stage D) is written from this representation only, never from concatenated chunk summaries.
 */
const { buildSectionPrompt } = require("./prompts");
const { invoke } = require("./modelAdapter");
const { anchorItems, classifyAttribution, extractJson, mapLimit, FIELD_SPECS } = require("./structuredExtraction");
const { contentTokens, directionConflict, NEGATION } = require("../llm/claimGuard");

const GROUP_CHARS = 8000;
const MAX_SECTION_CLAIMS = 4;
const SKIP_SECTIONS = new Set(["REFERENCES", "OTHER"]);

function groupChunks(list) {
  const groups = [];
  let cur = [], n = 0;
  for (const c of list) {
    if (cur.length && n + c.text.length > GROUP_CHARS) { groups.push(cur); cur = []; n = 0; }
    cur.push(c); n += c.text.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

async function callSection({ model, section, chunks, realChunks, level, onRaw, maxTokens, calls }) {
  const { system, user } = buildSectionPrompt({ section, chunks, level, maxClaims: MAX_SECTION_CLAIMS });
  let r;
  try { r = await invoke(model, { system, user, maxTokens, timeoutMs: 120000, task: `section:${section}:${level}` }); }
  catch (err) { calls.push({ stage: "C", section, level, ok: false, category: (err && err.category) || "UNKNOWN" }); return null; }
  if (onRaw) onRaw({ stage: "C", section, level, chunkIds: chunks.map((c) => c.chunkId), text: r.text });
  const parsed = extractJson(r.text);
  const meta = { stage: "C", section, level, usage: r.usage || null, latencyMs: r.latencyMs, serverTimings: r.serverTimings || null, truncated: Boolean(r.truncated), costUsd: r.costUsd, costStatus: r.costStatus, model: r.model, provider: r.provider };
  if (!parsed || r.truncated) { calls.push({ ...meta, ok: false, category: r.truncated ? "TRUNCATED" : "UNPARSEABLE" }); return null; }
  const s = anchorItems(parsed.summary, realChunks, 3);
  const c = anchorItems(parsed.claims, realChunks, MAX_SECTION_CLAIMS);
  calls.push({ ...meta, ok: true, summaryKept: s.kept.length, claimsKept: c.kept.length, dropped: { summary: s.dropped, claims: c.dropped } });
  return { summary: s.kept, claims: c.kept };
}

/** @returns {Promise<{sections:Array, calls:Array}>} */
async function summariseSections({ model, chunks, coverage, concurrency = 1, onRaw = null, maxTokens = 1600 }) {
  const calls = [];
  const bySection = new Map();
  for (const c of chunks) {
    if (SKIP_SECTIONS.has(c.section)) continue;
    if (coverage === "ABSTRACT_ONLY" && c.section !== "ABSTRACT") continue;
    if (!bySection.has(c.section)) bySection.set(c.section, []);
    bySection.get(c.section).push(c);
  }
  const entries = [...bySection];
  const out = await mapLimit(entries, concurrency, async ([section, list]) => {
    const groups = groupChunks(list);
    if (groups.length === 1) {
      const r = await callSection({ model, section, chunks: groups[0], realChunks: list, level: "leaf", onRaw, maxTokens, calls });
      return { section, chunkIds: list.map((c) => c.chunkId), groups: 1, ...(r || { summary: [], claims: [], failed: true }) };
    }
    const partials = [];
    for (const g of groups) { const r = await callSection({ model, section, chunks: g, realChunks: list, level: "leaf", onRaw, maxTokens, calls }); if (r) partials.push(r); }
    // merge: the partial summaries are re-presented as excerpts whose text is the QUOTED source span, so provenance stays real
    const quoteChunks = partials.flatMap((p) => p.summary.concat(p.claims)).flatMap((it) => it.citations.map((c) => ({ chunkId: c.chunkId, section, text: c.quote })));
    if (!quoteChunks.length) return { section, chunkIds: list.map((c) => c.chunkId), groups: groups.length, summary: [], claims: [], failed: true };
    const merged = await callSection({ model, section, chunks: quoteChunks, realChunks: list, level: "merge", onRaw, maxTokens, calls });
    const claims = merged ? merged.claims : partials.flatMap((p) => p.claims).slice(0, MAX_SECTION_CLAIMS);
    return { section, chunkIds: list.map((c) => c.chunkId), groups: groups.length, summary: merged ? merged.summary : partials.flatMap((p) => p.summary).slice(0, 3), claims, mergeFailed: !merged };
  });
  return { sections: out, calls };
}

// ---------------------------------------------------------------------------------------------------- representation

const jacc = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i += 1; return i / (a.size + b.size - i); };

function buildRepresentation({ fields, sections, title, coverage }) {
  const claims = [];
  const push = (c) => {
    const tokens = new Set(contentTokens(c.text));
    const dup = claims.find((x) => x.tokens && jacc(x.tokens, tokens) >= 0.85);
    if (dup) { if (!dup.fields.includes(c.field)) dup.fields.push(c.field); return; } // same statement under two fields: one claim that belongs to both
    claims.push({ ...c, fields: [c.field], tokens });
  };
  for (const spec of FIELD_SPECS) for (const it of (fields[spec.field] || { items: [] }).items) push({ field: spec.field, text: it.text, citations: it.citations, section: it.section, attribution: it.attribution, origin: "B" });
  for (const s of sections) for (const it of s.claims) push({ field: "sectionClaim", text: it.text, citations: it.citations, section: s.section, attribution: classifyAttribution(`${it.text} ${it.citations[0].quote}`, s.section), origin: "C" });
  claims.forEach((c, i) => { c.id = `c${i + 1}`; });

  const isMethod = (c) => c.fields.some((f) => ["methodology", "experimentalSetup", "dataset", "baselines", "assumptions"].includes(f));
  const isResult = (c) => c.fields.includes("quantitativeFindings") || (c.field === "sectionClaim" && c.section === "RESULTS");
  const methods = claims.filter(isMethod);
  const salient = (c) => new Set([...(c.text.match(/\b[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*\b/g) || []), ...contentTokens(c.text)].map((x) => x.toLowerCase()));
  const links = [];
  const unlinkedResults = [];
  for (const r of claims.filter(isResult)) {
    const rt = salient(r);
    const hits = methods.map((m) => ({ m, shared: [...salient(m)].filter((t) => rt.has(t) && t.length > 2) })).filter((h) => h.shared.length >= 2);
    if (hits.length) links.push({ resultId: r.id, methodIds: hits.map((h) => h.m.id).slice(0, 4), sharedTerms: [...new Set(hits.flatMap((h) => h.shared))].slice(0, 8) });
    else unlinkedResults.push(r.id);
  }

  const contradictions = [];
  for (let i = 0; i < claims.length; i += 1) for (let j = i + 1; j < claims.length; j += 1) {
    const a = claims[i], b = claims[j];
    if (jacc(a.tokens, b.tokens) < 0.4) continue;
    if (directionConflict(a.text, b.text)) contradictions.push({ a: a.id, b: b.id, kind: "DIRECTION", status: "POSSIBLE_CONTRADICTION_FOR_REVIEW" });
    else if (NEGATION.test(a.text) !== NEGATION.test(b.text)) contradictions.push({ a: a.id, b: b.id, kind: "NEGATION", status: "POSSIBLE_CONTRADICTION_FOR_REVIEW" });
  }
  return {
    title, coverage,
    claims: claims.map(({ tokens, ...c }) => c),
    sectionSummaries: sections.map((s) => ({ section: s.section, groups: s.groups, summary: s.summary, failed: Boolean(s.failed), mergeFailed: Boolean(s.mergeFailed) })),
    methodResultLinks: links, unlinkedResults, possibleContradictions: contradictions
  };
}

module.exports = { summariseSections, buildRepresentation, groupChunks, GROUP_CHARS };
