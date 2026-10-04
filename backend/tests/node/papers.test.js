"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const id = require("../../papers/identity");
const markup = require("../../papers/markup");
const { extractJats, extractHtmlArticle, normalizeSectionName } = require("../../papers/extract");
const { chunkDocument, documentContentHash, splitSentences, MAX_CHARS } = require("../../papers/chunker");
const prov = require("../../papers/providers");
const fx = require("./paperFixtures");

// ------------------------------------------------------------------ identity
test("identity: every spelling of a DOI maps to one canonical id", () => {
  const want = `doi:${fx.FIXTURE_DOI}`;
  for (const v of [fx.FIXTURE_DOI, `doi:${fx.FIXTURE_DOI}`, `https://doi.org/${fx.FIXTURE_DOI}`, `https://dx.doi.org/${fx.FIXTURE_DOI.toUpperCase()}`, `  DOI: ${fx.FIXTURE_DOI}  `]) {
    assert.equal(id.canonicalPaperId({ doi: v }), want, v);
  }
  assert.equal(id.parsePaperRef(`https://doi.org/${fx.FIXTURE_DOI}`).canonicalId, want);
  assert.equal(id.parsePaperRef(want).canonicalId, want);
});

test("identity: arXiv ids, versions, URLs and DataCite DOIs are one identity", () => {
  const want = "arxiv:1706.03762";
  for (const input of [{ arxivId: "1706.03762" }, { arxivId: "arXiv:1706.03762v5" }, { arxivId: "https://arxiv.org/abs/1706.03762v7" }, { arxivId: "https://arxiv.org/pdf/1706.03762v1.pdf" }, { doi: "10.48550/arXiv.1706.03762" }]) {
    assert.equal(id.canonicalPaperId(input), want, JSON.stringify(input));
  }
  assert.equal(id.canonicalPaperId({ arxivId: "hep-th/9901001v2" }), "arxiv:hep-th/9901001");
  assert.equal(id.parsePaperRef("arXiv:1706.03762v2").canonicalId, want);
});

test("identity: hierarchy is DOI > PMID > arXiv > title+author+year", () => {
  const all = { doi: "10.1000/abc", pmid: "123", arxivId: "1706.03762", title: "Some Long Enough Title", authors: ["Smith, J."], pubYear: 2020 };
  assert.equal(id.canonicalPaperId(all), "doi:10.1000/abc");
  assert.equal(id.canonicalPaperId({ ...all, doi: undefined }), "pmid:123");
  assert.equal(id.canonicalPaperId({ ...all, doi: undefined, pmid: undefined }), "arxiv:1706.03762");
  assert.equal(id.canonicalPaperId({ ...all, doi: undefined, pmid: undefined, arxivId: undefined }), "title:some long enough title-smith-2020");
});

test("identity: stable and never invented (no random id, no default year)", () => {
  const p = { title: "A Perfectly Reasonable Title", authors: ["Doe, Jane"], pubYear: 2019 };
  assert.equal(id.canonicalPaperId(p), id.canonicalPaperId({ ...p }));
  assert.equal(id.canonicalPaperId({ title: "A Perfectly Reasonable Title" }), null, "no year: not an identity");
  assert.equal(id.canonicalPaperId({ title: "x", pubYear: 2020 }), null, "title too short");
  assert.equal(id.canonicalPaperId({}), null);
  assert.equal(id.canonicalPaperId(null), null);
  // punctuation and accents do not create a second identity for the same title
  assert.equal(id.canonicalPaperId({ title: "Résumé: A Study!", authors: ["Doe"], pubYear: 2020 }), id.canonicalPaperId({ title: "Resume - a study", authors: ["Doe"], pubYear: 2020 }));
});

test("identity: input validation rejects anything that is not a paper reference", () => {
  const bad = ["", " ", "../../etc/passwd", "doi:", "doi:10.1000", "10.1/short", "pmid:abc", "arxiv:not-an-id", "title:x", "'; DROP TABLE papers;--", "x".repeat(300), "https://evil.example/10.1000/abc", null, undefined, 42, {}, []];
  for (const b of bad) assert.equal(id.parsePaperRef(b), null, String(b).slice(0, 30));
  assert.equal(id.isCanonicalPaperId("doi:10.1000/abc"), true);
  assert.equal(id.isCanonicalPaperId("doi:10.1000/abc/../x?y"), false);
  assert.equal(id.isCanonicalPaperId("pmid:1234567890"), false);
});

