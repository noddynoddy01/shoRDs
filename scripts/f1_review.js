#!/usr/bin/env node
"use strict";
/**
 * Manual review kit for the evidence guard (F1). Offline: no network, no model call, no spend. See backend/eval/guardReview.js and
 * docs/evaluation/F1_REVIEW_KIT.md.
 *
 *   make   --raw raw.json --out dir [--seed N]       raw.json: { paper:{paperId,title,license,doi?,sourceUrl?}, chunks:[{chunkId,text,section?}], modelOutput:{...} }
 *   score  --key dir/KEY.json --sheets a.csv [b.csv] [--out report.json]
 */
const fs = require("node:fs");
const path = require("node:path");
const G = require("../backend/eval/guardReview");

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const list = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return []; const o = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) o.push(args[j]); return o; };
const die = (m) => { console.error(m); process.exit(2); };

if (cmd === "make") {
  const rawFile = flag("raw"); const dir = flag("out");
  if (!rawFile || !dir) die("usage: make --raw raw.json --out dir [--seed N]");
  let plan;
  try { plan = G.buildReviewPlan(JSON.parse(fs.readFileSync(rawFile, "utf8")), { seed: Number(flag("seed", "1")) }); } catch (e) { die(e.message); }
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(rawFile, ".json");
  fs.writeFileSync(path.join(dir, `${base}.reviewer_sheet.csv`), plan.sheet);
  fs.writeFileSync(path.join(dir, `${base}.KEY_DO_NOT_SHARE_WITH_REVIEWERS.json`), JSON.stringify(plan.key, null, 2));
  console.log(`wrote ${plan.units} statements to review in ${dir}. Give reviewers only the .csv; keep the KEY file private.`);
} else if (cmd === "score") {
  const keyFile = flag("key"); const sheets = list("sheets");
  if (!keyFile || !sheets.length || sheets.length > 2) die("usage: score --key KEY.json --sheets a.csv [b.csv] [--out report.json]");
  const rep = G.scoreReview(JSON.parse(fs.readFileSync(keyFile, "utf8")), sheets.map((f) => G.parseCsv(fs.readFileSync(f, "utf8"))));
  const out = flag("out", "f1_review_report.json");
  fs.writeFileSync(out, JSON.stringify(rep, null, 2));
  const pct = (x) => (x.rate === null ? "n/a" : `${(x.rate * 100).toFixed(0)}% (95% CI ${(x.low * 100).toFixed(0)}-${(x.high * 100).toFixed(0)}%, ${x.k}/${x.n})`);
  console.log(`labelled ${rep.labelled}/${rep.units} (disputed ${rep.disputed}, unlabelled ${rep.unlabelled}); supported ${rep.counts.supported}, partial ${rep.counts.partial}, unsupported/contradicted ${rep.counts.unsupportedOrContradicted}`);
  console.log(`guard MISSES (unsupported statement kept): ${pct(rep.miss)}`);
  console.log(`guard FALSE DROPS (supported statement removed): ${pct(rep.falseDrop)}`);
  console.log(`share of KEPT statements a reviewer found unsupported: ${pct(rep.shareOfKeptThatIsUnsupported)}`);
  if (rep.agreement) console.log(`reviewer agreement: exact ${rep.agreement.exact}, kappa ${rep.agreement.kappa} (n=${rep.agreement.n})`);
  if (rep.problems.length) console.log("problems:\n  " + rep.problems.join("\n  "));
  console.log("warnings:\n  - " + rep.warnings.join("\n  - ") + `\n\nfull report: ${out}`);
} else die("usage: f1_review.js make|score");
