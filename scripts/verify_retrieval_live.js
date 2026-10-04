#!/usr/bin/env node
"use strict";
/**
 * Live check of paper retrieval against the REAL scholarly providers. Needs outbound HTTPS to api.openalex.org,
 * www.ebi.ac.uk, export.arxiv.org and arxiv.org. No database, no Redis, no Firebase token and NO Anthropic key; it makes no
 * model call and stores nothing.
 *
 *   CONTACT_EMAIL=you@example.org node scripts/verify_retrieval_live.js [--paper-a <ref>] [--paper-b <ref>]
 *
 * Part 1 - provider connectivity, one line per provider endpoint: PASS | FAIL | NOT_VERIFIED
 *   PASS          reachable AND returned the expected, well-formed content for a well-known open-access paper
 *   FAIL          reachable, but the answer was wrong or malformed
 *   NOT_VERIFIED  could not be reached, was refused (blocked egress, 403/429/5xx, timeout): this is never reported as PASS
 * Part 2 - two different papers through the server's own pipeline (identity -> metadata -> full text -> extraction -> sections
 *   -> chunks), with the coverage each one earned and its section / chunk counts.
 * Part 3 - isolation of those two papers: different content hashes, different cache keys, evidence ids that belong only to their
 *   own paper, and each paper refused when it asks for the other's evidence.
 *
 * Exit: 0 all PASS; 1 any FAIL; 2 nothing FAILed but something could not be verified.
 */
const { parsePaperRef } = require("../backend/papers/identity");
const { createProviders, createHttpsGet, ProviderError } = require("../backend/papers/providers");
const { createPaperService } = require("../backend/papers/paperService");
const { documentContentHash } = require("../backend/papers/chunker");
const { contentHash, buildCacheKey } = require("../backend/llm/resultCache");
const { validateChunkIds } = require("../backend/llm/evidence");
const { INTEL_PROMPT_VERSION } = require("../backend/llm/intelligence");

// Well-known open-access papers. A: computer science (arXiv). B: biomedical (PLOS Medicine, in PubMed Central).
const DEFAULT_TARGETS = {
  paperA: { ref: "arxiv:2312.00752", note: "computer science / AI (arXiv)", titleHint: "mamba" },
  paperB: { ref: "doi:10.1371/journal.pmed.0020124", note: "biomedical (PLOS Medicine, open access)", titleHint: "published research findings" }
};
const RANK = { CONTENT_UNAVAILABLE: 0, METADATA_ONLY: 1, ABSTRACT_ONLY: 2, FULL_TEXT: 3 };

/** One endpoint probe. `fn` returns {ok, detail}; a thrown ProviderError or a non-2xx answer is NOT_VERIFIED, never PASS. */
async function probe(report, results, provider, name, fn) {
  let line;
  try {
    const r = await fn();
    line = r.notVerified ? { status: "NOT_VERIFIED", ...r.detail } : { status: r.ok ? "PASS" : "FAIL", ...r.detail };
  } catch (e) {
    line = { status: "NOT_VERIFIED", error: e instanceof ProviderError ? e.code : String((e && e.message) || e).slice(0, 80), httpStatus: (e && e.httpStatus) || null };
  }
  const out = { part: "provider", provider, check: name, ...line };
  results.push(out);
  report(out);
  return out;
}

async function get(http, url, accept, maxBytes) {
  const r = await http(url, { accept, maxBytes });
  return r;
}
const unreachable = (r) => ({ notVerified: true, detail: { httpStatus: r.status } });

