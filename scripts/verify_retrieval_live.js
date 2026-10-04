#!/usr/bin/env node
"use strict";
/**
 * Live check of paper retrieval against the REAL scholarly providers (OpenAlex, Europe PMC, arXiv). Needs outbound HTTPS to
 * api.openalex.org, www.ebi.ac.uk, export.arxiv.org and arxiv.org. No database, no Redis, no AI key, no Firebase token.
 *
 *   CONTACT_EMAIL=you@example.org node scripts/verify_retrieval_live.js [paperRef ...]
 *
 * For each paper it runs the same stages the server runs (identity -> metadata -> open-access full text -> extraction ->
 * chunking) and prints what coverage the server would assign. It stores nothing and calls no model.
 * Exit code 0 only if every paper reached the coverage it was expected to; 2 if a provider could not be reached at all
 * (that is "not verified", not a pass); 1 on a real mismatch.
 *
 * Default papers are public, open-access and widely mirrored; the expected coverage is a floor ("at least"), because a
 * provider can legitimately change what it serves.
 */
const { parsePaperRef } = require("../backend/papers/identity");
const { createProviders, ProviderError, titlesMatch } = require("../backend/papers/providers");
const { extractJats, extractHtmlArticle } = require("../backend/papers/extract");
const { chunkDocument } = require("../backend/papers/chunker");
const { MIN_FULLTEXT_BODY_CHARS } = require("../backend/papers/paperService");

const RANK = { CONTENT_UNAVAILABLE: 0, METADATA_ONLY: 1, ABSTRACT_ONLY: 2, FULL_TEXT: 3 };
const DEFAULTS = [
  { ref: "arxiv:1706.03762", atLeast: "FULL_TEXT", note: "Attention Is All You Need (arXiv; HTML full text may or may not be served for older ids)" },
  { ref: "doi:10.1371/journal.pone.0000308", atLeast: "ABSTRACT_ONLY", note: "PLOS ONE (open access; Europe PMC full text expected)" },
  { ref: "doi:10.9999/this.doi.does.not.exist.0000", atLeast: "CONTENT_UNAVAILABLE", expectExactly: "CONTENT_UNAVAILABLE", note: "must be reported as unavailable, never invented" }
];

async function check(providers, ref, label) {
  const parsed = parsePaperRef(ref);
  if (!parsed) return { ref, coverage: null, problem: "unparseable paper reference" };
  const started = Date.now();
  const meta = await providers.fetchMetadata(parsed);
  if (!meta) return { ref, canonicalId: parsed.canonicalId, coverage: "CONTENT_UNAVAILABLE", ms: Date.now() - started };
  const ft = await providers.fetchFullText(meta);
  let coverage = meta.abstract && meta.abstract.length >= 100 ? "ABSTRACT_ONLY" : "METADATA_ONLY";
  let detail = { chunks: 0, sections: 0 };
  let reason = ft ? "full text fetched" : "no open-access full text";
  if (ft) {
    const doc = ft.format === "JATS_XML" ? extractJats(ft.body) : extractHtmlArticle(ft.body);
    if (!doc || !doc.ok) reason = "extraction failed";
    else {
      const bodyChars = doc.sections.reduce((n, s) => n + s.paragraphs.join("").length, 0);
      if (doc.title && meta.title && !titlesMatch(doc.title, meta.title)) reason = "full text is a different paper (rejected)";
      else if (bodyChars < MIN_FULLTEXT_BODY_CHARS || doc.sections.length < 2) reason = "full text too short (rejected)";
      else {
        const chunked = chunkDocument(parsed.canonicalId, { abstract: meta.abstract || doc.abstract, sections: doc.sections, tables: doc.tables, figures: doc.figures });
        coverage = "FULL_TEXT";
        reason = `via ${ft.source}`;
        detail = { chunks: chunked.chunks.length, sections: doc.sections.length, truncated: chunked.truncated };
      }
    }
  }
  return { ref, label, canonicalId: parsed.canonicalId, title: meta.title, year: meta.year, coverage, reason, ...detail, ms: Date.now() - started };
}

(async () => {
  const providers = createProviders({ env: process.env, logger: { log() {}, warn() {}, error() {} } });
  const cli = process.argv.slice(2);
  const cases = cli.length ? cli.map((ref) => ({ ref, atLeast: "METADATA_ONLY" })) : DEFAULTS;
  let unreachable = 0;
  let mismatches = 0;
  for (const c of cases) {
    let r;
    try {
      r = await check(providers, c.ref);
    } catch (e) {
      if (e instanceof ProviderError) {
        unreachable += 1;
        console.log(JSON.stringify({ ref: c.ref, result: "NOT_VERIFIED", providerError: e.code, provider: e.provider || null }));
        continue;
      }
      throw e;
    }
    const ok = r.coverage !== null && RANK[r.coverage] >= RANK[c.atLeast] && (!c.expectExactly || r.coverage === c.expectExactly);
    if (!ok) mismatches += 1;
    console.log(JSON.stringify({ ...r, expected: c.expectExactly || `>= ${c.atLeast}`, result: ok ? "PASS" : "MISMATCH" }));
  }
  console.log(JSON.stringify({ summary: { cases: cases.length, unreachable, mismatches } }));
  process.exit(mismatches ? 1 : unreachable ? 2 : 0);
})().catch((e) => {
  console.error("verify_retrieval_live failed:", e && e.message);
  process.exit(1);
});
