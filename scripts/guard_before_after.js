#!/usr/bin/env node
"use strict";
/**
 * Before/after comparison of the claim guard (Phase 6, fix of findings F-5-1 and F-5-2).
 *
 *   node scripts/guard_before_after.js [--before docs/phase6/evidence/claimGuard.before.js] [--json out.json]
 *
 * Runs the OLD guard (a frozen copy of the file as it was at INTEL_PROMPT_VERSION 2026.3-intel) and the CURRENT guard over:
 *   1. every hand-written case of the two existing fixtures (regression + limits register): which verdicts changed;
 *   2. identity control: every sentence of every available text, cited against its own chunk. A sentence is a faithful statement of itself,
 *      so a drop here is a false drop;
 *   3. same-direction control: each sentence that has a direction word, rewritten with a SYNONYM on the same side (rises -> grows). Faithful;
 *   4. flipped-direction mutation: the same sentences with the OPPOSITE word (rises -> falls). Unfaithful: a detection counts;
 *   5. swapped-order mutation: each "from X to Y" sentence with X and Y exchanged, the verb unchanged. Unfaithful.
 * ALL texts are synthetic or fictional (the repository's fixtures). The counts describe those texts only: they are NOT a false-drop or
 * detection rate on real papers.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

const before = require(path.resolve(root, arg("--before", "docs/phase6/evidence/claimGuard.before.js")));
const after = require("../backend/llm/claimGuard");

const check = (g, chunks, text, cites) => {
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));
  return g.checkStatement({ text, citedIds: cites, chunksById: byId, index: g.buildEvidenceIndex(chunks) });
};
const verdict = (r) => (r.ok ? "KEPT" + (r.qualifiers.length ? ":" + r.qualifiers.join("+") : "") : `DROPPED:${r.reason}${typeof r.detail === "string" ? ":" + r.detail : ""}`);

// ---- corpora (all synthetic / fictional)
const regression = require("../backend/tests/fixtures/evidence_regression.json");
const limits = require("../backend/tests/fixtures/evidence_limits_register.json");
const F = require("../backend/tests/node/paperFixtures");
const { extractJats } = require("../backend/papers/extract");
const { fromStructured, fromPlainText } = require("../backend/native/documentIntelligence");
const { PDF_TEXT } = require("../backend/tests/node/nativePdfText.fixture");
const corpora = [];
for (const [k, v] of Object.entries(regression.papers)) corpora.push({ name: `regression:${k}`, chunks: v });
for (const [k, v] of Object.entries(limits.papers)) corpora.push({ name: `limits:${k}`, chunks: v });
corpora.push({ name: "jats:fictional", chunks: fromStructured({ paperId: "pap_fixture", ...extractJats(F.jats()) }, { abstractOnly: false }).chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })) });
corpora.push({ name: "pdf:fictional", chunks: fromPlainText(PDF_TEXT, { paperId: "pap_pdf" }).chunks.map((c) => ({ chunkId: c.chunkId, text: c.text })) });

// ---- 1. hand-written cases
const changed = [];
let caseCount = 0;
const cases = [
  ...regression.statements.map((c) => ({ id: c.id, chunks: regression.papers[c.paper], text: c.text, cites: c.cites, truth: c.category === "faithful" ? "faithful" : "unfaithful?" })),
  ...limits.cases.map((c) => ({ id: c.id, chunks: limits.papers[c.paper], text: c.text, cites: c.cites, truth: c.truth }))
];
for (const c of cases) {
  caseCount += 1;
  const a = verdict(check(before, c.chunks, c.text, c.cites));
  const b = verdict(check(after, c.chunks, c.text, c.cites));
  if (a !== b) changed.push({ id: c.id, truth: c.truth, before: a, after: b, text: c.text });
}

// ---- 2 to 5. controls and mutations
const UP = ["increase", "improve", "rise", "grow", "gain"];
const DOWN = ["decrease", "reduce", "drop", "decline", "fall"];
const FORMS = { // surface forms of each lemma, by tense
  increase: { s: "increases", p: "increased" }, improve: { s: "improves", p: "improved" }, rise: { s: "rises", p: "rose" }, grow: { s: "grows", p: "grew" }, gain: { s: "gains", p: "gained" },
  decrease: { s: "decreases", p: "decreased" }, reduce: { s: "reduces", p: "reduced" }, drop: { s: "drops", p: "dropped" }, decline: { s: "declines", p: "declined" }, fall: { s: "falls", p: "fell" }
};
const wordRe = new RegExp(`\\b(${Object.values(FORMS).flatMap((f) => [f.s, f.p]).join("|")})\\b`, "i");
const lemmaOf = (w) => Object.keys(FORMS).find((k) => FORMS[k].s === w.toLowerCase() || FORMS[k].p === w.toLowerCase());
const tenseOf = (w) => (FORMS[lemmaOf(w)].s === w.toLowerCase() ? "s" : "p");
const synonym = (w, list) => FORMS[list[(list.indexOf(lemmaOf(w)) + 1) % list.length]][tenseOf(w)]; // the next word on the same side
const sideOf = (w) => (UP.includes(lemmaOf(w)) ? "up" : "down");

const stats = { sentences: 0, identity: { before: 0, after: 0 }, sameDir: { n: 0, before: 0, after: 0 }, flipped: { n: 0, before: 0, after: 0 }, order: { n: 0, before: 0, after: 0 } };
const falseDropsAfter = [];
const missedFlips = [];
const { segment } = after;
for (const co of corpora) {
  for (const ch of co.chunks) {
    for (const seg of segment(ch.text)) {
      const s = seg.text;
      stats.sentences += 1;
      const one = [{ chunkId: ch.chunkId, text: ch.text }];
      const idB = check(before, one, s, [ch.chunkId]);
      const idA = check(after, one, s, [ch.chunkId]);
      if (!idB.ok) stats.identity.before += 1;
      if (!idA.ok) { stats.identity.after += 1; falseDropsAfter.push({ corpus: co.name, kind: "identity", text: s, verdict: verdict(idA), alsoBefore: !idB.ok }); }
      const m = wordRe.exec(s);
      if (m) {
        const side = sideOf(m[0]);
        const same = s.replace(wordRe, (w) => synonym(w, side === "up" ? UP : DOWN)); // a synonym on the same side
        const flip = s.replace(wordRe, (w) => FORMS[(side === "up" ? DOWN : UP)[0]][tenseOf(w)]); // the opposite side
        stats.sameDir.n += 1; stats.flipped.n += 1;
        const sB = check(before, one, same, [ch.chunkId]), sA = check(after, one, same, [ch.chunkId]);
        if (!sB.ok) stats.sameDir.before += 1;
        if (!sA.ok) { stats.sameDir.after += 1; falseDropsAfter.push({ corpus: co.name, kind: "same-direction", text: same, verdict: verdict(sA), alsoBefore: !sB.ok }); }
        if (!check(before, one, flip, [ch.chunkId]).ok) stats.flipped.before += 1;
        if (!check(after, one, flip, [ch.chunkId]).ok) stats.flipped.after += 1;
        else missedFlips.push({ corpus: co.name, original: s, mutated: flip });
      }
      for (const oc of after.orderedChanges(s).slice(0, 1)) {
        if (oc.from === oc.to) continue;
        const swapped = s.replace(oc.from, "\u0001").replace(oc.to, oc.from).replace("\u0001", oc.to);
        stats.order.n += 1;
        if (!check(before, one, swapped, [ch.chunkId]).ok) stats.order.before += 1;
        if (!check(after, one, swapped, [ch.chunkId]).ok) stats.order.after += 1;
      }
    }
  }
}

const out = { _kind: "SYNTHETIC_TEXTS_ONLY_NOT_A_RATE_ON_REAL_PAPERS", corpora: corpora.map((c) => ({ name: c.name, chunks: c.chunks.length })), handWrittenCases: caseCount, changedVerdicts: changed, stats, falseDropsAfter, missedFlipsAfter: missedFlips };
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, corpora: undefined, falseDropsAfter: out.falseDropsAfter.slice(0, 12), falseDropsAfterCount: out.falseDropsAfter.length }, null, 2));