async function probeProviders({ http, targets, report, results }) {
  const doi = parsePaperRef(targets.paperB.ref);
  const arx = parsePaperRef(targets.paperA.ref);
  const doiValue = doi && doi.kind === "doi" ? doi.value : null;
  const arxValue = arx && arx.kind === "arxiv" ? arx.value : null;
  let pmcid = null;

  if (doiValue) {
    await probe(report, results, "OpenAlex", "works by DOI", async () => {
      const r = await get(http, `https://api.openalex.org/works/doi:${encodeURI(doiValue)}?select=id,doi,title`, "application/json", 1 << 20);
      if (r.status < 200 || r.status >= 300) return unreachable(r);
      const j = JSON.parse(r.body);
      const ok = typeof j.title === "string" && j.title.toLowerCase().includes(targets.paperB.titleHint) && /doi\.org\//i.test(j.doi || "");
      return { ok, detail: { title: String(j.title || "").slice(0, 80) } };
    });
    await probe(report, results, "EuropePMC", "search by DOI", async () => {
      const r = await get(http, `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${doiValue}"`)}&format=json&resultType=core&pageSize=3`, "application/json", 1 << 20);
      if (r.status < 200 || r.status >= 300) return unreachable(r);
      const hit = (JSON.parse(r.body).resultList || {}).result;
      const first = Array.isArray(hit) ? hit[0] : null;
      pmcid = first && /^PMC\d+$/.test(first.pmcid || "") ? first.pmcid : null;
      return { ok: Boolean(first && String(first.title || "").toLowerCase().includes(targets.paperB.titleHint)), detail: { pmcid, isOpenAccess: first ? first.isOpenAccess : null } };
    });
    await probe(report, results, "EuropePMC", "open-access full text (JATS XML)", async () => {
      if (!pmcid) return { notVerified: true, detail: { note: "no PMCID from the search probe above" } };
      const r = await get(http, `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`, "application/xml", 12 << 20);
      if (r.status === 404) return { ok: false, detail: { httpStatus: 404, note: "a known open-access paper returned no full text" } };
      if (r.status < 200 || r.status >= 300) return unreachable(r);
      return { ok: /<article[\s>]/i.test(r.body) && /<body[\s>]/i.test(r.body), detail: { bytes: r.body.length } };
    });
  }
  if (arxValue) {
    await probe(report, results, "arXiv", "metadata API", async () => {
      const r = await get(http, `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxValue)}&max_results=1`, "application/atom+xml", 1 << 20);
      if (r.status < 200 || r.status >= 300) return unreachable(r);
      const t = /<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(r.body);
      return { ok: Boolean(t && t[1].toLowerCase().includes(targets.paperA.titleHint)), detail: { title: t ? t[1].replace(/\s+/g, " ").trim().slice(0, 80) : null } };
    });
    await probe(report, results, "arXiv", "HTML full text", async () => {
      const r = await get(http, `https://arxiv.org/html/${arxValue}`, "text/html", 12 << 20);
      if (r.status === 404) return { ok: true, detail: { htmlAvailable: false, note: "host reachable; this paper has no HTML rendering, so arXiv full-text extraction is not exercised by it" } };
      if (r.status < 200 || r.status >= 300) return unreachable(r);
      return { ok: /ltx_|<article/i.test(r.body), detail: { htmlAvailable: true, bytes: r.body.length } };
    });
  }
}

/** Run one paper through the server's own build step (no storage). */
async function runPaper(svc, label, ref) {
  const parsed = parsePaperRef(ref);
  if (!parsed) return { label, ref, coverage: null, problem: "unparseable paper reference" };
  const t0 = Date.now();
  const built = await svc.build(parsed);
  const sections = new Set(built.chunks.map((c) => c.section));
  return {
    label, ref, paperId: parsed.canonicalId, title: built.row.title, coverage: built.row.coverage, reason: built.row.coverage_reason, source: built.row.source,
    chunks: built.chunks, chunkCount: built.chunks.length, sections: [...sections], truncated: built.truncated, ms: Date.now() - t0
  };
}

