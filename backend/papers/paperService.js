"use strict";
/**
 * Paper retrieval and storage:   canonical id -> metadata -> open-access full text -> extraction -> sections -> chunks -> store.
 *
 * Coverage is explicit and is the gate for every AI call:
 *   FULL_TEXT            open-access full text was retrieved, extracted and verified to be this paper
 *   ABSTRACT_ONLY        only the abstract is available (never described to the user as the whole paper)
 *   METADATA_ONLY        only bibliographic metadata (title, authors, venue); nothing to analyse
 *   CONTENT_UNAVAILABLE  no provider knows the paper
 * A provider outage is NOT "content unavailable": it raises RETRIEVAL_UNAVAILABLE and nothing is stored, so the next
 * request tries again instead of serving a degraded record as if it were the truth.
 *
 * PostgreSQL is the store (shared by all replicas); Redis provides a single-flight lock so concurrent requests for the same
 * paper trigger one provider round-trip. Scholarly content is public and shared across tenants; who may ANALYSE it and who
 * may see analysis results is decided per project elsewhere.
 */

const crypto = require("crypto");
const { parsePaperRef, makeChunkId } = require("./identity");
const { extractJats, extractHtmlArticle } = require("./extract");
const { chunkDocument, documentContentHash } = require("./chunker");
const { ProviderError, titlesMatch } = require("./providers");

const EXTRACTOR_VERSION = 1;
const MIN_FULLTEXT_BODY_CHARS = 2000; // a stub or landing page is far below this; the shortest real articles are well above
const MIN_FULLTEXT_SECTIONS = 2;
const MIN_ABSTRACT_CHARS = 100;

const TTL_MS = {
  FULL_TEXT: 30 * 24 * 3600 * 1000,
  ABSTRACT_ONLY: 24 * 3600 * 1000, // full text may become available, or a full-text attempt may have failed
  METADATA_ONLY: 6 * 3600 * 1000,
  CONTENT_UNAVAILABLE: 3600 * 1000
};

const NOTICES = {
  FULL_TEXT: (src) => `Analysis is based on the open-access full text${src ? ` from ${src}` : ""}.`,
  ABSTRACT_ONLY: () => "Only the abstract was available. This analysis does not cover the paper's methods, experiments or results beyond what the abstract itself states.",
  METADATA_ONLY: () => "Only bibliographic metadata (title, authors, venue) is available for this paper. No paper content was analysed.",
  CONTENT_UNAVAILABLE: () => "No record of this paper could be retrieved from the configured scholarly sources."
};

