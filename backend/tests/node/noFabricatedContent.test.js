"use strict";
/**
 * P0.2 guards: the app must never present invented information as real.
 *  - Source scan of everything Metro can bundle from app/: no verification label that no step earns, no hard-coded statistics,
 *    no fixed quality score, no placeholder paper/person, no price for a plan that cannot be bought, no canned research output.
 *  - Behaviour of the pure modules that were changed: the read-aloud script contains only the on-screen brief; the paper-id
 *    resolve client parses only what the server returned.
 * Frontend lint/tsc could not be run in this environment, so these tests are the machine check for these rules.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of EXTS) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
function listSources(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) listSources(p, out);
    else if (/\.(tsx?|js)$/.test(d.name)) out.push(p);
  }
  return out;
}
function bundleFiles() {
  const seen = new Set(listSources(path.join(root, "app")));
  const queue = [...seen];
  const re = /(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  while (queue.length) {
    const f = queue.pop();
    for (const m of fs.readFileSync(f, "utf8").matchAll(re)) {
      const r = resolveImport(f, m[1] || m[2] || m[3] || m[4]);
      if (r && !seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  return [...seen].map((f) => path.relative(root, f)).sort();
}

const FORBIDDEN = [
  [/FULL TEXT VERIFIED|SOURCE VERIFIED/, "a verification label no step earns"],
  [/Verified Claim Source|Key Verified Results|Verified Quantitative/i, "a 'verified' label on unverified content"],
  [/18\.4 percent|142 independent|94\.2 percent|\b94\.2\b/, "hard-coded statistics"],
  [/alphaqubit-decoder|Scientific Research Investigation|Research Author\b|Academic Scholar|Academic Journal|Academic Publisher/, "placeholder paper or person"],
  [/Human Voice|Human Brief|HUMAN VOICE/, "a device voice described as a human"],
  [/\$9\.99|\$79\.99|₹799|Upgrade Now|Upgrade to Pro/, "a price or purchase button for a plan that cannot be bought"],
  [/executeRefinedResearchReviewQuery|researchReviewClient/, "the canned Review Mode"],
  [/Attention Is All You Need|FlashAttention-2|Mamba-Edge/, "invented sample research output"],
  [/Canvas AI Global Analysis/, "canned canvas analysis"],
  [/User Upload\b|Abhin Researcher|demo-user/, "an invented person"],
  [/Validated performance surpassing baseline|measurable empirical advancements|Rigorous formulation tailored/, "filler presented as findings"],
  [/Achieved 14-Day Research Streak|Published 2 Briefs on arXiv/, "an invented activity history"],
  [/Fetched manuscript details from arXiv/, "a fetch that does not fetch"]
];

test("bundle-reachable source contains no fabricated product content", () => {
  const files = bundleFiles().filter((f) => !f.startsWith("data/")); // data/samplePapers is only reachable for domain lists
  assert.ok(files.length > 50, "reachability scan found the app");
  const hits = [];
  for (const f of files) {
    const code = stripComments(read(f));
    for (const [re, why] of FORBIDDEN) if (re.test(code)) hits.push(`${f}: ${why} (${re})`);
  }
  assert.deepEqual(hits, []);
});

test("hand-written sample papers and mentors never enter the running app", () => {
  const files = bundleFiles();
  for (const f of files) {
    if (f === "data/samplePapers.ts") continue;
    const code = stripComments(read(f));
    assert.doesNotMatch(code, /(?<![\/\w"])samplePapers\b(?!["'])/, `${f} must not use samplePapers`);
    assert.doesNotMatch(code, /\bmentors as sampleMentors\b|\bcurrentUser as fallbackUser\b/, `${f} must not use sample people`);
  }
});

test("unbuilt features render the unavailable screen, with no sample output", () => {
  for (const f of ["app/review-mode.tsx", "app/canvas.tsx", "app/paywall.tsx", "app/(tabs)/mentors.tsx", "app/chat/[id].tsx"]) {
    const code = read(f);
    assert.match(code, /FeatureUnavailable/, `${f} uses FeatureUnavailable`);
    assert.doesNotMatch(stripComments(code), /setTimeout|useState/, `${f} has no simulated work or state`);
  }
  assert.match(read("app/chat/[id].tsx"), /not connected to an AI model/);
});

test("the paper screen never invents a paper and bases its label on the text it really has", () => {
  const code = stripComments(read("app/paper/[id].tsx"));
  assert.match(code, /not found in your library/i);
  assert.match(code, /BASED ON:/);
  assert.doesNotMatch(code, /\|\| ?"alphaqubit/);
  assert.match(code, /Boolean\(\(paper as any\)\.fullTextRaw\)/, "a PDF link or summary alone is never 'full text'");
});

test("Fetch Link goes through the backend and fills only what the server returns", () => {
  const code = stripComments(read("app/(tabs)/upload.tsx"));
  assert.match(code, /resolvePaperReference/);
  assert.doesNotMatch(code, /setTimeout/);
  const client = read("services/paperResolveClient.ts");
  assert.match(client, /api\.post\("\/api\/v1\/papers\/resolve"/);
});

test("figure extraction returns no figures (none are really extracted) and quality scores are never computed", () => {
  const fig = stripComments(read("services/figureExtractionService.ts"));
  assert.match(fig, /retrieveOriginalFiguresAsync[\s\S]*return \[\]/);
  assert.doesNotMatch(fig, /unsplash|picsum|placeholder|pexels/i);
  const sum = stripComments(read("services/paperSummarizer.ts"));
  assert.doesNotMatch(sum, /qualityScore:\s*\{/, "no fixed quality score object");
  assert.doesNotMatch(sum, /verified:\s*true/);
});

// ------------------------------------------------------------------------------------------------ pure modules
function loadTs(rel, patch) {
  let src = read(rel);
  src = patch(src);
  assert.doesNotMatch(src, /^import /m, "every import was stubbed");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p02-"));
  const file = path.join(dir, path.basename(rel));
  fs.writeFileSync(file, src);
  return require(file);
}

test("read-aloud script is exactly the on-screen brief: no intro, no statistics, nothing for metadata-only", () => {
  const A = loadTs("services/audioService.ts", (s) =>
    s
      .replace(/import \* as Speech from "expo-speech";/, "const Speech = {};")
      .replace(/import AsyncStorage from "@react-native-async-storage\/async-storage";/, "const AsyncStorage = {};")
      .replace(/import \{ GroundedResearchBrief \} from "\.\/paperSummarizer";/, "")
  );
  const brief = {
    title: "A Paper",
    paperCanonicalId: "doi:10.1/x",
    summaryMode: "ABSTRACT_ONLY",
    sections: [
      { sectionId: "s1", title: "01 · The Paper in 30 Seconds", content: "Error fell by 3 % in the test." },
      { sectionId: "s2", title: "02 · Empty", content: "   " }
    ]
  };
  const n = A.generateNarrationScript(brief);
  assert.equal(n.totalChapters, 1);
  assert.equal(n.chapters[0].spokenScript, "The Paper in 30 Seconds. Error fell by 3  percent in the test.");
  const all = JSON.stringify(n);
  for (const bad of ["18.4", "142", "94.2", "Welcome", "Hello"]) assert.ok(!all.includes(bad), bad);
  assert.equal(A.generateNarrationScript({ ...brief, summaryMode: "METADATA_ONLY" }).chapters.length, 0, "metadata-only brief is not read aloud");
  assert.ok(A.generateNarrationScript(brief).estimatedDurationMinutes >= 1);
});

test("resolve client keeps only what the server returned and defaults to CONTENT_UNAVAILABLE", () => {
  const C = loadTs("services/paperResolveClient.ts", (s) => s.replace(/import \{ api \} from "\.\/auth\/firebaseSession";/, "const api = {};"));
  const p = C.parseResolvedPaper({ paperId: "doi:10.1/x", title: " T ", abstract: "A", doi: "10.1/x", venue: null, year: 2021, authors: ["a", 3], coverage: "ABSTRACT_ONLY", coverageNotice: "n" });
  assert.deepEqual({ ...p }, { paperId: "doi:10.1/x", title: "T", abstract: "A", doi: "10.1/x", venue: null, year: 2021, authors: ["a"], coverage: "ABSTRACT_ONLY", coverageNotice: "n" });
  const empty = C.parseResolvedPaper(null);
  assert.equal(empty.title, "");
  assert.equal(empty.abstract, null);
  assert.equal(empty.coverage, "CONTENT_UNAVAILABLE");
  assert.equal(C.parseResolvedPaper({ year: "2021" }).year, null);
});

test("normalizer never guesses a venue, author, year, source or peer-review status", () => {
  const N = loadTs("services/paperNormalizer.ts", (s) => s.replace(/import \{ Paper \} from "@\/types\/models";/, "type Paper = any;"));
  for (const title of ["Attention is all you need", "A clinical patient study", "Something else entirely"]) {
    const p = N.normalizeAndValidatePaper({ id: "x", title, summary: "s" });
    assert.equal(p.venue, "", title);
    assert.equal(p.publisher, "", title);
    assert.equal(p.authorName, "");
    assert.equal(p.pubYear, undefined);
    assert.equal(p.metadataSource, "");
    assert.equal(p.isPeerReviewed, false);
    assert.equal(p.originalLink, "");
  }
  const real = N.normalizeAndValidatePaper({ id: "y", title: "T", venue: "Nature", publisher: "NPG", authors: ["A", "B"], pubYear: 2020, isPeerReviewed: true, metadataSource: "Crossref" });
  assert.deepEqual([real.venue, real.publisher, real.authorName, real.pubYear, real.isPeerReviewed, real.metadataSource], ["Nature", "NPG", "A, B", 2020, true, "Crossref"]);
  assert.equal(N.normalizeAndValidatePaper(null).authorName, "");
});

test("full-text resolver never calls a link 'full text' and never claims a licence or a verification", async () => {
  const R = loadTs("services/fullTextResolver.ts", (s) => s);
  for (const pdfUri of ["https://x.org/a.pdf", "https://arxiv.org/pdf/1", "https://x.org/landing_page"]) {
    const r = await R.verifyAndResolveFullTextAsync({ pdfUri });
    assert.ok(!r.status.startsWith("FULL_TEXT"), pdfUri);
    assert.equal(r.license, undefined);
    assert.equal(r.verifiedAt, undefined);
  }
  assert.equal((await R.verifyAndResolveFullTextAsync({ abstract: "x".repeat(40) })).status, "ABSTRACT_ONLY");
  assert.equal((await R.verifyAndResolveFullTextAsync({ doi: "10.1/x" })).status, "METADATA_ONLY");
  assert.equal((await R.verifyAndResolveFullTextAsync({})).status, "UNAVAILABLE");
});
