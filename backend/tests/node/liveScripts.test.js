"use strict";
/**
 * scripts/verify_retrieval_live.js: its verdict logic (PASS / FAIL / NOT_VERIFIED, never PASS for an unreachable provider) and
 * its isolation checks, run against the fictional fixture web. Real providers are only reachable where the network allows;
 * this proves that when they are, the script's answer means what it says.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fx = require("./paperFixtures");
const { ProviderError } = require("../../papers/providers");

const L = require(path.join(__dirname, "../../../scripts/verify_retrieval_live.js"));

const TARGETS = {
  paperA: { ref: `arxiv:${fx.FIXTURE_ARXIV}`, note: "fixture A", titleHint: "sparse attention" },
  paperB: { ref: "doi:10.9999/fixture.bulk0.2020", note: "fixture B (same body text as A on purpose: isolation must not rely on the text differing)", titleHint: "bulk study number" }
};

/** The fixture web plus the two arXiv endpoints (the shared fixture serves OpenAlex / Europe PMC only). */
function web({ arxivHtmlOk = true } = {}) {
  const base = fx.createFixtureHttp({ papers: fx.bulkPapers(1) });
  const http = async (url, opts) => {
    let m;
    if ((m = /export\.arxiv\.org\/api\/query\?id_list=([^&]+)/.exec(url))) return { status: 200, headers: {}, body: fx.arxivAtom({ id: decodeURIComponent(m[1]) }) };
    if (/arxiv\.org\/html\//.test(url)) return arxivHtmlOk ? { status: 200, headers: { "content-type": "text/html" }, body: fx.arxivHtml() } : { status: 404, headers: {}, body: "" };
    return base(url, opts);
  };
  return http;
}
const by = (results, part, key) => results.filter((r) => r.part === part).map((r) => `${r[key]}`);

test("a healthy web: every provider endpoint PASSes, both papers reach FULL_TEXT, isolation PASSes", async () => {
  const { results, summary, exitCode } = await L.run({ http: web(), targets: TARGETS, report: () => {} });
  assert.deepEqual(summary, { pass: summary.pass, fail: 0, notVerified: 0 });
  assert.equal(exitCode, 0);
  const providers = results.filter((r) => r.part === "provider");
  assert.deepEqual(providers.map((p) => `${p.provider}:${p.check}:${p.status}`), [
    "OpenAlex:works by DOI:PASS", "EuropePMC:search by DOI:PASS", "EuropePMC:open-access full text (JATS XML):PASS", "arXiv:metadata API:PASS", "arXiv:HTML full text:PASS"
  ]);
  const pipeline = results.filter((r) => r.part === "pipeline");
  assert.deepEqual(pipeline.map((p) => [p.paper, p.coverage, p.status]), [["A", "FULL_TEXT", "PASS"], ["B", "FULL_TEXT", "PASS"]]);
  assert.ok(pipeline.every((p) => p.chunks > 3 && p.sections > 2));
  const iso = results.filter((r) => r.part === "isolation");
  assert.ok(iso.length >= 8 && iso.every((r) => r.status === "PASS"), JSON.stringify(iso.filter((r) => r.status !== "PASS")));
  assert.deepEqual(by(results, "isolation", "check").slice(-3), ["A cannot request B's evidence", "B cannot request A's evidence", "each paper can request its own evidence"]);
});

test("unreachable / refused providers are NOT_VERIFIED, never PASS; nothing is invented; exit code 2", async () => {
  for (const make of [
    () => async () => { throw new ProviderError("NETWORK", "ENOTFOUND", { provider: "x" }); },
    () => async () => ({ status: 403, headers: {}, body: "Forbidden by egress policy" }),
    () => async () => ({ status: 429, headers: {}, body: "{}" }),
    () => async () => ({ status: 503, headers: {}, body: "{}" })
  ]) {
    const { results, summary, exitCode } = await L.run({ http: make(), targets: TARGETS, report: () => {} });
    assert.equal(results.filter((r) => r.status === "PASS").length, 0, "no PASS without a reachable provider");
    assert.equal(summary.fail, 0);
    assert.equal(exitCode, 2);
    assert.ok(results.filter((r) => r.part === "provider").every((r) => r.status === "NOT_VERIFIED"));
    assert.equal(results.find((r) => r.part === "isolation").status, "NOT_VERIFIED");
  }
});

test("a reachable provider that answers with the wrong paper is a FAIL (it is not 'unreachable')", async () => {
  const good = web();
  const wrong = async (url, o) => {
    const r = await good(url, o);
    if (/api\.openalex\.org/.test(url)) return { ...r, body: r.body.replace(/Bulk Study Number 0 of Fictional Systems/g, "Something Else Entirely") };
    return r;
  };
  const { results, exitCode } = await L.run({ http: wrong, targets: TARGETS, report: () => {} });
  assert.equal(results.find((r) => r.provider === "OpenAlex").status, "FAIL");
  assert.equal(exitCode, 1);
});

test("arXiv paper without an HTML rendering: host reachable, and the pipeline honestly reports ABSTRACT_ONLY", async () => {
  const { results } = await L.run({ http: web({ arxivHtmlOk: false }), targets: TARGETS, report: () => {} });
  const html = results.find((r) => r.check === "HTML full text");
  assert.equal(html.status, "PASS");
  assert.equal(html.htmlAvailable, false);
  assert.equal(results.find((r) => r.part === "pipeline" && r.paper === "A").coverage, "ABSTRACT_ONLY");
});

test("isolation catches a real defect: two papers that share evidence ids or content are a FAIL", () => {
  const mk = (paperId, texts) => ({ label: paperId, paperId, coverage: "FULL_TEXT", chunks: texts.map((t, i) => ({ chunkId: `${paperId}_chunk_${i + 1}`, section: "BODY", heading: null, text: t, sourceType: "BODY", ordinal: i + 1, textHash: "h" })) });
  const results = [];
  L.isolation(mk("doi:10.1234/aaa", ["alpha one", "alpha two"]), mk("doi:10.1234/bbb", ["beta one", "beta two"]), () => {}, results);
  assert.ok(results.every((r) => r.status === "PASS"));
  const a = mk("doi:10.1234/aaa", ["same text"]);
  const stolen = { ...mk("doi:10.1234/bbb", ["same text"]), chunks: [{ ...a.chunks[0] }] }; // B carrying A's chunk id: must be caught
  const bad = [];
  L.isolation(a, stolen, () => {}, bad);
  assert.ok(bad.some((r) => r.status === "FAIL"), JSON.stringify(bad));
});

test("production code never imports the fixtures or the live scripts", () => {
  const fs = require("fs");
  const root = path.join(__dirname, "../..");
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === "tests" || e.name === "node_modules") continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : p.endsWith(".js") && out.push(p); } return out; };
  for (const f of walk(root)) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /require\([^)]*(paperFixtures|verify_retrieval_live|verify_cloud|smoke_claude)/, f);
});