/** Part 3. Pure over two built papers: nothing here needs the network. */
function isolation(a, b, report, results) {
  const rec = (check, ok, detail = {}) => {
    const line = { part: "isolation", check, ...detail, status: ok ? "PASS" : "FAIL" };
    results.push(line);
    report(line);
  };
  const notVerified = (why) => {
    const line = { part: "isolation", check: "all", status: "NOT_VERIFIED", why };
    results.push(line);
    report(line);
  };
  for (const [label, p] of [["A", a], ["B", b]]) if (!p || !p.chunks || p.chunks.length === 0) return notVerified(`paper ${label} was not retrieved or has no chunks${p ? ` (coverage ${p.coverage})` : ""}`);
  if (a.paperId === b.paperId) return notVerified("both references resolve to the same paper; choose two different papers");

  const ev = (p) => p.chunks.map((c) => ({ chunkId: c.chunkId, paperId: p.paperId, section: c.section, page: null, text: c.text, heading: c.heading }));
  const hashA = contentHash(ev(a)), hashB = contentHash(ev(b));
  rec("content hashes differ", hashA !== hashB, { a: hashA.slice(0, 12), b: hashB.slice(0, 12), storedHashA: documentContentHash(a.chunks).slice(0, 12), storedHashB: documentContentHash(b.chunks).slice(0, 12) });
  const key = (p, h) => buildCacheKey({ tenantId: "verify", projectId: "verify", paperId: p.paperId, contentHash: h, model: "claude-sonnet-5-5", mode: "INTELLIGENCE:STANDARD", promptVersion: INTEL_PROMPT_VERSION, query: "STRUCTURED_INTELLIGENCE" });
  const ka = key(a, hashA), kb = key(b, hashB);
  rec("cache keys differ (everything else identical)", ka !== kb, { a: ka.slice(-12), b: kb.slice(-12) });
  // The paper id is part of the key on its own: even with the SAME content hash the keys must differ.
  rec("cache key depends on the paper id alone", key(a, hashA) !== key(b, hashA), {});
  rec("A's evidence ids all belong to A", a.chunks.every((c) => c.chunkId.startsWith(`${a.paperId}_chunk_`)), { count: a.chunks.length });
  rec("B's evidence ids all belong to B", b.chunks.every((c) => c.chunkId.startsWith(`${b.paperId}_chunk_`)), { count: b.chunks.length });
  const idsA = new Set(a.chunks.map((c) => c.chunkId));
  rec("no evidence id is shared between A and B", b.chunks.every((c) => !idsA.has(c.chunkId)), {});
  const refuses = (paper, other) => {
    try {
      validateChunkIds(paper.paperId, [other.chunks[0].chunkId], paper.chunks);
      return false;
    } catch (e) {
      return e && e.name === "EvidenceError";
    }
  };
  rec("A cannot request B's evidence", refuses(a, b), {});
  rec("B cannot request A's evidence", refuses(b, a), {});
  rec("each paper can request its own evidence", (() => { try { return validateChunkIds(a.paperId, [a.chunks[0].chunkId], a.chunks).length === 1 && validateChunkIds(b.paperId, [b.chunks[0].chunkId], b.chunks).length === 1; } catch (_) { return false; } })(), {});
}

async function run({ http, targets = DEFAULT_TARGETS, env = process.env, report = (l) => console.log(JSON.stringify(l)), logger = { log() {}, warn() {}, error() {} } } = {}) {
  const results = [];
  await probeProviders({ http, targets, report, results });

  const providers = createProviders({ http, env, logger });
  const svc = createPaperService({ pool: null, redis: null, providers, logger });
  const built = {};
  for (const [label, t] of [["A", targets.paperA], ["B", targets.paperB]]) {
    let r;
    try {
      r = await runPaper(svc, label, t.ref);
    } catch (e) {
      const line = { part: "pipeline", paper: label, ref: t.ref, status: "NOT_VERIFIED", error: e instanceof ProviderError ? e.code : String((e && e.message) || e).slice(0, 80) };
      results.push(line);
      report(line);
      continue;
    }
    built[label] = r;
    // The floor is ABSTRACT_ONLY: a provider may legitimately serve less full text than expected; FULL_TEXT is reported either way.
    const ok = r.coverage !== null && RANK[r.coverage] >= RANK.ABSTRACT_ONLY;
    const line = { part: "pipeline", paper: label, ref: t.ref, note: t.note, paperId: r.paperId, title: r.title && r.title.slice(0, 80), coverage: r.coverage, coverageReason: r.reason, source: r.source, sections: r.sections && r.sections.length, chunks: r.chunkCount, truncated: r.truncated, ms: r.ms, status: ok ? "PASS" : "FAIL" };
    results.push(line);
    report(line);
  }
  isolation(built.A, built.B, report, results);

  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { pass: count("PASS"), fail: count("FAIL"), notVerified: count("NOT_VERIFIED") };
  report({ summary });
  return { results, summary, exitCode: summary.fail ? 1 : summary.notVerified ? 2 : 0 };
}

module.exports = { run, DEFAULT_TARGETS, probeProviders, isolation };

if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const targets = {
    paperA: { ...DEFAULT_TARGETS.paperA, ...(arg("--paper-a") ? { ref: arg("--paper-a"), titleHint: "" } : {}) },
    paperB: { ...DEFAULT_TARGETS.paperB, ...(arg("--paper-b") ? { ref: arg("--paper-b"), titleHint: "" } : {}) }
  };
  const contact = (process.env.CONTACT_EMAIL || "").trim();
  const http = createHttpsGet({ userAgent: `shoRDs/1.0 (retrieval-verification${contact ? `; mailto:${contact}` : ""})` });
  run({ http, targets }).then((r) => process.exit(r.exitCode)).catch((e) => { console.error("verify_retrieval_live failed:", String(e && e.message).slice(0, 200)); process.exit(1); });
}
