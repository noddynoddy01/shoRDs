"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseLicense, permissionsFor, selectEvalCorpus } = require("../../papers/licensePolicy");
const { evaluateSummary, extractNumbers, copying, numberGrounding, readability } = require("../../eval/summaryMetrics");
const { runBenchmark } = require("../../eval/benchmark");

// FICTIONAL source text, in the style of the other fixtures, so no figure can be mistaken for a real finding.
const SOURCE = "Sparse Attention Routing reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline. " +
  "We train on 38 billion tokens for 3 epochs. Removing the moving-average update reduces accuracy to 83.0 percent. " +
  "We evaluated only English text and a single model scale of 7 billion parameters.";

test("licence parsing: common spellings from OpenAlex, Europe PMC and Creative Commons URLs", () => {
  assert.equal(parseLicense("cc-by").kind, "CC_BY");
  assert.equal(parseLicense("CC BY 4.0").kind, "CC_BY");
  assert.equal(parseLicense("https://creativecommons.org/licenses/by/4.0/").kind, "CC_BY");
  assert.equal(parseLicense("https://creativecommons.org/licenses/by-nc-nd/4.0/").kind, "CC_BY_NC_ND");
  assert.equal(parseLicense("cc-by-sa").kind, "CC_BY_SA");
  assert.equal(parseLicense("cc0").kind, "CC0");
  assert.equal(parseLicense("https://creativecommons.org/publicdomain/zero/1.0/").kind, "CC0");
  assert.equal(parseLicense("publisher-specific-oa").kind, "READ_ONLY");
  assert.equal(parseLicense("http://arxiv.org/licenses/nonexclusive-distrib/1.0/").kind, "READ_ONLY");
});

test("unknown, missing, malformed and hostile licence values are never permissive", () => {
  for (const v of [null, undefined, "", "   ", 42, {}, [], "all rights reserved", "free for everyone!!", "cc-by-evil", "x".repeat(5000)]) {
    const p = permissionsFor(v);
    assert.equal(p.evalCorpus, "no", String(v).slice(0, 30));
    assert.equal(p.trainingData, "no");
    assert.equal(p.redistributeText, "no");
  }
});

test("permissions by licence: training is never an automatic yes for anything but CC0 and public domain", () => {
  assert.deepEqual([permissionsFor("cc0").evalCorpus, permissionsFor("cc0").trainingData], ["yes", "yes"]);
  assert.deepEqual([permissionsFor("cc-by").evalCorpus, permissionsFor("cc-by").trainingData], ["yes", "review"]);
  assert.equal(permissionsFor("cc-by").attributionRequired, true);
  assert.equal(permissionsFor("cc-by-sa").trainingData, "review");
  assert.deepEqual([permissionsFor("cc-by-nd").evalCorpus, permissionsFor("cc-by-nd").trainingData], ["review", "no"]);
  for (const nc of ["cc-by-nc", "cc-by-nc-sa", "cc-by-nc-nd"]) {
    const p = permissionsFor(nc);
    assert.deepEqual([p.evalCorpus, p.trainingData, p.redistributeText], ["no", "no", "no"], nc);
  }
  assert.equal(permissionsFor("publisher-specific-oa").evalCorpus, "no");
});

test("evaluation corpus gate: only clearly permitted papers are admitted; review papers need an explicit opt-in", () => {
  const papers = [{ paperId: "a", license: "cc-by" }, { paperId: "b", license: "cc-by-nc" }, { paperId: "c", license: null }, { paperId: "d", license: "cc-by-nd" }];
  const strict = selectEvalCorpus(papers);
  assert.deepEqual(strict.included.map((x) => x.paperId), ["a"]);
  assert.deepEqual(strict.excluded.map((x) => x.paperId), ["b", "c", "d"]);
  assert.ok(strict.excluded.every((x) => x.reason.length > 0));
  assert.deepEqual(selectEvalCorpus(papers, { allowReview: true }).included.map((x) => x.paperId), ["a", "d"]);
});

test("number extraction: units and separators do not hide a figure", () => {
  assert.deepEqual(extractNumbers("94.2% and 3.5x, 1,024 items in 2021"), ["94.2", "3.5", "1024", "2021"]);
  assert.deepEqual(extractNumbers("version v2 and covid19"), []); // identifiers that merely contain digits are not figures
});

test("grounding: an altered or invented figure is flagged (negative control) and a faithful one is not (positive control)", () => {
  assert.deepEqual(numberGrounding(SOURCE, "Accuracy reached 87.4 percent versus 79.1 percent.").ungrounded, []);
  assert.deepEqual(numberGrounding(SOURCE, "Accuracy reached 87.9 percent versus 79.1 percent.").ungrounded, ["87.9"]);
  assert.deepEqual(numberGrounding(SOURCE, "It beat the baseline by 12 points.").ungrounded, ["12"]);
});

test("copying: a verbatim copy is detected; an original paraphrase is not", () => {
  const copied = copying(SOURCE, "Removing the moving-average update reduces accuracy to 83.0 percent.");
  assert.ok(copied.longestVerbatimRun >= 8 && copied.novelBigrams === 0);
  const para = copying(SOURCE, "Dropping the running average costs about four points, which shows it matters.");
  assert.ok(para.longestVerbatimRun <= 3 && para.novelBigrams > 0.5);
  assert.equal(copying(SOURCE, "").novelUnigrams, null);
});

test("readability: short plain sentences score easier than long dense ones; empty input gives null, not NaN", () => {
  const easy = readability("The model works. It is fast. People like it.");
  const hard = readability("Notwithstanding considerable methodological heterogeneness, multidimensional representational architectures demonstrated statistically significant improvements.");
  assert.ok(easy.fleschReadingEase > hard.fleschReadingEase);
  assert.deepEqual(readability(""), { fleschReadingEase: null, fleschKincaidGrade: null });
});