class PaperError extends Error {
  constructor(code, message, httpStatus, retryable = false) {
    super(message);
    this.name = "PaperError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const UNLOCK_LUA = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

function rowToView(r) {
  if (!r) return null;
  return {
    paperId: r.paper_id,
    title: r.title,
    authors: Array.isArray(r.authors) ? r.authors : [],
    year: r.pub_year,
    venue: r.venue,
    doi: r.doi,
    pmid: r.pmid,
    pmcid: r.pmcid,
    arxivId: r.arxiv_id,
    abstract: r.abstract,
    coverage: r.coverage,
    coverageReason: r.coverage_reason,
    coverageNotice: NOTICES[r.coverage](r.source),
    source: r.source,
    sourceUrl: r.source_url,
    license: r.license,
    chunkCount: r.chunk_count,
    contentHash: r.content_hash,
    truncated: r.truncated,
    retrievedAt: r.retrieved_at instanceof Date ? r.retrieved_at.toISOString() : r.retrieved_at,
    providers: Array.isArray(r.providers) ? r.providers : []
  };
}

function createPaperService({ pool, redis = null, providers, beforeRetrieve = null, now = Date.now, logger = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), lockMs = 90000, pollMs = 400 }) {
  async function readRow(paperId) {
    const r = await pool.query("SELECT *, retrieved_at FROM papers WHERE paper_id = $1", [paperId]);
    return r.rowCount ? r.rows[0] : null;
  }

  function isFresh(row) {
    if (!row || row.extractor_version !== EXTRACTOR_VERSION) return false;
    const age = now() - new Date(row.retrieved_at).getTime();
    return age > -60000 && age < TTL_MS[row.coverage]; // tolerate a minute of clock skew between the app and the database
  }

  /** Build the record to store from provider output. Pure with respect to the database. */
  async function build(ref) {
    const meta = await providers.fetchMetadata(ref);
    if (!meta) {
      return { row: { paper_id: ref.canonicalId, title: "", authors: [], pub_year: null, venue: null, doi: null, pmid: null, pmcid: null, arxiv_id: null, abstract: null, coverage: "CONTENT_UNAVAILABLE", coverage_reason: "NOT_FOUND", source: null, source_url: null, license: null, providers: [] }, chunks: [], truncated: false };
    }

    let doc = null;
    let source = null;
    let sourceUrl = null;
    let license = meta.license || null;
    let reason = "NO_OPEN_ACCESS_FULL_TEXT";
    const ft = await providers.fetchFullText(meta); // throws ProviderError on outage: nothing is stored
    if (ft) {
      let parsed = null;
      try {
        parsed = ft.format === "JATS_XML" ? extractJats(ft.body) : extractHtmlArticle(ft.body);
      } catch (e) {
        parsed = null;
        reason = "EXTRACTION_FAILED";
        logger.warn(`[Papers] extraction failed for ${ref.canonicalId}: ${String(e.message).slice(0, 80)}`);
      }
      if (parsed && parsed.ok) {
        const bodyChars = parsed.sections.reduce((n, s) => n + s.paragraphs.join("").length, 0);
        if (parsed.title && meta.title && !titlesMatch(parsed.title, meta.title)) {
          reason = "FULL_TEXT_IDENTITY_MISMATCH"; // the provider returned a different paper's text: refuse it
          logger.warn(`[Papers] full text for ${ref.canonicalId} rejected: title does not match the requested paper`);
        } else if (bodyChars < MIN_FULLTEXT_BODY_CHARS || parsed.sections.length < MIN_FULLTEXT_SECTIONS) {
          reason = "FULL_TEXT_TOO_SHORT";
          doc = { abstract: parsed.abstract, sections: [], tables: [], figures: [] };
          source = ft.source;
          sourceUrl = ft.url;
        } else {
          doc = parsed;
          source = ft.source;
          sourceUrl = ft.url;
          reason = "OA_FULL_TEXT";
          license = ft.license || license;
        }
      } else if (parsed && !parsed.ok) reason = "EXTRACTION_FAILED";
    }

    const abstractText = [meta.abstract, doc && doc.abstract].filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
    let coverage;
    let chunked;
    if (doc && reason === "OA_FULL_TEXT") {
      coverage = "FULL_TEXT";
      chunked = chunkDocument(ref.canonicalId, { abstract: abstractText, sections: doc.sections, tables: doc.tables, figures: doc.figures });
    } else if (abstractText.length >= MIN_ABSTRACT_CHARS) {
      coverage = "ABSTRACT_ONLY";
      chunked = chunkDocument(ref.canonicalId, { abstract: abstractText }, { abstractOnly: true });
      if (reason === "OA_FULL_TEXT") reason = "NO_OPEN_ACCESS_FULL_TEXT";
    } else {
      coverage = "METADATA_ONLY";
      reason = reason === "NO_OPEN_ACCESS_FULL_TEXT" ? "NO_ABSTRACT" : reason;
      chunked = { chunks: [], truncated: false, droppedSections: [] };
    }
    if (coverage !== "FULL_TEXT") {
      source = (meta.providers && meta.providers.join(", ")) || null; // where the abstract/metadata came from
      sourceUrl = null;
    }

    return {
      row: {
        paper_id: ref.canonicalId,
        title: meta.title || "",
        authors: meta.authors || [],
        pub_year: meta.year,
        venue: meta.venue,
        doi: meta.doi,
        pmid: meta.pmid,
        pmcid: meta.pmcid,
        arxiv_id: meta.arxivId,
        abstract: abstractText || null,
        coverage,
        coverage_reason: reason,
        source,
        source_url: sourceUrl,
        license,
        providers: meta.providers || []
      },
      chunks: chunked.chunks,
      truncated: chunked.truncated
    };
  }

  async function persist({ row, chunks, truncated }) {
    const contentHash = documentContentHash(chunks);
    await pool.transaction(async (c) => {
      await c.query(
        `INSERT INTO papers (paper_id,title,authors,pub_year,venue,doi,pmid,pmcid,arxiv_id,abstract,coverage,coverage_reason,source,source_url,license,content_hash,chunk_count,truncated,extractor_version,providers,retrieved_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb, now())
         ON CONFLICT (paper_id) DO UPDATE SET title=EXCLUDED.title, authors=EXCLUDED.authors, pub_year=EXCLUDED.pub_year, venue=EXCLUDED.venue, doi=EXCLUDED.doi, pmid=EXCLUDED.pmid, pmcid=EXCLUDED.pmcid, arxiv_id=EXCLUDED.arxiv_id,
           abstract=EXCLUDED.abstract, coverage=EXCLUDED.coverage, coverage_reason=EXCLUDED.coverage_reason, source=EXCLUDED.source, source_url=EXCLUDED.source_url, license=EXCLUDED.license, content_hash=EXCLUDED.content_hash,
           chunk_count=EXCLUDED.chunk_count, truncated=EXCLUDED.truncated, extractor_version=EXCLUDED.extractor_version, providers=EXCLUDED.providers, retrieved_at=now()`,
        [row.paper_id, row.title, JSON.stringify(row.authors), row.pub_year, row.venue, row.doi, row.pmid, row.pmcid, row.arxiv_id, row.abstract, row.coverage, row.coverage_reason, row.source, row.source_url, row.license, contentHash, chunks.length, truncated, EXTRACTOR_VERSION, JSON.stringify(row.providers)]
      );
      await c.query("DELETE FROM paper_chunks WHERE paper_id = $1", [row.paper_id]);
      for (let i = 0; i < chunks.length; i += 40) {
        const batch = chunks.slice(i, i + 40);
        const params = [];
        const values = batch.map((ch, j) => {
          const o = j * 8;
          params.push(row.paper_id, ch.ordinal, ch.chunkId, ch.section, ch.heading || null, ch.sourceType, ch.text, ch.textHash);
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
        });
        await c.query(`INSERT INTO paper_chunks (paper_id,ordinal,chunk_id,section,heading,source_type,text,text_hash) VALUES ${values.join(",")}`, params);
      }
    });
  }

  async function acquireLock(key) {
    if (!redis) return { held: false, token: null, available: false };
    const token = crypto.randomBytes(8).toString("hex");
    try {
      const ok = (await redis.command("SET", key, token, "NX", "PX", lockMs)) === "OK";
      return { held: ok, token, available: true };
    } catch (_) {
      return { held: false, token, available: false }; // no lock service: retrieve anyway (correct, just not de-duplicated)
    }
  }

  /**
   * Ensure the paper is stored and fresh; return its view.
   * @param {string} input canonical id, or a DOI / PMID / arXiv id / URL
   * @param {{forceRefresh?:boolean}} [opts]
   * @returns {Promise<{paper:object, source:"STORE"|"RETRIEVED"}>}
   * @throws PaperError INVALID_PAPER_ID (400) | RETRIEVAL_UNAVAILABLE (503, retryable) | RETRIEVAL_BUSY (503, retryable)
   */
  async function resolve(input, opts = {}) {
    const ref = parsePaperRef(input);
    if (!ref) throw new PaperError("INVALID_PAPER_ID", "paperId must be a DOI, PMID, arXiv id or a canonical id (doi:..., pmid:..., arxiv:..., title:...).", 400);

    if (!opts.forceRefresh) {
      const row = await readRow(ref.canonicalId);
      if (isFresh(row)) return { paper: rowToView(row), source: "STORE" };
    }

    const lockKey = `shords:paperlock:${sha(ref.canonicalId).slice(0, 32)}`;
    const lock = await acquireLock(lockKey);
    if (!lock.held && lock.available) {
      const deadline = now() + lockMs;
      while (now() < deadline) {
        await sleep(pollMs);
        const row = await readRow(ref.canonicalId);
        if (isFresh(row) && !opts.forceRefresh) return { paper: rowToView(row), source: "STORE" };
        let held = true;
        try {
          held = (await redis.command("EXISTS", lockKey)) === 1;
        } catch (_) {
          held = false;
        }
        if (!held) break; // holder finished (or failed): take over below
      }
      const row = await readRow(ref.canonicalId);
      if (isFresh(row) && !opts.forceRefresh) return { paper: rowToView(row), source: "STORE" };
    }

    try {
      if (beforeRetrieve) await beforeRetrieve(ref); // shared provider budget (may throw a retryable PaperError)
      const built = await build(ref);
      await persist(built);
      return { paper: rowToView(await readRow(ref.canonicalId)), source: "RETRIEVED" };
    } catch (e) {
      if (e instanceof ProviderError) {
        logger.warn(`[Papers] retrieval failed for ${ref.canonicalId}: ${e.code} (${e.provider || "provider"}) retryable=${e.retryable}`);
        throw new PaperError("RETRIEVAL_UNAVAILABLE", "Scholarly sources are temporarily unavailable. Please retry shortly.", 503, true);
      }
      throw e;
    } finally {
      if (lock.held) {
        try {
          await redis.eval(UNLOCK_LUA, [lockKey], [lock.token]);
        } catch (_) {
          /* expires on its own */
        }
      }
    }
  }

  /** Stored paper, no retrieval (cheap pre-checks). */
  async function peek(input) {
    const ref = parsePaperRef(input);
    if (!ref) return null;
    return rowToView(await readRow(ref.canonicalId));
  }

  /** Stored paper if (and only if) it is still fresh; no retrieval. Used for cheap pre-checks that must not trust stale data. */
  async function peekFresh(input) {
    const ref = parsePaperRef(input);
    if (!ref) return null;
    const row = await readRow(ref.canonicalId);
    return isFresh(row) ? rowToView(row) : null;
  }

  /** All chunks of a stored paper, in order. */
  async function loadChunks(paperId) {
    const r = await pool.query("SELECT chunk_id, ordinal, section, heading, source_type, text, text_hash FROM paper_chunks WHERE paper_id = $1 ORDER BY ordinal", [paperId]);
    return r.rows.map((x) => ({ chunkId: x.chunk_id, paperId, ordinal: x.ordinal, section: x.section, heading: x.heading, sourceType: x.source_type, text: x.text, textHash: x.text_hash, page: null }));
  }

  return { resolve, peek, peekFresh, loadChunks };
}

module.exports = { createPaperService, PaperError, EXTRACTOR_VERSION, TTL_MS, NOTICES, rowToView, MIN_FULLTEXT_BODY_CHARS };