test("check_web_bundle.js: a clean bundle passes; keys, provider hosts and server variables are found without printing the secret", () => {
  const fs = require("fs");
  const os = require("os");
  const { scan } = require(path.join(__dirname, "../../../scripts/check_web_bundle.js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  const FB = "AIza" + "x".repeat(35); // the public Firebase web key: allowed
  fs.writeFileSync(path.join(dir, "clean.js"), `var cfg={apiKey:"${FB}",projectId:"demo"};fetch("/api/v1/projects",{headers:{Authorization:"Bearer "+t}})`);
  assert.deepEqual(scan(dir, { publicFirebaseKey: FB }).findings, []);
  const secret = "sk-ant-" + "a".repeat(30);
  const other = "AIza" + "y".repeat(35);
  fs.writeFileSync(path.join(dir, "bad.js"), `var a="${secret}";var b="${other}";fetch("https://api.anthropic.com/v1/messages");var c="postgres://u:p@h/db";var d="ANTHROPIC_API_KEY";`);
  const { findings } = scan(dir, { publicFirebaseKey: FB });
  assert.deepEqual([...new Set(findings.map((f) => f.rule))].sort(), ["anthropic-key", "google-api-key", "openai-style-key", "provider-host", "server-connection-string", "server-only-variable"]);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret.slice(0, 20)), "the secret itself is never printed");
  assert.equal(scan(fs.mkdtempSync(path.join(os.tmpdir(), "empty-"))).filesScanned, 0);
});