test("identity: chunk ids tie a chunk to exactly one paper", () => {
  const pid = "doi:10.9999/fixture.sparse.2021";
  const cid = id.makeChunkId(pid, 7);
  assert.deepEqual(id.parseChunkId(cid), { paperId: pid, ordinal: 7 });
  assert.equal(id.parseChunkId("doi:10.9999/other_chunk_7").paperId, "doi:10.9999/other");
  for (const bad of ["chunk_1842", "1842", `${pid}_chunk_0`, `${pid}_chunk_`, `${pid}_chunk_-1`, `${pid}_chunk_1.5`, `${pid}`, "", "x_chunk_1", `${pid}_chunk_1; DROP`, `${pid}_chunk_999999`, null, 5])
    assert.equal(id.parseChunkId(bad), null, String(bad));
});

test("identity parity: services/deduplication.ts (frontend) and backend/papers/identity.js agree on a shared corpus", async () => {
  const mod = await import(path.join(__dirname, "../../../services/deduplication.ts"));
  const corpus = [
    { doi: "https://doi.org/10.1038/NATURE14539" }, { doi: "10.48550/arXiv.1706.03762" }, { pmid: "25719670" }, { pmid: 25719670 }, { arxivId: "arXiv:1706.03762v5" }, { arxivId: "hep-th/9901001v2" },
    { doi: "not a doi", pmid: "12", title: "x" }, { title: "Résumé: A Study!", authors: ["Doe, Jane"], pubYear: 2020 }, { title: "Attention Is All You Need", authors: ["Vaswani, Ashish"], pubYear: 2017 },
    { title: "Attention Is All You Need", authorName: "Ashish Vaswani", pubYear: 2017 }, { title: "No year here" }, {}, { doi: "10.1002/(SICI)1097-0258(19980815/30)17:15/16<1661::AID-SIM968>3.0.CO;2-2" },
    { title: "A".repeat(80), authors: ["Zeta"], pubYear: 1999 }, { title: "Short", authors: ["Zeta"], pubYear: 1999 }
  ];
  for (const c of corpus) assert.equal(mod.strictCanonicalPaperId(c), id.canonicalPaperId(c), JSON.stringify(c).slice(0, 80));
  // local grouping ids never collide with backend identities
  assert.match(mod.generateCanonicalPaperId({ id: "openalex-W1", title: "x" }), /^local:/);
  assert.equal(id.isCanonicalPaperId(mod.generateCanonicalPaperId({ id: "openalex-W1", title: "x" })), false);
});

// ------------------------------------------------------------------ markup + extraction
test("markup: entities, CDATA, comments and script/style handling", () => {
  const root = markup.parse('<a><!-- c --><b x="1 &amp; 2">T &lt;&gt; &#955; &#x3bb; &amp;amp; &unknown;</b><script>alert(1)</script><style>p{}</style><![CDATA[raw <x>]]><br/>tail</a>');
  const a = markup.findFirst(root, "a");
  const text = markup.textOf(a);
  assert.match(text, /T <> λ λ &amp; &unknown;/);
  assert.match(text, /raw <x>/);
  assert.doesNotMatch(text, /alert|p\{\}/);
  assert.equal(markup.findFirst(root, "b").attrs.x, "1 & 2");
});

