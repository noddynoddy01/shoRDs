"use strict";
/**
 * Stage B of the native engine: structured research extraction. NO summary is written here.
 *
 * For each target field (problem, gap, objective, methodology, dataset, setup, baselines, contributions, quantitative findings,
 * limitations, future work, assumptions) the engine
 *   1. retrieves candidate chunks by section and cue words (a small retrieval step: the model never sees the whole paper for one field),
 *   2. asks the model for items that each carry citations {chunkId, quote},
 *   3. keeps an item ONLY if it cites a chunk that was actually given, and the quote is found verbatim in that chunk.
 * Anything else is dropped and counted by reason. So every kept claim retains its source location by construction; whether the claim
 * is a faithful reading of the quote is judged afterwards by Stage E (claimGuard).
 */
const { buildExtractPrompt } = require("./prompts");
const { invoke } = require("./modelAdapter");

const FIELD_SPECS = [
  { field: "researchProblem", label: "Research problem", sections: ["ABSTRACT", "INTRODUCTION", "BACKGROUND"], instruction: "State the problem the paper says it addresses.", max: 3 },
  { field: "researchGap", label: "Research gap", sections: ["INTRODUCTION", "RELATED_WORK", "BACKGROUND", "ABSTRACT"], instruction: "State what the authors say is missing or insufficient in earlier work.", max: 3 },
  { field: "objective", label: "Research objective", sections: ["INTRODUCTION", "ABSTRACT"], instruction: "State what the authors set out to do or to test.", max: 3 },
  { field: "methodology", label: "Proposed methodology", sections: ["METHODOLOGY", "ABSTRACT", "INTRODUCTION"], instruction: "Describe the method the authors propose or use, with its key parameters as written.", max: 5 },
  { field: "dataset", label: "Dataset", sections: ["DATASET", "EXPERIMENTAL_SETUP", "METHODOLOGY", "INTRODUCTION", "TABLE"], instruction: "Describe the data used for training or evaluation: name, size and source as written.", max: 3 },
  { field: "experimentalSetup", label: "Experimental setup", sections: ["EXPERIMENTAL_SETUP", "METHODOLOGY", "RESULTS"], instruction: "Describe how experiments were run: training settings, hardware, seeds, evaluation protocol, as written.", max: 4 },
  { field: "baselines", label: "Baselines", sections: ["RESULTS", "EXPERIMENTAL_SETUP", "ABSTRACT", "TABLE"], instruction: "List the baselines or comparison conditions the authors compare against.", max: 4 },
  { field: "contributions", label: "Main contributions", sections: ["INTRODUCTION", "ABSTRACT", "CONCLUSION"], instruction: "List the contributions the authors claim.", max: 5 },
  { field: "quantitativeFindings", label: "Quantitative findings", sections: ["RESULTS", "ABSTRACT", "DISCUSSION", "TABLE", "CONCLUSION"], instruction: "List the numerical results, each with its metric, its value and unit exactly as written, and the groups or conditions compared.", max: 8, needDigit: true },
  { field: "limitations", label: "Limitations", sections: ["LIMITATIONS", "DISCUSSION", "CONCLUSION"], instruction: "List limitations the authors state or that the excerpts clearly imply, with their scope.", max: 5 },
  { field: "futureWork", label: "Future work", sections: ["FUTURE_WORK", "CONCLUSION", "DISCUSSION"], instruction: "List future work the authors propose.", max: 3 },
  { field: "assumptions", label: "Important assumptions", sections: ["METHODOLOGY", "DISCUSSION", "EXPERIMENTAL_SETUP"], instruction: "List assumptions the authors state or explicitly rely on.", max: 3 }
];

const MAX_CANDIDATE_CHARS = 9000;
const MAX_ITEM_CHARS = 400;

const norm = (s) => String(s).replace(/&lt;/g, "<").replace(/\s+/g, " ").trim().toLowerCase();

/** Who produced the statement. Heuristic and reported as such; UNSPECIFIED when the text does not say. */
function classifyAttribution(text, section) {
  const t = String(text);
  const own = /\b(we|our|ours|us)\b|\b(?:this|the present) (?:paper|study|work)\b|\bin this (?:paper|work)\b/i.test(t);
  const prior = /\bet al\.?|\[\d+(?:\s*[,–-]\s*\d+)*\]|\([A-Z][A-Za-z-]+(?: et al\.)?,? \d{4}\)|\b(?:previously|prior work|earlier work|previous work|existing (?:methods?|work|approaches)|reported by|as shown by)\b/i.test(t) || section === "RELATED_WORK";
  if (own && prior) return "MIXED";
  if (prior) return "CITED_PRIOR_WORK";
  if (own) return "OWN_RESULT";
  return "UNSPECIFIED";
}

