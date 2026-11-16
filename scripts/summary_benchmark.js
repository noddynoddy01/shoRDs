#!/usr/bin/env node
"use strict";
/**
 * Summary-quality benchmark runner. See docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md.
 *
 *   collect  Find licensed open-access candidates and draw a stratified, licence-gated sample.   NEEDS NETWORK (OpenAlex)
 *   device   Build the on-device brief for each selected paper (rule-based, offline).
 *   plan     Make blinded rating sheets (one CSV per rater) and a secret key.
 *   score    Read the returned sheets and report agreement, scores, comparison and failure patterns.
 *
 * No step calls a language model. The backend analyses are produced separately, with the owner's own key, and handed to `plan` as a file.
 */
const fs = require("node:fs");
const path = require("node:path");
const B = require("../backend/eval/summaryBenchmark");

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const list = (name) => { const i = args.indexOf(`--${name}`); if (i < 0) return []; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out; };
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const die = (m) => { console.error(m); process.exit(2); };

const STRATA = [
  { stratum: "biomedical", search: "randomized clinical trial outcomes" },
  { stratum: "machine_learning", search: "neural network benchmark evaluation" },
  { stratum: "physics", search: "quantum condensed matter measurement" },
  { stratum: "social_science", search: "survey experiment behaviour" },
  { stratum: "earth_environment", search: "climate ecology field study" },
  { stratum: "systems_engineering", search: "distributed systems performance evaluation" }
];

async function collect() {
  const out = flag("out", "benchmark/candidates.json");
  const total = Number(flag("total", "50"));
  const seed = Number(flag("seed", "1"));
  const since = flag("since", "2018-01-01");
  const all = [];
  for (const s of STRATA) {
    const filter = `open_access.is_oa:true,best_oa_location.license:cc-by|cc0|public-domain,type:article,has_abstract:true,from_publication_date:${since}`;
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(s.search)}&filter=${filter}&per_page=50`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) die(`OpenAlex answered ${res.status} for stratum ${s.stratum}. Nothing was written.`);
    const got = B.candidatesFromOpenAlex(await res.json(), s.stratum);
    console.log(`${s.stratum}: ${got.length} candidates`);
    all.push(...got);
  }
  const sel = B.selectBenchmarkPapers(all, { total, seed });
  writeJson(out, { retrievedAt: new Date().toISOString(), query: "OpenAlex works, open access, licence in {cc-by, cc0, public-domain}", seed, ...sel });
  // Human-checkable record of what was chosen and why. The last two columns are for the owner: a person must confirm each licence on the
  // paper's own page before its text is used (a database field is a lead, not a permission).
  const recordFile = path.join(path.dirname(path.resolve(out)), "selection_record.csv");
  const cols = ["paperId", "doi", "title", "year", "stratum", "licence_reported", "licence_normalised", "decision", "landing_page", "licence_confirmed_by_person", "confirmed_on"];
  const rows = [
    ...sel.selected.map((c) => ({ paperId: c.paperId, doi: c.doi, title: c.title, year: c.year, stratum: c.stratum, licence_reported: c.license, licence_normalised: c.licenseNormalised, decision: "SELECTED", landing_page: c.landingPage, licence_confirmed_by_person: "", confirmed_on: "" })),
    ...sel.excluded.map((x) => ({ paperId: x.paperId, licence_normalised: x.license || "", decision: `EXCLUDED_${x.reason}` }))
  ];
  fs.writeFileSync(recordFile, B.toCsv(rows, cols));
  console.log(`selected ${sel.selected.length} of ${total} (shortfall ${sel.shortfall}); excluded ${sel.excluded.length}; wrote ${out} and ${recordFile}`);
  console.log("Next: attach each paper's text (abstract and, where available, licensed full text) as `fullText`/`abstract`, then run `device`.");
}

async function device() {
  const papersFile = flag("papers"); const out = flag("out", "benchmark/device_briefs.json");
  if (!papersFile) die("usage: device --papers papers.json [--out device_briefs.json]   (papers: [{paperId,title,authors,abstract,fullText?,doi?}])");
  require("../backend/tests/node/registerTs").install(true);
  const Module = require("module");
  const root = path.resolve(__dirname, "..");
  const stubs = { "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }, "react-native": { Platform: { OS: "node" } } };
  const realLoad = Module._load;
  Module._load = function (r, p, ...a) { if (stubs[r]) return stubs[r]; if (r.startsWith("@/")) r = path.join(root, r.slice(2)); return realLoad.call(this, r, p, ...a); };
  const S = require(path.join(root, "services/paperSummarizer.ts"));
  const papers = readJson(papersFile);
  const outMap = {};
  for (const p of papers) {
    const full = typeof p.fullText === "string" && p.fullText.trim().length > 500;
    const brief = await S.generateGroundedResearchBriefAsync({ id: p.paperId, title: p.title, authors: p.authors || [], fullTextStatus: full ? "FULL_TEXT_PDF" : "ABSTRACT_ONLY", summary: p.abstract || "", fullTextRaw: full ? p.fullText : undefined, doi: p.doi, domain: p.field });
    const parts = brief.sections.map((s) => `${s.title}\n${s.content}`);
    if (brief.keyNumbers.length) parts.push("Key numbers\n" + brief.keyNumbers.map((k) => `${k.value} ${k.label}`).join("\n"));
    if (brief.takeaways.length) parts.push("Takeaways\n" + brief.takeaways.map((t) => `- ${t}`).join("\n"));
    outMap[p.paperId] = { text: parts.join("\n\n"), textBasis: brief.summaryMode };
  }
  writeJson(out, outMap);
  console.log(`wrote ${Object.keys(outMap).length} device briefs to ${out}`);
}

function plan() {
  const selected = flag("selected"); const dev = flag("device"); const back = flag("backend"); const dir = flag("out", "benchmark/round1");
  const raters = (flag("raters", "rater_a,rater_b")).split(",");
  if (!selected || !dev || !back) die("usage: plan --selected candidates.json --device device_briefs.json --backend backend_analyses.json [--raters a,b] [--seed N] [--out dir]\n  backend_analyses.json: { paperId: { intelligence, chunksById? } }  (the `intelligence` object of a completed analysis)");
  const sel = readJson(selected).selected; const d = readJson(dev); const b = readJson(back);
  const items = sel.map((p) => {
    const bk = b[p.paperId];
    const rendered = bk ? B.renderIntelligenceText(bk.intelligence, bk.chunksById || null) : { text: "", passages: {} };
    return { paperId: p.paperId, title: p.title, link: p.landingPage || `https://doi.org/${p.doi}`, license: p.license, summaries: { device_brief: d[p.paperId] ? { text: d[p.paperId].text } : null, backend_analysis: rendered.text ? rendered : null } };
  });
  const complete = items.filter((i) => i.summaries.device_brief && i.summaries.backend_analysis);
  if (complete.length < items.length) console.warn(`WARNING: ${items.length - complete.length} papers lack one of the two summaries and are left out so the comparison stays paired.`);
  const p = B.buildRatingPlan(complete, { raters, seed: Number(flag("seed", "1")), kind: "HUMAN_RATED_STUDY" });
  fs.mkdirSync(dir, { recursive: true });
  for (const r of raters) fs.writeFileSync(path.join(dir, `${r}.csv`), p.sheets[r]);
  writeJson(path.join(dir, "KEY_DO_NOT_SHARE_WITH_RATERS.json"), p.key);
  console.log(`wrote ${raters.length} rating sheets (${p.unitCount} units each) and the key to ${dir}. Give each rater only their own CSV.`);
}