test("markup: pathological input is bounded (depth cap, no catastrophic backtracking)", () => {
  assert.throws(() => markup.parse("<a>".repeat(500)), /MARKUP_TOO_COMPLEX/);
  const t0 = Date.now();
  markup.parse('<a href="x '.repeat(20000));
  markup.parse("<".repeat(200000));
  markup.parse('<a "'.repeat(50000));
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0}ms`);
});

test("extract JATS: title, abstract, nested section path, table, figure; inline citations removed", () => {
  const d = extractJats(fx.jats());
  assert.equal(d.ok, true);
  assert.equal(d.title, fx.TITLE);
  assert.match(d.abstract, /^Long-context language models lose recall/);
  const headings = d.sections.map((s) => s.heading);
  assert.ok(headings.includes("1. Introduction"));
  assert.ok(headings.includes("2. Methods > 2.1 Training setup"));
  assert.ok(d.sections.every((s) => !/\[1\]/.test(s.paragraphs.join(" "))), "bibr xrefs are removed from the text");
  assert.equal(d.tables.length, 1);
  assert.deepEqual(d.tables[0].headers, ["Model", "Accuracy (%)", "Latency (s)"]);
  assert.deepEqual(d.tables[0].rows[2], ["SAR", "87.4", "18.7"]);
  assert.match(d.figures[0].caption, /evidence distance/);
  assert.equal(extractJats("<html><body>not jats</body></html>").ok, false);
});

test("extract HTML (arXiv/LaTeXML): sections, subsection path, math alttext, tables; scripts never read", () => {
  const d = extractHtmlArticle(fx.arxivHtml());
  assert.equal(d.title, fx.TITLE);
  assert.match(d.abstract, /^Long-context language models lose recall/);
  const heads = d.sections.map((s) => s.heading);
  assert.deepEqual(heads.slice(0, 4), ["Introduction", "Methods", "Methods > Routing objective", "Results"]);
  const objective = d.sections.find((s) => s.heading === "Methods > Routing objective");
  assert.match(objective.paragraphs[0], /L = L_\{task\} \+ \\lambda L_\{route\}/);
  assert.equal(d.tables.length, 1);
  assert.deepEqual(d.tables[0].rows[1], ["SAR", "87.4"]);
  assert.equal(JSON.stringify(d).includes("should never be read"), false);
});

test("section classifier: taxonomy mapping and boilerplate sections", () => {
  const m = { "Introduction": "INTRODUCTION", "2. Related Work": "RELATED_WORK", "Experimental Setup": "EXPERIMENTAL_SETUP", "Results and Discussion": "RESULTS", "Limitations": "LIMITATIONS", "Conclusions": "CONCLUSION", "Future Work": "FUTURE_WORK", "References": "REFERENCES", "Acknowledgements": "REFERENCES", "Data availability": "REFERENCES", "Funding": "REFERENCES", "Our Model": "METHODOLOGY", "Zebra": "OTHER", "": "OTHER" };
  for (const [h, want] of Object.entries(m)) assert.equal(normalizeSectionName(h), want, h);
});

// ------------------------------------------------------------------ chunking
test("chunker: ids, sections, boilerplate dropped, tables kept whole, nothing crosses a section", () => {
  const doc = extractJats(fx.jats());
  const pid = `doi:${fx.FIXTURE_DOI}`;
  const { chunks, droppedSections } = chunkDocument(pid, doc);
  assert.ok(chunks.length >= 8);
  chunks.forEach((c, i) => {
    assert.equal(c.chunkId, `${pid}_chunk_${i + 1}`);
    assert.equal(c.paperId, pid);
    assert.ok(c.text.length <= MAX_CHARS + 20, `chunk ${c.chunkId} has ${c.text.length} chars`);
    assert.deepEqual(id.parseChunkId(c.chunkId), { paperId: pid, ordinal: i + 1 });
  });
  assert.equal(chunks[0].section, "ABSTRACT");
  assert.ok(droppedSections.some((h) => /Acknowledgements/.test(h)) && droppedSections.some((h) => /Data availability/.test(h)));
  assert.ok(!chunks.some((c) => /We thank the reviewers/.test(c.text)), "acknowledgements are not evidence");
  const table = chunks.find((c) => c.section === "TABLE");
  assert.match(table.text, /Columns: Model \| Accuracy \(%\) \| Latency \(s\)/);
  assert.match(table.text, /SAR \| 87\.4 \| 18\.7/);
  // Methods text and Results text never share a chunk
  for (const c of chunks) assert.ok(!(/dot product/.test(c.text) && /exact-match accuracy/.test(c.text)), "a chunk spans two sections");
  assert.ok(chunks.some((c) => c.section === "RESULTS" && /87\.4 percent/.test(c.text)));
});

test("chunker: long paragraphs split at sentence boundaries; abbreviations are not sentence ends", () => {
  assert.deepEqual(splitSentences("Smith et al. showed X. Fig. 3 shows Y. Then we measured Z."), ["Smith et al. showed X.", "Fig. 3 shows Y.", "Then we measured Z."]);
  const sentence = "This sentence reports a measured value of 12.5 units in the second condition of the study.";
  const long = Array.from({ length: 80 }, () => sentence).join(" ");
  const { chunks } = chunkDocument("pmid:1", { sections: [{ heading: "Results", leaf: "Results", paragraphs: [long] }] });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(c.text.length <= MAX_CHARS + 5);
    assert.ok(c.text.trim().endsWith("."), "split at a sentence end");
  }
  // an unbroken token run longer than the limit is hard-split, never dropped
  const blob = "word ".repeat(1200);
  const r = chunkDocument("pmid:2", { sections: [{ heading: "Methods", leaf: "Methods", paragraphs: [blob] }] });
  assert.equal(r.chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(), blob.replace(/\s+/g, " ").trim());
});

test("chunker: abstract-only mode produces only abstract chunks; content hash tracks every change", () => {
  const doc = extractJats(fx.jats());
  const pid = "pmid:5";
  const abs = chunkDocument(pid, doc, { abstractOnly: true });
  assert.ok(abs.chunks.length >= 1 && abs.chunks.every((c) => c.section === "ABSTRACT"));
  const a = chunkDocument(pid, doc).chunks;
  const b = chunkDocument(pid, doc).chunks;
  assert.equal(documentContentHash(a), documentContentHash(b), "deterministic");
  const changed = JSON.parse(JSON.stringify(doc));
  const res = changed.sections.find((x) => /Results/.test(x.heading));
  res.paragraphs[0] = res.paragraphs[0].replace("87.4", "87.5");
  assert.ok(res.paragraphs[0].includes("87.5"));
  assert.notEqual(documentContentHash(chunkDocument(pid, changed).chunks), documentContentHash(a), "one changed digit changes the hash");
  assert.notEqual(documentContentHash(chunkDocument("pmid:6", doc).chunks), documentContentHash(a), "a different paper id changes the hash");
});

// ------------------------------------------------------------------ providers
test("provider parsers: OpenAlex, Europe PMC, arXiv", () => {
  const oa = prov.parseOpenAlexWork(fx.openAlexWork());
  assert.equal(oa.doi, fx.FIXTURE_DOI);
  assert.equal(oa.pmid, fx.FIXTURE_PMID);
  assert.equal(oa.pmcid, fx.FIXTURE_PMCID);
  assert.equal(oa.abstract, fx.ABSTRACT);
  assert.deepEqual(oa.authors, fx.AUTHORS);
  assert.equal(oa.isOpenAccess, true);
  const ep = prov.parseEuropePmcResult(fx.europePmcSearch().resultList.result[0]);
  assert.equal(ep.title, fx.TITLE);
  assert.equal(ep.isOpenAccess, true);
  assert.equal(ep.pmcid, fx.FIXTURE_PMCID);
  assert.equal(prov.parseEuropePmcResult({ ...fx.europePmcSearch().resultList.result[0], isOpenAccess: "N" }).isOpenAccess, false);
  const ax = prov.parseArxivAtom(fx.arxivAtom());
  assert.equal(ax.arxivId, fx.FIXTURE_ARXIV);
  assert.equal(ax.year, 2021);
  assert.equal(ax.abstract, fx.ABSTRACT);
  assert.equal(prov.parseArxivAtom(fx.arxivNotFound), null, "arXiv's 'Error' entry is not a paper");
  assert.equal(prov.parseOpenAlexWork(null), null);
});

function fakeHttp(routes) {
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    for (const [needle, res] of routes) {
      if (url.includes(needle)) {
        const r = typeof res === "function" ? res(url) : res;
        if (r instanceof Error) throw r;
        return { status: r.status ?? 200, headers: r.headers || { "content-type": r.type || "application/json" }, body: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
      }
    }
    return { status: 404, headers: {}, body: "{}" };
  };
  http.calls = calls;
  return http;
}
const ok = (body, type) => ({ status: 200, body, type });

test("fetchMetadata(doi): merges OpenAlex + Europe PMC and the record lists the requested DOI", async () => {
  const http = fakeHttp([["api.openalex.org/works/doi:", ok(fx.openAlexWork())], ["europepmc/webservices/rest/search", ok(fx.europePmcSearch())]]);
  const p = prov.createProviders({ http, env: {} });
  const m = await p.fetchMetadata(id.parsePaperRef(`doi:${fx.FIXTURE_DOI}`));
  assert.equal(m.doi, fx.FIXTURE_DOI);
  assert.equal(m.pmcid, fx.FIXTURE_PMCID);
  assert.deepEqual(m.providers.sort(), ["EuropePMC", "OpenAlex"]);
  assert.equal(m.isOpenAccess, true);
});

test("fetchMetadata: a provider answering with a DIFFERENT work is rejected (no wrong-paper identity)", async () => {
  const http = fakeHttp([["api.openalex.org/works/doi:", ok(fx.openAlexWork({ doi: `https://doi.org/${fx.OTHER_DOI}`, ids: { doi: `https://doi.org/${fx.OTHER_DOI}` } }))], ["europepmc/webservices/rest/search", ok(fx.europePmcSearch({ doi: fx.OTHER_DOI }))]]);
  const p = prov.createProviders({ http, env: {} });
  assert.equal(await p.fetchMetadata(id.parsePaperRef(`doi:${fx.FIXTURE_DOI}`)), null);
});