function candidatesFor(spec, chunks) {
  const scored = [];
  for (const c of chunks) {
    const i = spec.sections.indexOf(c.section);
    if (i === -1) continue;
    const digit = spec.needDigit ? ((c.text.match(/\d/g) || []).length > 2 ? 0 : 3) : 0; // a numeric field prefers chunks that contain numbers
    scored.push({ c, rank: i + digit, ord: c.ordinal });
  }
  scored.sort((a, b) => a.rank - b.rank || a.ord - b.ord);
  const out = [];
  let total = 0;
  for (const s of scored) {
    if (total + s.c.text.length > MAX_CANDIDATE_CHARS && out.length) break;
    out.push(s.c);
    total += s.c.text.length;
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
}

function extractJson(text) {
  if (typeof text !== "string" || !text.length || text.length > 200000) return null;
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1];
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { const v = JSON.parse(s.slice(a, b + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch (_) { return null; }
}

/** Validate model items against the chunks that were given. Returns {kept, dropped:{reason:n}}. */
function anchorItems(rawItems, given, max) {
  const byId = new Map(given.map((c) => [c.chunkId, c]));
  const normText = new Map(given.map((c) => [c.chunkId, norm(c.text)]));
  const kept = [];
  const dropped = {};
  const drop = (r) => { dropped[r] = (dropped[r] || 0) + 1; };
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    if (kept.length >= max) { drop("OVER_LIMIT"); continue; }
    if (!it || typeof it !== "object" || typeof it.text !== "string" || !it.text.trim()) { drop("BAD_SHAPE"); continue; }
    const cites = Array.isArray(it.citations) ? it.citations : [];
    if (!cites.length) { drop("NO_CITATION"); continue; }
    const good = [];
    let reason = null;
    for (const c of cites.slice(0, 4)) {
      if (!c || typeof c.chunkId !== "string" || !byId.has(c.chunkId)) { reason = reason || "UNKNOWN_CHUNK"; continue; }
      const q = typeof c.quote === "string" ? norm(c.quote) : "";
      if (q.length < 12 || !normText.get(c.chunkId).includes(q)) { reason = reason || "QUOTE_NOT_IN_CHUNK"; continue; }
      if (!good.some((g) => g.chunkId === c.chunkId && g.quote === c.quote)) good.push({ chunkId: c.chunkId, quote: String(c.quote).slice(0, 600) });
    }
    if (!good.length) { drop(reason || "NO_CITATION"); continue; }
    kept.push({ text: it.text.trim().slice(0, MAX_ITEM_CHARS), citations: good });
  }
  return { kept, dropped };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/**
 * @param {{model:{callMessages:Function}, chunks:Array, coverage:string, concurrency?:number, onRaw?:Function, maxTokens?:number}} a
 * @returns {Promise<{fields:Object, calls:Array, skipped:Array}>}
 */
async function extractAll({ model, chunks, coverage, concurrency = 1, onRaw = null, maxTokens = 1200 }) {
  const usable = coverage === "ABSTRACT_ONLY" ? chunks.filter((c) => c.section === "ABSTRACT") : chunks;
  const calls = [];
  const skipped = [];
  const results = await mapLimit(FIELD_SPECS, concurrency, async (spec) => {
    const cand = candidatesFor(spec, usable);
    if (!cand.length) { skipped.push({ field: spec.field, reason: coverage === "ABSTRACT_ONLY" ? "ABSTRACT_ONLY" : "NO_CANDIDATE_SECTION" }); return { spec, items: [], reason: coverage === "ABSTRACT_ONLY" ? "ABSTRACT_ONLY" : "NO_CANDIDATE_SECTION" }; }
    const { system, user } = buildExtractPrompt({ field: spec.field, instruction: spec.instruction, chunks: cand, maxItems: spec.max });
    let r;
    try {
      r = await invoke(model, { system, user, maxTokens, timeoutMs: 120000, task: `extract:${spec.field}` });
    } catch (err) {
      calls.push({ stage: "B", field: spec.field, ok: false, category: (err && err.category) || "UNKNOWN" });
      return { spec, items: [], reason: err && err.policyDenied ? "POLICY_REFUSED" : "MODEL_ERROR" };
    }
    if (onRaw) onRaw({ stage: "B", field: spec.field, chunkIds: cand.map((c) => c.chunkId), text: r.text });
    const parsed = extractJson(r.text);
    const meta = { stage: "B", field: spec.field, ok: Boolean(parsed), candidateChunks: cand.length, usage: r.usage || null, latencyMs: r.latencyMs, serverTimings: r.serverTimings || null, truncated: Boolean(r.truncated), costUsd: r.costUsd, costStatus: r.costStatus, model: r.model, provider: r.provider };
    if (!parsed || r.truncated) { calls.push({ ...meta, ok: false, category: r.truncated ? "TRUNCATED" : "UNPARSEABLE" }); return { spec, items: [], reason: r.truncated ? "TRUNCATED" : "UNPARSEABLE" }; }
    const { kept, dropped } = anchorItems(parsed.items, cand, spec.max);
    const byId = new Map(cand.map((c) => [c.chunkId, c]));
    const items = kept.map((k) => {
      const sec = byId.get(k.citations[0].chunkId).section;
      return { ...k, section: sec, attribution: classifyAttribution(`${k.text} ${k.citations[0].quote}`, sec) };
    });
    calls.push({ ...meta, kept: items.length, dropped });
    return { spec, items, dropped };
  });
  const fields = {};
  for (const r of results) fields[r.spec.field] = { label: r.spec.label, items: r.items, reason: r.items.length ? null : r.reason || "NOTHING_STATED_IN_CANDIDATES", dropped: r.dropped || {} };
  return { fields, calls, skipped };
}

module.exports = { FIELD_SPECS, extractAll, anchorItems, candidatesFor, classifyAttribution, extractJson, mapLimit };
