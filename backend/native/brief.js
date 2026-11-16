"use strict";
/**
 * Stage D of the native engine: the research brief, written from the paper-level representation only.
 *
 * Output sections (fixed order): In Brief, Research Problem, Why This Research Matters, Proposed Method, Key Contributions,
 * Major Findings, Quantitative Results, Limitations, Future Research Directions.
 * "Why this research matters" reports the motivation the AUTHORS state (gap / objective); the engine adds no opinion of its own.
 * A section with no supported statement is UNAVAILABLE with a reason code; it is never filled from general knowledge.
 */
const { buildBriefPrompt } = require("./prompts");
const { invoke } = require("./modelAdapter");
const { extractJson } = require("./structuredExtraction");

const SECTIONS = [
  { key: "inBrief", label: "In Brief", max: 3 },
  { key: "researchProblem", label: "Research Problem", max: 3 },
  { key: "whyItMatters", label: "Why This Research Matters", max: 3 },
  { key: "proposedMethod", label: "Proposed Method", max: 4 },
  { key: "keyContributions", label: "Key Contributions", max: 5 },
  { key: "majorFindings", label: "Major Findings", max: 4 },
  { key: "quantitativeResults", label: "Quantitative Results", max: 6 },
  { key: "limitations", label: "Limitations", max: 5 },
  { key: "futureDirections", label: "Future Research Directions", max: 3 }
];

const NEEDS = {
  inBrief: ["objective", "researchProblem", "methodology", "quantitativeFindings"],
  researchProblem: ["researchProblem"], whyItMatters: ["researchGap", "objective"], proposedMethod: ["methodology"],
  keyContributions: ["contributions"], majorFindings: ["quantitativeFindings"], quantitativeResults: ["quantitativeFindings"],
  limitations: ["limitations"], futureDirections: ["futureWork"]
};

const UNAVAILABLE_TEXT = "Unavailable: the extracted text of this paper does not state this.";
const REASON_TEXT = {
  ABSTRACT_ONLY: "Unavailable: only the abstract was available for this paper.",
  NOT_STATED: UNAVAILABLE_TEXT,
  NO_SUPPORTED_STATEMENT: "Unavailable: no statement for this section passed the automatic evidence checks.",
  MODEL_FAILED: "Unavailable: the model did not return a usable answer for this section."
};

/** Which sections have at least one claim to rest on; the others are reported as unavailable before the model is asked. */
function plan(representation) {
  const have = new Set(representation.claims.flatMap((c) => c.fields));
  const wanted = [], unavailable = {};
  for (const s of SECTIONS) {
    if (NEEDS[s.key].some((f) => have.has(f))) wanted.push(s.key);
    else unavailable[s.key] = representation.coverage === "ABSTRACT_ONLY" ? "ABSTRACT_ONLY" : "NOT_STATED";
  }
  return { wanted, unavailable };
}

/**
 * @returns {Promise<{draft:Object, unavailable:Object, call:Object|null}>}
 *   draft[key] = [{ text, claimIds, citations }]  (citations are the union of the claims' citations; nothing the model invents survives)
 */
async function generateBrief({ model, representation, onRaw = null, maxTokens = 2000 }) {
  const { wanted, unavailable } = plan(representation);
  const draft = {};
  if (!wanted.length) return { draft, unavailable, call: null };
  const claimsById = new Map(representation.claims.map((c) => [c.id, c]));
  const { system, user } = buildBriefPrompt({ claims: representation.claims, sections: wanted, unavailable: Object.keys(unavailable) });
  let r;
  try { r = await invoke(model, { system, user, maxTokens, timeoutMs: 180000, task: "write_brief" }); }
  catch (err) {
    for (const k of wanted) unavailable[k] = "MODEL_FAILED";
    return { draft, unavailable, call: { stage: "D", ok: false, category: (err && err.category) || "UNKNOWN" } };
  }
  if (onRaw) onRaw({ stage: "D", text: r.text });
  const parsed = extractJson(r.text);
  const call = { stage: "D", ok: Boolean(parsed), usage: r.usage || null, latencyMs: r.latencyMs, serverTimings: r.serverTimings || null, truncated: Boolean(r.truncated), costUsd: r.costUsd, costStatus: r.costStatus, model: r.model, provider: r.provider };
  if (!parsed || r.truncated || !parsed.sections || typeof parsed.sections !== "object") {
    for (const k of wanted) unavailable[k] = "MODEL_FAILED";
    return { draft, unavailable, call: { ...call, ok: false, category: r.truncated ? "TRUNCATED" : "UNPARSEABLE" } };
  }
  let dropped = 0;
  for (const s of SECTIONS) {
    if (!wanted.includes(s.key)) continue;
    const out = [];
    for (const st of Array.isArray(parsed.sections[s.key]) ? parsed.sections[s.key] : []) {
      if (out.length >= s.max) break;
      if (!st || typeof st.text !== "string" || !st.text.trim() || !Array.isArray(st.claimIds)) { dropped += 1; continue; }
      const ids = [...new Set(st.claimIds.filter((id) => typeof id === "string" && claimsById.has(id)))].slice(0, 4);
      if (!ids.length) { dropped += 1; continue; } // a statement that rests on no known claim is discarded
      const citations = [];
      for (const id of ids) for (const c of claimsById.get(id).citations) if (!citations.some((x) => x.chunkId === c.chunkId && x.quote === c.quote)) citations.push(c);
      const attribution = ids.map((id) => claimsById.get(id).attribution);
      out.push({ text: st.text.trim().slice(0, 500), claimIds: ids, citations, attribution: attribution.every((a) => a === attribution[0]) ? attribution[0] : "MIXED" });
    }
    draft[s.key] = out;
  }
  return { draft, unavailable, call: { ...call, droppedStatements: dropped } };
}

module.exports = { SECTIONS, NEEDS, REASON_TEXT, UNAVAILABLE_TEXT, generateBrief, plan };