test("fetchMetadata(title): accepted only if the candidate's canonical id equals the requested id", async () => {
  const want = id.canonicalPaperId({ title: fx.TITLE, authors: [fx.AUTHORS[0]], pubYear: 2021 });
  const http = fakeHttp([["api.openalex.org/works?search=", ok({ results: [fx.openAlexWork({ title: "A Completely Different Paper About Soup", publication_year: 2021 }), fx.openAlexWork()] })]]);
  const p = prov.createProviders({ http, env: {} });
  const m = await p.fetchMetadata(id.parsePaperRef(want));
  assert.equal(m.title, fx.TITLE);
  const none = await prov.createProviders({ http: fakeHttp([["api.openalex.org/works?search=", ok({ results: [fx.openAlexWork({ publication_year: 2015 })] })]]), env: {} }).fetchMetadata(id.parsePaperRef(want));
  assert.equal(none, null, "same title, different year is a different identity");
});

test("providers: outage is an error (retryable), 'not found' is null; the two are never confused", async () => {
  const mk = (res) => prov.createProviders({ http: fakeHttp([["", res]]), env: {} });
  const ref = id.parsePaperRef(`pmid:${fx.FIXTURE_PMID}`);
  assert.equal(await mk({ status: 404, body: {} }).fetchMetadata(ref), null);
  for (const status of [500, 502, 503, 429]) {
    await assert.rejects(() => mk({ status, body: {} }).fetchMetadata(ref), (e) => e instanceof prov.ProviderError && e.retryable === true && e.httpStatus === status);
  }
  await assert.rejects(() => mk(new prov.ProviderError("TIMEOUT", "t")).fetchMetadata(ref), (e) => e.code === "TIMEOUT" && e.retryable);
  await assert.rejects(() => mk({ status: 200, body: "<html>not json</html>" }).fetchMetadata(ref), (e) => e.code === "BAD_PAYLOAD" && e.retryable === false);
});

