"use strict";
/**
 * The benchmark collection command end to end, with the OpenAlex network call replaced by a fictional response (a preload script stubs
 * fetch in the child process). Checks the selection and licence record the owner will rely on. No network, no model, no spend, and
 * nothing here is a human rating.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const B = require("../../eval/summaryBenchmark");

const script = path.resolve(__dirname, "../../../scripts/summary_benchmark.js");
const LICENCES = ["cc-by", "cc-by", "cc0", "cc-by-nc", "cc-by-nd", "cc-by-sa", "publisher-specific-oa", "cc-by"];

function stub(dir, mode) {
  const f = path.join(dir, "stubfetch.js");
  fs.writeFileSync(f, `
    let n = 0;
    globalThis.fetch = async (url) => {
      if (${JSON.stringify(mode)} === "fail") return { ok: false, status: 500, json: async () => ({}) };
      const stratumCall = n++;
      const results = ${JSON.stringify(LICENCES)}.map((lic, i) => ({
        id: "https://openalex.org/W" + stratumCall + "_" + i, doi: "https://doi.org/10.9999/s" + stratumCall + "." + i, title: "Fictional paper " + stratumCall + "." + i,
        publication_year: 2022, abstract_inverted_index: { Fictional: [0], abstract: [1] }, primary_topic: { field: { display_name: "Field" + stratumCall } },
        best_oa_location: { license: lic, landing_page_url: "https://example.test/p/" + stratumCall + "/" + i }
      }));
      // a duplicate of the first work, as a second search can return it again
      results.push({ ...results[0] });
      return { ok: true, status: 200, json: async () => ({ results }) };
    };`);
  return f;
}

test("collect: licence-gated, stratified, de-duplicated, with a record the owner can check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-"));
  const out = path.join(dir, "bm", "candidates.json");
  const log = execFileSync(process.execPath, ["--require", stub(dir, "ok"), script, "collect", "--out", out, "--total", "12", "--seed", "3"], { encoding: "utf8" });
  assert.match(log, /selected 12 of 12 \(shortfall 0\)/);
  const res = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(res.selected.length, 12);
  assert.ok(res.selected.every((c) => ["cc-by", "cc0", "cc-by-sa"].includes(c.licenseNormalised) && c.licenseDecision === "yes"), "only licences cleared for an evaluation set are selected");
  assert.ok(!res.selected.some((c) => /nc|nd|publisher/.test(c.license)), "NonCommercial, NoDerivatives and publisher-specific are never selected");
  assert.equal(new Set(res.selected.map((c) => c.paperId)).size, 12, "no paper twice");
  assert.equal(Object.keys(res.perStratum).length, 6);
  assert.ok(Object.values(res.perStratum).every((n) => n === 2), "round robin: two per stratum");
  assert.ok(res.excluded.some((x) => x.reason === "LICENSE_NO") && res.excluded.some((x) => x.reason === "DUPLICATE"));
  assert.ok(res.retrievedAt && res.query && res.seed === 3, "provenance is recorded");
  // reproducible
  const out2 = path.join(dir, "bm2", "candidates.json");
  execFileSync(process.execPath, ["--require", stub(dir, "ok"), script, "collect", "--out", out2, "--total", "12", "--seed", "3"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(fs.readFileSync(out2, "utf8")).selected.map((c) => c.paperId), res.selected.map((c) => c.paperId));

  const rec = B.parseCsv(fs.readFileSync(path.join(dir, "bm", "selection_record.csv"), "utf8"));
  const sel = rec.filter((r) => r.decision === "SELECTED");
  assert.equal(sel.length, 12);
  assert.ok(sel.every((r) => r.licence_confirmed_by_person === "" && r.confirmed_on === ""), "the confirmation columns are left for a person");
  assert.ok(rec.some((r) => /^EXCLUDED_LICENSE/.test(r.decision)));
  assert.ok(sel.every((r) => /^https?:\/\//.test(r.landing_page)));
});

test("collect: a provider error stops the run and writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-"));
  const out = path.join(dir, "bm", "candidates.json");
  const r = spawnSync(process.execPath, ["--require", stub(dir, "fail"), script, "collect", "--out", out], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /OpenAlex answered 500/);
  assert.equal(fs.existsSync(path.join(dir, "bm")), false);
});

test("a shortfall is reported, not hidden", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-"));
  const log = execFileSync(process.execPath, ["--require", stub(dir, "ok"), script, "collect", "--out", path.join(dir, "c.json"), "--total", "50"], { encoding: "utf8" });
  assert.match(log, /selected 30 of 50 \(shortfall 20\)/, "five usable licences per stratum (three CC BY, CC0, CC BY-SA) are available in the stub");
});
