"use strict";
/**
 * Picks the knowledge-base sections to put in front of the model. Deterministic keyword scoring (no embeddings, no extra paid call):
 * title and tag matches weigh more than body matches, stop words are ignored, and a small always-on core (overview + planned features)
 * is added so the model never answers without knowing what is NOT built. Output is bounded by a character budget.
 */

const STOP = new Set("a an the is are was were be been do does did can could should would will how what where when why which who whom i me my we you your it its to of in on at for from with and or but not no yes this that these those there here as by if so than then into about up down out over just also please tell show give want need get have has had any some".split(" "));
const CORE_IDS = ["overview", "planned-features"];
const MAX_SECTIONS = 5;
const DEFAULT_BUDGET_CHARS = 9000;

const tokenize = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w));
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);

function score(doc, qTokens) {
  const title = new Set(tokenize(doc.title).map(stem));
  const tagWords = new Set(doc.tags.flatMap((t) => tokenize(t).map(stem)));
  const tagPhrases = doc.tags;
  const body = new Set(tokenize(doc.body).map(stem));
  let s = 0;
  for (const t of qTokens) {
    const st = stem(t);
    if (title.has(st)) s += 3;
    if (tagWords.has(st)) s += 2;
    if (body.has(st)) s += 1;
  }
  return s;
}

/** Whole-phrase tag hits ("sign in", "doi") are strong signals. */
function phraseBonus(doc, question) {
  const q = ` ${String(question).toLowerCase().replace(/[^a-z0-9\s']/g, " ")} `;
  let b = 0;
  for (const tag of doc.tags) if (tag.includes(" ") && q.includes(` ${tag} `)) b += 4;
  return b;
}

/**
 * @param {{docs:object[]}} kb
 * @param {string} question
 * @returns {{sections:object[], matched:number}} sections in prompt order, never more than MAX_SECTIONS + the core, within the budget
 */
function retrieve(kb, question, { budgetChars = DEFAULT_BUDGET_CHARS, maxSections = MAX_SECTIONS } = {}) {
  const qTokens = [...new Set(tokenize(question))];
  const ranked = kb.docs
    .map((d) => ({ d, s: score(d, qTokens) + phraseBonus(d, question) }))
    .filter((x) => x.s > 0 && !CORE_IDS.includes(x.d.id))
    .sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id));
  const picked = ranked.slice(0, maxSections).map((x) => x.d);
  const core = CORE_IDS.map((id) => kb.docs.find((d) => d.id === id)).filter(Boolean);
  const out = [];
  let used = 0;
  for (const d of [...picked, ...core]) {
    if (out.some((o) => o.id === d.id)) continue;
    const size = d.body.length + d.title.length + 40;
    if (used + size > budgetChars && out.length > 0) continue;
    out.push(d);
    used += size;
  }
  return { sections: out, matched: picked.length };
}

module.exports = { retrieve, tokenize, CORE_IDS, MAX_SECTIONS, DEFAULT_BUDGET_CHARS };