test("fetchFullText: Europe PMC JATS only for open-access records with a PMCID; arXiv HTML for arXiv ids", async () => {
  const http = fakeHttp([["/PMC9900001/fullTextXML", ok(fx.jats(), "application/xml")], ["arxiv.org/html/2101.00001", ok(fx.arxivHtml(), "text/html; charset=utf-8")]]);
  const p = prov.createProviders({ http, env: {} });
  const a = await p.fetchFullText({ pmcid: fx.FIXTURE_PMCID, isOpenAccess: true, license: "cc by" });
  assert.equal(a.format, "JATS_XML");
  assert.equal(a.license, "cc by");
  const before = http.calls.length;
  assert.equal(await p.fetchFullText({ pmcid: fx.FIXTURE_PMCID, isOpenAccess: false }), null, "not open access: not even requested");
  assert.equal(http.calls.length, before);
  const b = await p.fetchFullText({ arxivId: fx.FIXTURE_ARXIV, isOpenAccess: true });
  assert.equal(b.format, "HTML");
  assert.equal(await p.fetchFullText({ doi: fx.FIXTURE_DOI }), null);
  // a landing page that is not an article is not accepted as full text
  const lp = prov.createProviders({ http: fakeHttp([["arxiv.org/html/", ok("<html><body>Download PDF</body></html>", "text/html")]]), env: {} });
  assert.equal(await lp.fetchFullText({ arxivId: fx.FIXTURE_ARXIV }), null);
});

test("HTTP layer: only allow-listed https hosts are ever contacted (no SSRF), without touching the network", async () => {
  const http = prov.createHttpsGet();
  for (const url of ["https://evil.example/x", "http://api.openalex.org/works/1", "https://api.openalex.org:8443/x", "https://user:pw@api.openalex.org/x", "https://127.0.0.1/x", "https://localhost/x", "file:///etc/passwd", "https://api.openalex.org.evil.example/x", "not a url"]) {
    await assert.rejects(() => http(url), (e) => e instanceof prov.ProviderError && (e.code === "HOST_NOT_ALLOWED" || e.code === "BAD_URL"), url);
  }
});

test("production code never imports the test fixtures", () => {
  const roots = ["backend/app.js", "backend/runtime.js", "backend/papers", "backend/jobs", "backend/llm", "backend/security", "backend/data", "backend/readiness.js", "backend/start_local_server.js"];
  const files = [];
  const walk = (p) => {
    const full = path.join(__dirname, "../../..", p);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) fs.readdirSync(full).forEach((f) => walk(path.join(p, f)));
    else if (full.endsWith(".js")) files.push(full);
  };
  roots.forEach(walk);
  assert.ok(files.length > 15);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /paperFixtures|FIXTURE_/, f);
});
