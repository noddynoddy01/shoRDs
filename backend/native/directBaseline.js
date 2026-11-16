"use strict";
/**
 * Comparison system B: the open-weight model asked for the whole brief in ONE prompt (no extraction, no hierarchy, no representation).
 * It exists so the evaluation can separate "the model" from "the pipeline": system C (the multi-stage pipeline) must beat or match B on
 * human-rated quality to justify its extra calls. Output is passed through the SAME Stage E validation as system C, so the guard is
 * applied identically; the number of statements the guard withheld is reported separately.
 */
const { buildDirectPrompt } = require("./prompts");
const { invoke } = require("./modelAdapter");
const { anchorItems, extractJson, candidatesFor } = require("./structuredExtraction");
const { SECTIONS } = require("./brief");
const { validateDraft } = require("./validation");

const MAX_CHARS = 60000;

async function runDirect({ model, chunks, coverage, onRaw = null, maxTokens = 3000 }) {
  const usable = (coverage === "ABSTRACT_ONLY" ? chunks.filter((c) => c.section === "ABSTRACT") : chunks.filter((c) => c.section !== "REFERENCES"));
  const given = [];
  let n = 0;
  for (const c of usable) { if (n + c.text.length > MAX_CHARS) break; given.push(c); n += c.text.length; } // a single prompt must fit the model: later text is cut (reported)
  const cut = usable.length - given.length;
  const { system, user } = buildDirectPrompt({ chunks: given, sections: SECTIONS.map((s) => s.key) });
  const t0 = Date.now();
  let r;
  try { r = await invoke(model, { system, user, maxTokens, timeoutMs: 180000, task: "direct_brief" }); }
  catch (err) { return { ok: false, category: (err && err.category) || "UNKNOWN", validation: null, call: { stage: "direct", ok: false } }; }
  if (onRaw) onRaw({ stage: "direct", text: r.text });
  const parsed = extractJson(r.text);
  const call = { stage: "direct", ok: Boolean(parsed), usage: r.usage || null, latencyMs: r.latencyMs, serverTimings: r.serverTimings || null, truncated: Boolean(r.truncated), costUsd: r.costUsd, costStatus: r.costStatus, model: r.model, provider: r.provider };
  if (!parsed || r.truncated || !parsed.sections) return { ok: false, category: r.truncated ? "TRUNCATED" : "UNPARSEABLE", validation: null, call, chunksCut: cut };
  const draft = {};
  const dropped = {};
  for (const s of SECTIONS) {
    const a = anchorItems((parsed.sections[s.key] || []).map((x) => ({ text: x && x.text, citations: x && x.citations })), given, s.max);
    for (const [k, v] of Object.entries(a.dropped)) dropped[k] = (dropped[k] || 0) + v;
    draft[s.key] = a.kept.map((k) => ({ text: k.text, claimIds: [], citations: k.citations, attribution: "UNSPECIFIED" }));
  }
  const validation = validateDraft({ draft, chunks: given });
  return { ok: true, validation, anchoringDrops: dropped, call, chunksCut: cut, wallMs: Date.now() - t0 };
}

module.exports = { runDirect };