test("evaluateSummary: failure reasons are specific and deterministic", () => {
  const ok = evaluateSummary({ source: SOURCE, summary: "SAR beats the dense baseline, 87.4 versus 79.1 percent." });
  assert.equal(ok.passed, true, JSON.stringify(ok.failures));
  assert.deepEqual(evaluateSummary({ source: SOURCE, summary: "" }).failures, ["EMPTY_SUMMARY"]);
  assert.ok(evaluateSummary({ source: SOURCE, summary: "SAR reaches 91.2 percent accuracy." }).failures.includes("UNGROUNDED_NUMBER"));
  assert.ok(evaluateSummary({ source: SOURCE, summary: "We train on 38 billion tokens for 3 epochs." }, { maxVerbatimRun: 5 }).failures.includes("LONG_VERBATIM_RUN"));
  assert.ok(evaluateSummary({ source: SOURCE, summary: "word ".repeat(200) }).failures.includes("TOO_LONG"));
  assert.deepEqual(evaluateSummary({ source: SOURCE, summary: "SAR is better." }), evaluateSummary({ source: SOURCE, summary: "SAR is better." }));
});

test("benchmark: papers the licence does not allow are excluded and never scored", () => {
  const cases = [
    { id: "ok", license: "cc-by", source: SOURCE, summary: "SAR beats the dense baseline, 87.4 versus 79.1 percent." },
    { id: "bad", license: "cc-by", source: SOURCE, summary: "SAR reaches 99 percent." },
    { id: "nc", license: "cc-by-nc", source: SOURCE, summary: "fine" },
    { id: "unknown", license: null, source: SOURCE, summary: "fine" }
  ];
  const r = runBenchmark(cases);
  assert.equal(r.evaluated, 2);
  assert.equal(r.passed, 1);
  assert.deepEqual(r.excludedByLicence.map((x) => x.paperId), ["nc", "unknown"]);
  assert.equal(r.failureCounts.UNGROUNDED_NUMBER, 1);
  assert.deepEqual(r.results.map((x) => x.id), ["ok", "bad"]);
});

test("the evaluation code and licence policy are tooling only: no runtime module imports the evaluation code", () => {
  const root = path.join(__dirname, "..", "..");
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!["tests", "eval", "node_modules"].includes(e.name)) walk(p); }
      else if (/\.(js|ts)$/.test(e.name) && /require\(["'][^"']*eval\/(benchmark|summaryMetrics|faithfulness|agreement|benchmarkScoring)["']\)/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test("licence gate: inference, evaluation, training and redistribution are reported separately and never collapse into one answer", () => {
  const rows = {
    "cc0": ["yes", "yes", "yes", "yes"],
    "cc-by": ["yes", "yes", "review", "yes"],
    "cc-by-sa": ["yes", "yes", "review", "review"],
    "cc-by-nd": ["review", "review", "no", "review"],
    "cc-by-nc": ["review", "no", "no", "no"],
    "cc-by-nc-sa": ["review", "no", "no", "no"],
    "cc-by-nc-nd": ["review", "no", "no", "no"],
    "publisher-specific-oa": ["review", "no", "no", "no"],
    "": ["review", "no", "no", "no"]
  };
  for (const [lic, want] of Object.entries(rows)) {
    const p = permissionsFor(lic);
    assert.deepEqual([p.inference, p.evalCorpus, p.trainingData, p.redistributeText], want, lic || "(empty)");
  }
});

test("licence gate: inference is advisory and never 'no'; every result states it is a policy rule, not a legal conclusion, with a basis per permission", () => {
  for (const lic of ["cc0", "cc-by", "cc-by-nc-nd", "publisher-specific-oa", null, "nonsense"]) {
    const p = permissionsFor(lic);
    assert.notEqual(p.inference, "no", String(lic));
    assert.match(p.notice, /not a legal conclusion/i);
    for (const k of ["inference", "evalCorpus", "trainingData", "redistributeText"]) assert.ok(typeof p.basis[k] === "string" && p.basis[k].length > 20, `${lic} ${k}`);
  }
  assert.equal(permissionsFor("cc-by").basis.deed, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(permissionsFor("nonsense").basis.deed, null);
});

test("licence gate: training is never granted by a licence that does not mention it, except CC0 and public domain", () => {
  for (const lic of ["cc-by", "cc-by-sa", "cc-by-nd", "cc-by-nc", "cc-by-nc-sa", "cc-by-nc-nd", "publisher-specific-oa", "implied-oa", null]) {
    assert.notEqual(permissionsFor(lic).trainingData, "yes", String(lic));
  }
});

test("licence parsing: realistic provider spellings (OpenAlex, Europe PMC, URLs with version, jurisdiction and 'legalcode' suffixes)", () => {
  const cases = {
    "cc-by-nc-sa": "CC_BY_NC_SA", "CC BY-NC-ND 4.0": "CC_BY_NC_ND", "cc by": "CC_BY", "cc by-nc": "CC_BY_NC", "pd": "PUBLIC_DOMAIN",
    "https://creativecommons.org/licenses/by/4.0/legalcode": "CC_BY", "https://creativecommons.org/licenses/by-sa/3.0/igo": "CC_BY_SA",
    "implied-oa": "READ_ONLY", "other-oa": "READ_ONLY", "CC-BY (see publisher terms)": "UNKNOWN", "cc-by-nc-evil": "UNKNOWN"
  };
  for (const [raw, kind] of Object.entries(cases)) assert.equal(parseLicense(raw).kind, kind, raw);
});
