"use strict";
/** Paper retrieval -> coverage -> chunks -> PostgreSQL, against real PostgreSQL + Redis with provider payload fixtures. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { PgPool } = require("../../data/pgClient");
const { RedisClient } = require("../../data/redisClient");
const { createPaperService, PaperError, TTL_MS } = require("../../papers/paperService");
const { createProviders, ProviderError } = require("../../papers/providers");
const { parseChunkId } = require("../../papers/identity");
const { infraSkip, resetInfra, silentLogger } = require("./helpers");
const fx = require("./paperFixtures");

const skip = infraSkip();
const ok = (body, type = "application/json") => ({ status: 200, body, type });

function fakeHttp(routes) {
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    for (const [needle, res] of routes) {
      if (url.includes(needle)) {
        const r = typeof res === "function" ? res(url) : res;
        if (r instanceof Error) throw r;
        return { status: r.status ?? 200, headers: { "content-type": r.type || "application/json" }, body: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
      }
    }
    return { status: 404, headers: {}, body: "{}" };
  };
  http.calls = calls;
  http.count = (needle) => calls.filter((u) => u.includes(needle)).length;
  return http;
}

const OA_ROUTES = (over = {}) => [
  ["api.openalex.org/works/doi:", ok(fx.openAlexWork(over.work))],
  ["europepmc/webservices/rest/search", ok(fx.europePmcSearch(over.epmc))],
  ["/fullTextXML", over.fullText || ok(fx.jats(), "application/xml")]
];

test("paper retrieval service (real PostgreSQL + Redis)", { skip }, async (t) => {
  await resetInfra();
  const pool = new PgPool({ url: process.env.TEST_DATABASE_URL, max: 6 });
  const redis = new RedisClient({ url: process.env.TEST_REDIS_URL });
  t.after(async () => { await pool.end(); await redis.close(); });
  let offset = 0;
  const clockNow = () => Date.now() + offset;
  const mk = (routes, extra = {}) => {
    const http = fakeHttp(routes);
    const svc = createPaperService({ pool, redis, providers: createProviders({ http, env: {} }), now: clockNow, logger: silentLogger, pollMs: 20, ...extra });
    return { svc, http };
  };
  const reset = async () => { await pool.query("DELETE FROM papers"); await redis.command("FLUSHDB"); offset = 0; };
  const DOI = `doi:${fx.FIXTURE_DOI}`;

  await t.test("FULL_TEXT: open-access JATS is retrieved, verified, chunked and stored; the second call never touches a provider", async () => {
    await reset();
    const { svc, http } = mk(OA_ROUTES());
    const first = await svc.resolve(DOI);
    assert.equal(first.source, "RETRIEVED");
    const p = first.paper;
    assert.equal(p.paperId, DOI);
    assert.equal(p.coverage, "FULL_TEXT");
    assert.equal(p.coverageReason, "OA_FULL_TEXT");
    assert.equal(p.source, "Europe PMC");
    assert.match(p.coverageNotice, /full text/);
    assert.equal(p.title, fx.TITLE);
    assert.deepEqual(p.authors, fx.AUTHORS);
    assert.equal(p.pmcid, fx.FIXTURE_PMCID);
    assert.ok(p.chunkCount >= 8);
    const chunks = await svc.loadChunks(DOI);
    assert.equal(chunks.length, p.chunkCount);
    for (const c of chunks) {
      assert.equal(c.paperId, DOI);
      assert.equal(parseChunkId(c.chunkId).paperId, DOI, "every stored chunk id names exactly this paper");
    }
    assert.ok(chunks.some((c) => c.section === "RESULTS" && /87\.4 percent/.test(c.text)));
    assert.ok(!chunks.some((c) => /Acknowledgements|We thank the reviewers/.test(c.text)));
    const callsAfterFirst = http.calls.length;
    const again = await svc.resolve(DOI);
    assert.equal(again.source, "STORE");
    assert.equal(http.calls.length, callsAfterFirst, "served from PostgreSQL");
    assert.equal(again.paper.contentHash, p.contentHash);
  });

  await t.test("one paper, one identity: DOI URL / bare DOI / canonical id all hit the same stored row", async () => {
    await reset();
    const { svc, http } = mk(OA_ROUTES());
    await svc.resolve(`https://doi.org/${fx.FIXTURE_DOI.toUpperCase()}`);
    const n = http.calls.length;
    await svc.resolve(fx.FIXTURE_DOI);
    await svc.resolve(DOI);
    assert.equal(http.calls.length, n);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM papers")).rows[0].n, 1);
  });

  await t.test("ABSTRACT_ONLY: no open-access full text -> only abstract chunks, and the notice says so", async () => {
    await reset();
    const noOa = OA_ROUTES({ work: { ids: { doi: `https://doi.org/${fx.FIXTURE_DOI}` }, open_access: { is_oa: false } }, epmc: { pmcid: undefined, isOpenAccess: "N" } });
    const { svc, http } = mk(noOa);
    const { paper } = await svc.resolve(DOI);
    assert.equal(paper.coverage, "ABSTRACT_ONLY");
    assert.equal(paper.coverageReason, "NO_OPEN_ACCESS_FULL_TEXT");
    assert.match(paper.coverageNotice, /Only the abstract was available/);
    assert.equal(http.count("/fullTextXML"), 0, "no full-text request for a paper that is not open access");
    const chunks = await svc.loadChunks(DOI);
    assert.ok(chunks.length >= 1 && chunks.every((c) => c.section === "ABSTRACT"));
  });

  await t.test("METADATA_ONLY: title and authors but no abstract -> no chunks, nothing to analyse", async () => {
    await reset();
    const { svc } = mk(OA_ROUTES({ work: { abstract_inverted_index: null, ids: { doi: `https://doi.org/${fx.FIXTURE_DOI}` }, open_access: { is_oa: false } }, epmc: { abstractText: "", pmcid: undefined, isOpenAccess: "N" } }));
    const { paper } = await svc.resolve(DOI);
    assert.equal(paper.coverage, "METADATA_ONLY");
    assert.equal(paper.chunkCount, 0);
    assert.match(paper.coverageNotice, /No paper content was analysed/);
    assert.equal((await svc.loadChunks(DOI)).length, 0);
  });

  await t.test("CONTENT_UNAVAILABLE: no provider knows the paper -> stored as such (short TTL), not retried on every request", async () => {
    await reset();
    const { svc, http } = mk([]);
    const first = await svc.resolve("doi:10.9999/does.not.exist");
    assert.equal(first.paper.coverage, "CONTENT_UNAVAILABLE");
    assert.equal(first.paper.coverageReason, "NOT_FOUND");
    const n = http.calls.length;
    assert.equal((await svc.resolve("doi:10.9999/does.not.exist")).source, "STORE");
    assert.equal(http.calls.length, n);
    offset += TTL_MS.CONTENT_UNAVAILABLE + 1000;
    assert.equal((await svc.resolve("doi:10.9999/does.not.exist")).source, "RETRIEVED", "retried after its TTL");
  });

  await t.test("a provider OUTAGE is not 'content unavailable': it raises a retryable error and stores nothing", async () => {
    await reset();
    const bad = mk([["", { status: 503, body: {} }]]);
    await assert.rejects(() => bad.svc.resolve(DOI), (e) => e instanceof PaperError && e.code === "RETRIEVAL_UNAVAILABLE" && e.httpStatus === 503 && e.retryable === true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM papers")).rows[0].n, 0, "an outage must not poison the store");
    const timeout = mk([["", new ProviderError("TIMEOUT", "t")]]);
    await assert.rejects(() => timeout.svc.resolve(DOI), (e) => e.code === "RETRIEVAL_UNAVAILABLE");
    // metadata fine but the full-text download fails: still an error, not a silently degraded ABSTRACT_ONLY record
    const partial = mk(OA_ROUTES({ fullText: { status: 502, body: "" } }));
    await assert.rejects(() => partial.svc.resolve(DOI), (e) => e.code === "RETRIEVAL_UNAVAILABLE");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM papers")).rows[0].n, 0);
    const good = mk(OA_ROUTES());
    assert.equal((await good.svc.resolve(DOI)).paper.coverage, "FULL_TEXT", "and the next attempt works");
  });

  await t.test("full text belonging to a DIFFERENT paper is refused (never stored under the requested id)", async () => {
    await reset();
    const wrong = OA_ROUTES({ fullText: ok(fx.jats({ title: "Completely Unrelated Study of Marine Sponges in Cold Water" }), "application/xml") });
    const { svc } = mk(wrong);
    const { paper } = await svc.resolve(DOI);
    assert.equal(paper.coverage, "ABSTRACT_ONLY");
    assert.equal(paper.coverageReason, "FULL_TEXT_IDENTITY_MISMATCH");
    const chunks = await svc.loadChunks(DOI);
    assert.ok(chunks.every((c) => c.section === "ABSTRACT"), "no sponge text leaked into this paper");
    assert.ok(!chunks.some((c) => /sponge/i.test(c.text)));
  });

  await t.test("a stub / paywall-style 'full text' is not treated as full text", async () => {
    await reset();
    const tiny = OA_ROUTES({ fullText: ok(fx.jats({ bodySecs: ["<sec><title>Introduction</title><p>Short stub.</p></sec>"] }), "application/xml") });
    const { svc } = mk(tiny);
    const { paper } = await svc.resolve(DOI);
    assert.equal(paper.coverage, "ABSTRACT_ONLY");
    assert.equal(paper.coverageReason, "FULL_TEXT_TOO_SHORT");
    const none = mk(OA_ROUTES({ fullText: ok("<html><body>Please log in</body></html>", "text/html") }));
    await pool.query("DELETE FROM papers");
    assert.equal((await none.svc.resolve(DOI)).paper.coverage, "ABSTRACT_ONLY");
  });

  await t.test("arXiv: Atom metadata + LaTeXML HTML full text", async () => {
    await reset();
    const { svc } = mk([["export.arxiv.org/api/query", ok(fx.arxivAtom(), "application/atom+xml")], ["arxiv.org/html/", ok(fx.arxivHtml(), "text/html; charset=utf-8")]]);
    const { paper } = await svc.resolve(`arXiv:${fx.FIXTURE_ARXIV}v3`);
    assert.equal(paper.paperId, `arxiv:${fx.FIXTURE_ARXIV}`);
    assert.equal(paper.coverage, "FULL_TEXT");
    assert.equal(paper.source, "arXiv HTML");
    const chunks = await svc.loadChunks(paper.paperId);
    assert.ok(chunks.some((c) => c.section === "TABLE" && /87\.4/.test(c.text)));
    assert.ok(chunks.some((c) => /lambda L_\{route\}/.test(c.text)), "math alttext survives");
    assert.ok(!chunks.some((c) => /should never be read/.test(c.text)));
  });

  await t.test("concurrent requests for one paper cause ONE provider round-trip, even across service instances (Redis single-flight)", async () => {
    await reset();
    const slow = (res) => async () => { await new Promise((r) => setTimeout(r, 120)); return res; };
    const routes = [
      ["api.openalex.org/works/doi:", (u) => ok(fx.openAlexWork())],
      ["europepmc/webservices/rest/search", ok(fx.europePmcSearch())],
      ["/fullTextXML", ok(fx.jats(), "application/xml")]
    ];
    const httpSlow = fakeHttp(routes);
    const delayed = async (url) => { await new Promise((r) => setTimeout(r, 150)); return httpSlow(url); };
    delayed.calls = httpSlow.calls;
    const mkSvc = () => createPaperService({ pool, redis, providers: createProviders({ http: delayed, env: {} }), now: clockNow, logger: silentLogger, pollMs: 30 });
    const services = [mkSvc(), mkSvc(), mkSvc(), mkSvc()];
    const out = await Promise.all(services.map((s) => s.resolve(DOI)));
    assert.ok(out.every((o) => o.paper.coverage === "FULL_TEXT"));
    assert.equal(httpSlow.calls.filter((u) => u.includes("api.openalex.org")).length, 1, "metadata fetched once");
    assert.equal(httpSlow.calls.filter((u) => u.includes("/fullTextXML")).length, 1, "full text fetched once");
    assert.equal(out.filter((o) => o.source === "RETRIEVED").length, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM paper_chunks WHERE paper_id=$1", [DOI])).rows[0].n, out[0].paper.chunkCount);
  });

  await t.test("freshness: abstract-only records are rechecked after 24h, full texts are kept for 30 days; changed content changes the content hash", async () => {
    await reset();
    const a = mk(OA_ROUTES());
    const first = (await a.svc.resolve(DOI)).paper;
    offset += 25 * 3600 * 1000;
    assert.equal((await a.svc.resolve(DOI)).source, "STORE", "FULL_TEXT is not refetched after a day");
    offset += TTL_MS.FULL_TEXT;
    const changedJats = fx.jats().replace("87.4 percent exact-match", "88.0 percent exact-match");
    const b = mk(OA_ROUTES({ fullText: ok(changedJats, "application/xml") }));
    const again = await b.svc.resolve(DOI);
    assert.equal(again.source, "RETRIEVED");
    assert.notEqual(again.paper.contentHash, first.contentHash, "the cache key input changes when the paper text changes");
    const forced = await b.svc.resolve(DOI, { forceRefresh: true });
    assert.equal(forced.source, "RETRIEVED");
  });

  await t.test("invalid references are rejected before any provider or database work", async () => {
    await reset();
    const { svc, http } = mk(OA_ROUTES());
    for (const bad of ["", "chunk_1842", "../../etc/passwd", "doi:", "title:x", null, 7, "https://evil.example/doi:10.1000/x"]) {
      await assert.rejects(() => svc.resolve(bad), (e) => e instanceof PaperError && e.code === "INVALID_PAPER_ID" && e.httpStatus === 400, String(bad));
    }
    assert.equal(http.calls.length, 0);
  });
});
