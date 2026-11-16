"use strict";
/**
 * Product-quality guards for the app's search client (services/federatedSearch.ts) and offline reading (services/offlineResearchService.ts).
 * Both modules are loaded with their app-only imports replaced by stubs (the files on disk are not modified). No network is used:
 * `fetch` is a scripted fake.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
function loadStubbed(file, replacements) {
  let src = read(file);
  for (const [from, to] of replacements) {
    assert.ok(src.includes(from), `${file}: expected import not found: ${from}`);
    src = src.replace(from, to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-"));
  const out = path.join(dir, path.basename(file));
  fs.writeFileSync(out, src);
  return require(out);
}

// ------------------------------------------------------------------------------------------------ search client
const registered = [];
globalThis.__registerPaperBatch = async (p) => { registered.push(...p); };
const S = loadStubbed("services/federatedSearch.ts", [
  ['import { Paper } from "@/types/models";', "type Paper = any;"],
  ['import { registerPaperBatch } from "./paperRegistry";', "const registerPaperBatch = (globalThis as any).__registerPaperBatch;"]
]);

const jsonRes = (status, body) => ({ status, ok: status < 400, json: async () => body });
const work = (over = {}) => ({
  id: "https://openalex.org/W123", title: "A Study", doi: "https://doi.org/10.1/abc", publication_year: 2022, cited_by_count: 7,
  authorships: [{ author: { display_name: "A One" } }, { author: { display_name: "B Two" } }],
  primary_location: { source: { display_name: "Journal X", host_organization_name: "Publisher Y" }, pdf_url: "https://x.test/p.pdf" },
  primary_topic: { display_name: "Topic T", field: { display_name: "Field F" } },
  open_access: { is_oa: true, oa_url: "https://x.test/oa.pdf" },
  abstract_inverted_index: { Hello: [0], world: [1] },
  ...over
});

test("search URL: documented parameters only, filters composed, page size clamped", () => {
  const u = new URL(S.buildOpenAlexUrl({ query: "graph & edge", page: 2, perPage: 500, sortBy: "citations", openAccessOnly: true, yearRange: [2020, 2018] }));
  assert.equal(u.origin + u.pathname, "https://api.openalex.org/works");
  assert.equal(u.searchParams.get("search"), "graph & edge");
  assert.equal(u.searchParams.get("per_page"), "100");
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("filter"), "is_oa:true,from_publication_date:2018-01-01,to_publication_date:2020-12-31");
  assert.equal(u.searchParams.get("sort"), "cited_by_count:desc");
  const plain = new URL(S.buildOpenAlexUrl({ query: "x" }));
  assert.equal(plain.searchParams.get("filter"), null);
  assert.equal(plain.searchParams.get("sort"), null, "relevance is the provider default; no sort is sent");
  assert.equal(new URL(S.buildOpenAlexUrl({ query: "x", sortBy: "recency" })).searchParams.get("sort"), "publication_date:desc");
  assert.equal(new URL(S.buildOpenAlexUrl({ query: "x", sortBy: "oldest" })).searchParams.get("sort"), "publication_date:asc");
  assert.equal(new URL(S.buildOpenAlexUrl({ query: "x", sortBy: "impact" })).searchParams.get("sort"), "cited_by_count:desc", "'impact' is just citations and is sorted as such");
  assert.equal(new URL(S.buildOpenAlexUrl({ query: "x", page: -4, perPage: 0 })).searchParams.get("page"), "1");
});

test("unsupported filters are reported, never silently dropped", () => {
  assert.deepEqual(S.ignoredFiltersFor({}), []);
  assert.deepEqual(S.ignoredFiltersFor({ sources: ["all"] }), []);
  assert.deepEqual(S.ignoredFiltersFor({ sources: ["openalex"] }), []);
  assert.deepEqual(S.ignoredFiltersFor({ sources: ["arxiv"], domain: "Physics" }), ["domain", "sources"]);
});

test("mapping: current OpenAlex fields are used; unknown stays unknown", () => {
  const p = S.mapOpenAlexWork(work(), 0);
  assert.equal(p.id, "openalex-W123");
  assert.equal(p.doi, "10.1/abc");
  assert.equal(p.organization, "Journal X", "venue comes from primary_location.source (host_venue was removed upstream)");
  assert.equal(p.publisher, "Publisher Y");
  assert.equal(p.domain, "Field F", "topic comes from primary_topic (concepts are deprecated)");
  assert.equal(p.summary, "Hello world");
  assert.equal(p.pdfUri, "https://x.test/oa.pdf");
  assert.equal(p.authorName, "A One, B Two");
  const bare = S.mapOpenAlexWork({ id: "https://openalex.org/W9" }, 3);
  assert.equal(bare.pubYear, undefined, "no invented year");
  assert.equal(bare.authorName, "", "no invented author");
  assert.equal(bare.summary, "", "no invented abstract");
  assert.equal(bare.pdfUri, undefined);
  assert.equal(bare.is_open_access, false);
});

test("status classes", () => {
  assert.equal(S.classifyHttpStatus(200), "ok");
  assert.equal(S.classifyHttpStatus(429), "rate_limited");
  assert.equal(S.classifyHttpStatus(503), "server_error");
  assert.equal(S.classifyHttpStatus(400), "bad_response");
});

test("fetchOpenAlexPage: cache, no retry on 429, one retry on transient failure, timeout, de-duplication", async () => {
  const ok = jsonRes(200, { results: [work()] });
  const mk = (...script) => {
    const calls = [];
    const f = async (url, init) => {
      calls.push(url);
      const next = script[Math.min(calls.length - 1, script.length - 1)];
      if (typeof next === "function") return next(init);
      if (next instanceof Error) throw next;
      return next;
    };
    f.calls = calls;
    return f;
  };
  const opts = (f, extra = {}) => ({ doFetch: f, retryDelayMs: 1, ...extra });

  S.clearSearchCache();
  let f = mk(ok);
  let r = await S.fetchOpenAlexPage({ query: "a" }, opts(f));
  assert.equal(r.status, "ok"); assert.equal(r.fromCache, false); assert.equal(r.papers.length, 1);
  r = await S.fetchOpenAlexPage({ query: "a" }, opts(f));
  assert.equal(r.fromCache, true); assert.equal(f.calls.length, 1, "second identical search is served from the cache");
  r = await S.fetchOpenAlexPage({ query: "a" }, opts(f, { now: () => Date.now() + S.SEARCH_CACHE_TTL_MS + 1 }));
  assert.equal(r.fromCache, false); assert.equal(f.calls.length, 2, "the cache expires");

  S.clearSearchCache();
  f = mk(jsonRes(429, {}));
  r = await S.fetchOpenAlexPage({ query: "b" }, opts(f));
  assert.equal(r.status, "rate_limited"); assert.equal(f.calls.length, 1, "429 is not retried (it can mean the daily credit budget is spent)");
  r = await S.fetchOpenAlexPage({ query: "b" }, opts(f));
  assert.equal(f.calls.length, 2, "a failure is never cached");

  S.clearSearchCache();
  f = mk(jsonRes(503, {}), ok);
  r = await S.fetchOpenAlexPage({ query: "c" }, opts(f));
  assert.equal(r.status, "ok"); assert.equal(f.calls.length, 2, "one retry after a 5xx");

  S.clearSearchCache();
  f = mk(new TypeError("Network request failed"));
  r = await S.fetchOpenAlexPage({ query: "d" }, opts(f));
  assert.equal(r.status, "network"); assert.equal(f.calls.length, 2);

  S.clearSearchCache();
  f = mk((init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
  r = await S.fetchOpenAlexPage({ query: "e" }, opts(f, { timeoutMs: 20 }));
  assert.equal(r.status, "timeout", "a hung request ends instead of leaving the screen spinning");

  S.clearSearchCache();
  f = mk({ status: 200, ok: true, json: async () => { throw new SyntaxError("bad json"); } });
  assert.equal((await S.fetchOpenAlexPage({ query: "f" }, opts(f))).status, "bad_response");
  f = mk(jsonRes(200, { nope: true }));
  assert.equal((await S.fetchOpenAlexPage({ query: "g" }, opts(f))).status, "bad_response");

  S.clearSearchCache();
  let release;
  const gate = new Promise((res) => { release = res; });
  f = mk(async () => { await gate; return ok; });
  const both = Promise.all([S.fetchOpenAlexPage({ query: "h" }, opts(f)), S.fetchOpenAlexPage({ query: "h" }, opts(f))]);
  release();
  await both;
  assert.equal(f.calls.length, 1, "two identical in-flight searches share one request");
});

test("executeLiveFederatedSearch only talks to OpenAlex, never to the backend search route", async () => {
  S.clearSearchCache();
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return jsonRes(200, { results: [work()] }); };
  try {
    const r = await S.executeLiveFederatedSearch("graph pruning", 1, { sources: ["arxiv"], sortBy: "recency" });
    assert.equal(r.status, "ok");
    assert.deepEqual(r.ignoredFilters, ["sources"]);
    assert.equal(r.papers.length, 1);
    assert.equal(registered.length, 1, "results are registered with the local paper registry");
    assert.equal(seen.length, 1);
    assert.ok(seen.every((u) => u.startsWith("https://api.openalex.org/works?")), seen.join(","));
    assert.ok(!seen.some((u) => u.includes("/api/v1/search")));
    const empty = await S.executeLiveFederatedSearch("   ");
    assert.equal(empty.papers.length, 0); assert.equal(seen.length, 1, "a blank query makes no request");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ------------------------------------------------------------------------------------------------ offline reading
const store = {};
globalThis.__OFFLINE_STORE__ = {
  async getItem(k) { return k in store ? store[k] : null; },
  async setItem(k, v) { store[k] = String(v); },
  async removeItem(k) { delete store[k]; }
};
const O = loadStubbed("services/offlineResearchService.ts", [
  ['import AsyncStorage from "@react-native-async-storage/async-storage";', "const AsyncStorage = (globalThis as any).__OFFLINE_STORE__;"],
  ['import type { GroundedResearchBrief } from "./paperSummarizer";', "type GroundedResearchBrief = any;"]
]);
const { OfflineResearchService: Svc } = O;

const brief = (over = {}) => ({
  paperId: "p1", title: "T", authors: ["A"], summaryMode: "ABSTRACT_ONLY", sections: [], figures: [], keyNumbers: [], takeaways: [],
  allClaims: [
    { claimId: "c1", text: "It works.", evidence: [{ chunkId: "k1", section: "RESULTS", supportingTextSnippet: "It works well." }, { chunkId: "k2", supportingTextSnippet: "   " }] },
    { claimId: "c2", text: "No passage.", evidence: [] }
  ],
  ...over
});
const input = (over = {}) => ({ paperId: "openalex-W1", title: "T", authors: ["A"], sourceUrl: "https://doi.org/10.1/x", brief: brief(), ...over });
const pdfBytes = (n = 4096) => {
  const b = new Uint8Array(n).fill(32);
  b.set(Buffer.from("%PDF-1.7\n"));
  b.set(Buffer.from("\n%%EOF\n"), n - 8);
  return b;
};

test("sha256: standard vectors and agreement with node:crypto across block boundaries", () => {
  const enc = (s) => new Uint8Array(Buffer.from(s));
  assert.equal(O.sha256Hex(enc("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(O.sha256Hex(enc("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(O.sha256Hex(enc("a".repeat(1000000))), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 5000]) {
    const d = crypto.randomBytes(n);
    assert.equal(O.sha256Hex(new Uint8Array(d)), crypto.createHash("sha256").update(d).digest("hex"), `length ${n}`);
  }
});

test("PDF verification rejects everything that is not a complete PDF with the expected hash", () => {
  assert.equal(O.verifyPdfBytes(new Uint8Array(0)).reason, "EMPTY");
  assert.equal(O.verifyPdfBytes(pdfBytes(100)).reason, "TOO_SMALL");
  const html = new Uint8Array(4096).fill(32); html.set(Buffer.from("<!DOCTYPE html><html>"));
  assert.equal(O.verifyPdfBytes(html).reason, "NOT_A_PDF");
  const cut = pdfBytes(4096); cut.fill(32, 4096 - 8);
  assert.equal(O.verifyPdfBytes(cut).reason, "TRUNCATED");
  assert.equal(O.verifyPdfBytes(new Uint8Array(O.MAX_PDF_BYTES + 1)).reason, "TOO_LARGE");
  const good = pdfBytes();
  assert.equal(O.verifyPdfBytes(good, "0".repeat(64)).reason, "HASH_MISMATCH");
  const v = O.verifyPdfBytes(good, O.sha256Hex(good).toUpperCase());
  assert.equal(v.ok, true); assert.equal(v.bytes, 4096);
});

test("saving a brief keeps citations and metadata, invents no licence and caches no PDF", async () => {
  for (const k of Object.keys(store)) delete store[k];
  await Svc.initAsync();
  const rec = await Svc.saveBriefAsync(input({ isOpenAccess: undefined }));
  assert.equal(rec.license, null, "no licence supplied -> unknown, not 'CC-BY-4.0' and not 'Closed Access'");
  assert.equal(rec.isOpenAccess, null);
  assert.deepEqual(rec.pdf, { status: "NOT_DOWNLOADED", openUrl: "https://doi.org/10.1/x" });
  assert.equal(rec.briefOrigin, "ON_DEVICE_RULES");
  assert.equal(rec.textBasis, "ABSTRACT_ONLY");
  assert.deepEqual(rec.citations.map((c) => [c.claimId, c.chunkId, c.passage]), [["c1", "k1", "It works well."]], "only claims with a real passage are citations");
  const withLicense = await Svc.saveBriefAsync(input({ paperId: "openalex-W2", isOpenAccess: true, license: " cc-by " }));
  assert.equal(withLicense.license, "cc-by"); assert.equal(withLicense.isOpenAccess, true);
  assert.equal(withLicense.pdf.status, "NOT_DOWNLOADED", "open access does not mean downloaded");
  assert.ok(JSON.parse(store[O.OFFLINE_STORAGE_KEY]).length === 2, "persisted");
});

test("a PDF is recorded only after the downloaded bytes are verified", async () => {
  for (const k of Object.keys(store)) delete store[k];
  await Svc.initAsync();
  await Svc.saveBriefAsync(input());
  const html = new Uint8Array(4096).fill(32); html.set(Buffer.from("<html>"));
  assert.equal((await Svc.recordVerifiedPdf("openalex-W1", "file:///a.pdf", html)).ok, false);
  assert.equal(Svc.get("openalex-W1").pdf.status, "NOT_DOWNLOADED", "a bad file never flips the flag");
  assert.equal((await Svc.recordVerifiedPdf("openalex-W1", "file:///a.pdf", pdfBytes(), "f".repeat(64))).reason, "HASH_MISMATCH");
  assert.equal(Svc.get("openalex-W1").pdf.status, "NOT_DOWNLOADED");
  assert.equal((await Svc.recordVerifiedPdf("openalex-W404", "file:///a.pdf", pdfBytes())).reason, "NO_SAVED_RECORD");
  assert.equal((await Svc.recordVerifiedPdf("openalex-W1", "", pdfBytes())).reason, "NO_LOCAL_FILE");
  const good = pdfBytes();
  assert.equal((await Svc.recordVerifiedPdf("openalex-W1", "file:///a.pdf", good, O.sha256Hex(good))).ok, true);
  const pdf = Svc.get("openalex-W1").pdf;
  assert.equal(pdf.status, "VERIFIED"); assert.equal(pdf.sha256, O.sha256Hex(good)); assert.equal(pdf.bytes, 4096);
  const again = await Svc.saveBriefAsync(input({ title: "T2" }));
  assert.equal(again.pdf.status, "VERIFIED", "re-saving the brief keeps a verified PDF");
});

test("loading drops the old format and any record that claims a PDF without proof", async () => {
  for (const k of Object.keys(store)) delete store[k];
  store.shords_offline_cached_papers = JSON.stringify([{ canonicalId: "x", license: "CC-BY-4.0", pdfCached: true }]);
  const good = { schemaVersion: 2, paperId: "g", title: "G", brief: {}, citations: [], pdf: { status: "NOT_DOWNLOADED" } };
  const liar = { schemaVersion: 2, paperId: "l", title: "L", brief: {}, citations: [], pdf: { status: "VERIFIED", localUri: "file:///x", bytes: 5000 } };
  store[O.OFFLINE_STORAGE_KEY] = JSON.stringify([good, liar, { junk: true }, null]);
  const list = await Svc.initAsync();
  assert.deepEqual(list.map((r) => r.paperId), ["g"]);
  assert.equal("shords_offline_cached_papers" in store, false, "the old, untrustworthy cache is discarded");
  store[O.OFFLINE_STORAGE_KEY] = "{not json";
  assert.deepEqual(await Svc.initAsync(), []);
  assert.equal(await Svc.removeAsync("nope"), false);
});
