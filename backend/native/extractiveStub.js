"use strict";
/**
 * The built-in stub "model" of the native engine.
 *
 * IT IS NOT A LANGUAGE MODEL. It is a deterministic, rule-based extractive component that reads the same prompts a real model would
 * read and answers in the same JSON format, using cue words and the section labels of the excerpts. It exists so that the whole
 * pipeline (document intelligence, extraction, hierarchical summary, brief, validation) can run offline, for free, repeatably, in CI.
 *
 * What a run with this stub does and does not show:
 *   - it shows that the plumbing, the schemas, the citation/quote anchoring and the validation work end to end;
 *   - it says NOTHING about how well a language model would summarise a paper, and no quality number measured with it may be
 *     reported as a model's quality. Every stub result carries model "shords-extractive-stub-v1".
 */
const { splitSentences } = require("../papers/chunker");

const STUB_MODEL_ID = "shords-extractive-stub-v1";

const FIELD_RULES = {
  researchProblem: { sections: ["ABSTRACT", "INTRODUCTION", "BACKGROUND"], cue: /\b(struggle|fail|lose|loses|lost|challeng\w*|problem|difficult\w*|degrade\w*|remain\w*|limited|bottleneck|costly|expensive)\b/i },
  researchGap: { sections: ["INTRODUCTION", "ABSTRACT", "RELATED_WORK", "BACKGROUND"], cue: /\b(existing|prior|previous|however|but|yet|lack\w*|do not|does not|cannot|unclear|unexplored|no study)\b/i },
  objective: { sections: ["INTRODUCTION", "ABSTRACT"], cue: /\b(we study|we ask|we investigate|we aim|we examine|goal|whether|this paper|we address)\b/i },
  methodology: { sections: ["METHODOLOGY", "ABSTRACT", "INTRODUCTION"], cue: /\b(we propose|we introduce|we present|replaces?|assigned?|project(?:ed|s)?|updated?|routes?|method|algorithm|architecture|trained?|layer)\b/i },
  dataset: { sections: ["DATASET", "EXPERIMENTAL_SETUP", "METHODOLOGY", "INTRODUCTION", "TABLE"], cue: /\b(data ?sets?|benchmarks?|corpus|tokens of|questions|samples|annotated|split)\b/i },
  experimentalSetup: { sections: ["EXPERIMENTAL_SETUP", "METHODOLOGY", "RESULTS"], cue: /\b(train(?:ed|ing)?|epochs?|learning rate|accelerators?|gpus?|seeds?|fine-tune\w*|batch|evaluated|temperature|hyperparameter\w*)\b/i },
  baselines: { sections: ["RESULTS", "EXPERIMENTAL_SETUP", "ABSTRACT", "TABLE"], cue: /\b(baselines?|compared (?:with|to)|versus|vs\.?|against)\b/i },
  contributions: { sections: ["INTRODUCTION", "ABSTRACT", "CONCLUSION"], cue: /\b(contributions?|first,|second,|third,|we introduce|we release|we propose|we provide)\b/i },
  quantitativeFindings: { sections: ["RESULTS", "ABSTRACT", "DISCUSSION", "TABLE", "CONCLUSION"], cue: /\d/, needDigit: true },
  limitations: { sections: ["LIMITATIONS", "DISCUSSION", "CONCLUSION"], cue: /\b(only|did not|do not|not measure\w*|limitation\w*|single|tuned on|not evaluated|cannot|restricted|no evidence)\b/i },
  futureWork: { sections: ["FUTURE_WORK", "CONCLUSION", "DISCUSSION"], cue: /\b(future work|will (?:test|explore|study|extend)|we plan|future)\b/i },
  assumptions: { sections: ["METHODOLOGY", "DISCUSSION", "EXPERIMENTAL_SETUP"], cue: /\b(assum\w*|we attribute|we hypothes\w*|we posit|under the assumption)\b/i }
};

const SECTION_CUES = {
  claim: /\d|\b(we (?:propose|introduce|show|find|observe|train|evaluate)|outperform\w*|improv\w*|reduc\w*|increas\w*|ablation|compared)\b/i
};

function parseExcerpts(user) {
  return [...String(user).matchAll(/<excerpt id="([^"]+)" section="([^"]*)">\n([\s\S]*?)\n<\/excerpt>/g)].map((m) => ({ id: m[1], section: m[2], text: m[3].replace(/&lt;/g, "<") }));
}

function item(sentence, chunkId) {
  return { text: sentence.slice(0, 400), citations: [{ chunkId, quote: sentence }] };
}

function sentencesOf(ex) {
  const out = [];
  for (const e of ex) for (const s of splitSentences(e.text)) if (s.length >= 25 && s.length <= 400) out.push({ s, id: e.id, section: e.section });
  return out;
}