function score() {
  const keyFile = flag("key"); const sheets = list("ratings");
  if (!keyFile || sheets.length < 2) die("usage: score --key KEY.json --ratings rater_a.csv rater_b.csv [--out report.json]");
  const key = readJson(keyFile);
  const ratings = Object.fromEntries(sheets.map((f) => [path.basename(f, ".csv"), B.parseCsv(fs.readFileSync(f, "utf8"))]));
  const rep = B.analyseRatings(key, ratings, { seed: Number(flag("seed", "1")) });
  const out = flag("out", "benchmark/report.json");
  writeJson(out, rep);
  if (rep.note) console.log(`NOTE: ${rep.note}\n`);
  console.log(`raters: ${rep.raters.join(", ")}   units rated: ${rep.unitsRated}   papers: ${rep.papers}`);
  console.log("\nAgreement (quadratic-weighted kappa; >= 0.6 needed before a criterion is used)");
  console.table(Object.fromEntries(Object.entries(rep.agreement).map(([k, v]) => [k, { kappa: v.kappa, exact: v.exact, withinOne: v.withinOne, reliable: v.reliable }])));
  for (const sys of B.SYSTEMS) { console.log(`\n${sys}: factually unsafe ${rep.perSystem[sys].factuallyUnsafe.count}/${rep.perSystem[sys].units}`); console.table(Object.fromEntries(Object.entries(rep.perSystem[sys].scores).map(([k, v]) => [k, v]))); console.log("failure tags:", rep.perSystem[sys].failureTags); }
  console.log("\nBackend minus device (mean of raters, 95% bootstrap CI over papers)"); console.table(Object.fromEntries(Object.entries(rep.comparison).map(([k, v]) => [k, v.backendMinusDevice])));
  if (rep.problems.length) console.log("\nProblems in the returned sheets:\n  " + rep.problems.join("\n  "));
  console.log("\nLimitations:\n  - " + rep.limitations.join("\n  - ") + `\n\nfull report: ${out}`);
}

(async () => {
  if (cmd === "collect") await collect();
  else if (cmd === "device") await device();
  else if (cmd === "plan") plan();
  else if (cmd === "score") score();
  else die("usage: summary_benchmark.js collect|device|plan|score  (see docs/evaluation/SUMMARY_BENCHMARK_PROTOCOL.md)");
})().catch((e) => die(`${e.name}: ${e.message}`));