function extractField(field, ex, max) {
  const rule = FIELD_RULES[field];
  if (!rule) return { items: [] };
  const sents = sentencesOf(ex);
  const rank = (x) => { const i = rule.sections.indexOf(x.section); return i === -1 ? 99 : i; };
  const hits = sents.filter((x) => rule.cue.test(x.s) && (rule.sections.includes(x.section) || x.section === "TABLE") && (!rule.needDigit || /\d/.test(x.s)));
  hits.sort((a, b) => rank(a) - rank(b));
  const seen = new Set();
  const items = [];
  for (const h of hits) {
    if (seen.has(h.s)) continue;
    seen.add(h.s);
    items.push(item(h.s, h.id));
    if (items.length >= max) break;
  }
  return { items };
}

function summariseSection(ex, maxClaims) {
  const sents = sentencesOf(ex);
  const summary = sents.slice(0, 2).map((x) => item(x.s, x.id));
  const claims = sents.filter((x) => SECTION_CUES.claim.test(x.s)).slice(0, maxClaims).map((x) => item(x.s, x.id));
  return { summary, claims };
}

const BRIEF_MAP = {
  researchProblem: ["researchProblem"],
  whyItMatters: ["researchGap", "objective"],
  proposedMethod: ["methodology"],
  keyContributions: ["contributions"],
  majorFindings: ["quantitativeFindings"],
  quantitativeResults: ["quantitativeFindings"],
  limitations: ["limitations"],
  futureDirections: ["futureWork"]
};

function writeBrief(user) {
  const claims = [...String(user).matchAll(/^(\{"id":.*\})$/gm)].map((m) => { try { return JSON.parse(m[1]); } catch (_) { return null; } }).filter(Boolean);
  const wanted = (/<sections>([^<]*)<\/sections>/.exec(user) || [, ""])[1].split(",").filter(Boolean);
  const sections = {};
  const take = (fields, filter, n) => claims.filter((c) => (c.fields || []).some((f) => fields.includes(f)) && filter(c)).slice(0, n).map((c) => ({ text: c.text, claimIds: [c.id] }));
  const hasDigit = (c) => /\d/.test(c.text);
  const own = (c) => c.attribution !== "CITED_PRIOR_WORK";
  for (const key of wanted) {
    if (key === "inBrief") {
      sections[key] = [
        ...take(["objective", "researchProblem"], own, 1),
        ...take(["methodology"], own, 1),
        ...take(["quantitativeFindings"], (c) => own(c) && hasDigit(c), 1)
      ];
    } else if (key === "majorFindings") sections[key] = take(BRIEF_MAP[key], (c) => own(c) && !hasDigit(c), 3).concat(take(BRIEF_MAP[key], (c) => own(c) && hasDigit(c), 2)).slice(0, 4);
    else if (key === "quantitativeResults") sections[key] = take(BRIEF_MAP[key], (c) => own(c) && hasDigit(c), 6);
    else if (BRIEF_MAP[key]) sections[key] = take(BRIEF_MAP[key], () => true, key === "keyContributions" ? 4 : 3);
    else sections[key] = [];
  }
  return { sections };
}

/** One-shot "direct" brief: what a single prompt over the whole text would return from this stub (lead sentences by section cue). */
function directBrief(ex) {
  const pick = (field, n) => extractField(field, ex, n).items.map((it) => ({ text: it.text, citations: it.citations }));
  return {
    sections: {
      inBrief: pick("objective", 1).concat(pick("methodology", 1)).concat(pick("quantitativeFindings", 1)),
      researchProblem: pick("researchProblem", 2), whyItMatters: pick("researchGap", 2), proposedMethod: pick("methodology", 3),
      keyContributions: pick("contributions", 3), majorFindings: pick("quantitativeFindings", 3), quantitativeResults: pick("quantitativeFindings", 5),
      limitations: pick("limitations", 3), futureDirections: pick("futureWork", 2)
    }
  };
}

/** @returns {string} JSON text, exactly what a model would return */
function stubComplete(system, user) {
  const task = /<task name="(\w+)"(?: field="(\w+)")?(?: section="(\w+)")?/.exec(user);
  if (!task) return JSON.stringify({ items: [] });
  const ex = parseExcerpts(user);
  if (task[1] === "extract_field") {
    const max = Number((/Return at most (\d+) items/.exec(user) || [, 4])[1]);
    return JSON.stringify(extractField(task[2], ex, max));
  }
  if (task[1] === "summarise_section") {
    const max = Number((/\(at most (\d+)\)/.exec(user) || [, 4])[1]);
    return JSON.stringify(summariseSection(ex, max));
  }
  if (task[1] === "write_brief") return JSON.stringify(writeBrief(user));
  if (task[1] === "direct_brief") return JSON.stringify(directBrief(ex));
  return JSON.stringify({ items: [] });
}

module.exports = { stubComplete, STUB_MODEL_ID, FIELD_RULES };
