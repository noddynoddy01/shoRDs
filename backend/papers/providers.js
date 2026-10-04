"use strict";
/**
 * Scholarly metadata and open-access full-text providers. All network access goes through one injectable `http` function,
 * so tests run the real parsing code against recorded-shape payloads and production uses the HTTPS implementation below.
 *
 * Safety:
 *  - only a fixed allow-list of hosts is ever contacted; the caller can influence only the identifier inside the URL, and
 *    identifiers are validated canonical ids (see identity.js), so there is no way to steer a request to another host (no SSRF);
 *  - redirects are followed only to allow-listed hosts (max 3) and only over https;
 *  - every response has a timeout and a size cap; content types are checked;
 *  - nothing from a provider is executed or rendered; text is extracted by markup.js / extract.js.
 *
 * Outcomes are explicit: a definite "no such record" is `null`; a transient failure (timeout, 5xx, 429, network) throws a
 * ProviderError with retryable=true so the caller never mistakes an outage for "content unavailable".
 */

const https = require("https");
const { canonicalPaperId, normalizeDoi, normalizeArxiv, normalizeTitleString } = require("./identity");

const ALLOWED_HOSTS = new Set(["api.openalex.org", "www.ebi.ac.uk", "export.arxiv.org", "arxiv.org"]);
const METADATA_MAX_BYTES = 2 * 1024 * 1024;
const FULLTEXT_MAX_BYTES = 12 * 1024 * 1024;

class ProviderError extends Error {
  constructor(code, message, { retryable = true, httpStatus = null, provider = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.provider = provider;
  }
}

/** Production HTTP implementation: GET with host allow-list, redirect policy, timeout and size cap. */
function createHttpsGet({ timeoutMs = 12000, userAgent = "shoRDs/1.0 (research-intelligence)", maxRedirects = 3 } = {}) {
  function once(urlStr, { maxBytes, accept }) {
    return new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(urlStr);
      } catch (_) {
        return reject(new ProviderError("BAD_URL", "invalid url", { retryable: false }));
      }
      if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname) || u.username || u.password || (u.port && u.port !== "443")) {
        return reject(new ProviderError("HOST_NOT_ALLOWED", "host is not an allowed provider", { retryable: false }));
      }
      const req = https.get(u, { headers: { "user-agent": userAgent, accept, "accept-encoding": "identity" }, timeout: timeoutMs }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, u).toString(), status });
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new ProviderError("RESPONSE_TOO_LARGE", "provider response too large", { retryable: false }));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", (e) => reject(new ProviderError("NETWORK", String(e.message).slice(0, 100))));
      });
      req.on("timeout", () => req.destroy(new ProviderError("TIMEOUT", "provider request timed out")));
      req.on("error", (e) => reject(e instanceof ProviderError ? e : new ProviderError("NETWORK", String(e.message).slice(0, 100))));
    });
  }
  return async function http(url, { maxBytes = METADATA_MAX_BYTES, accept = "application/json" } = {}) {
    let target = url;
    for (let i = 0; i <= maxRedirects; i++) {
      const r = await once(target, { maxBytes, accept });
      if (r.redirect) {
        target = r.redirect;
        continue;
      }
      return r;
    }
    throw new ProviderError("TOO_MANY_REDIRECTS", "too many redirects", { retryable: false });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// parsing helpers (pure)
// ---------------------------------------------------------------------------------------------------------------
function reconstructAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  const words = [];
  for (const [w, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (Number.isInteger(p) && p >= 0 && p < 20000) words[p] = w;
  }
  return words.filter((w) => w !== undefined).join(" ");
}

const afterSlash = (u) => (typeof u === "string" ? u.replace(/\/+$/, "").split("/").pop() : null);

function parseOpenAlexWork(w) {
  if (!w || typeof w !== "object") return null;
  const ids = w.ids || {};
  const doi = normalizeDoi(w.doi || ids.doi || "") || null;
  const pmid = ids.pmid ? afterSlash(ids.pmid) : null;
  const pmcidRaw = ids.pmcid ? afterSlash(ids.pmcid) : null;
  const pmcid = pmcidRaw && /^PMC\d+$/i.test(pmcidRaw) ? pmcidRaw.toUpperCase() : null;
  let arxivId = null;
  for (const loc of Array.isArray(w.locations) ? w.locations : []) {
    const lp = loc && (loc.landing_page_url || loc.pdf_url);
    const a = typeof lp === "string" && /arxiv\.org\//i.test(lp) ? normalizeArxiv(lp) : null;
    if (a) {
      arxivId = a;
      break;
    }
  }
  const authors = (Array.isArray(w.authorships) ? w.authorships : []).map((a) => a && a.author && a.author.display_name).filter(Boolean).slice(0, 100);
  const venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || null;
  return {
    provider: "OpenAlex",
    title: w.title || w.display_name || "",
    authors,
    year: Number.isInteger(w.publication_year) ? w.publication_year : null,
    venue,
    doi,
    pmid: pmid && /^\d{1,9}$/.test(pmid) ? pmid : null,
    pmcid,
    arxivId,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    isOpenAccess: Boolean(w.open_access && w.open_access.is_oa),
    license: (w.best_oa_location && w.best_oa_location.license) || null
  };
}

function parseEuropePmcResult(r) {
  if (!r || typeof r !== "object") return null;
  const authors = r.authorList && Array.isArray(r.authorList.author)
    ? r.authorList.author.map((a) => a.fullName || [a.firstName, a.lastName].filter(Boolean).join(" ")).filter(Boolean)
    : typeof r.authorString === "string" ? r.authorString.replace(/\.$/, "").split(/,\s*/).filter(Boolean) : [];
  const pmcid = typeof r.pmcid === "string" && /^PMC\d+$/i.test(r.pmcid) ? r.pmcid.toUpperCase() : null;
  const year = Number(r.pubYear);
  return {
    provider: "EuropePMC",
    title: typeof r.title === "string" ? r.title.replace(/<[^>]+>/g, "").replace(/\.$/, "") : "",
    authors: authors.slice(0, 100),
    year: Number.isInteger(year) && year > 0 ? year : null,
    venue: (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || r.bookOrReportDetails?.publisher || null,
    doi: normalizeDoi(r.doi || "") || null,
    pmid: typeof r.pmid === "string" && /^\d{1,9}$/.test(r.pmid) ? r.pmid : null,
    pmcid,
    arxivId: null,
    abstract: typeof r.abstractText === "string" ? r.abstractText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "",
    isOpenAccess: r.isOpenAccess === "Y" && Boolean(pmcid),
    license: typeof r.license === "string" ? r.license : null
  };
}

function parseArxivAtom(xml) {
  const markup = require("./markup");
  const root = markup.parse(xml);
  const entry = markup.findFirst(root, "entry");
  if (!entry) return null;
  const idText = (markup.findFirst(entry, "id") && markup.textOf(markup.findFirst(entry, "id"))) || "";
  const title = markup.textOf(markup.findFirst(entry, "title") || { children: [] });
  if (!title || /^error$/i.test(title)) return null; // arXiv returns an <entry> titled "Error" for bad ids
  const summary = markup.textOf(markup.findFirst(entry, "summary") || { children: [] });
  const published = markup.textOf(markup.findFirst(entry, "published") || { children: [] });
  const year = /^(\d{4})/.exec(published);
  const authors = markup.findAll(entry, "author").map((a) => markup.textOf(markup.findFirst(a, "name") || { children: [] })).filter(Boolean);
  const doiEl = markup.findAll(entry, "arxiv:doi")[0];
  return {
    provider: "arXiv",
    title,
    authors: authors.slice(0, 100),
    year: year ? Number(year[1]) : null,
    venue: "arXiv",
    doi: doiEl ? normalizeDoi(markup.textOf(doiEl)) : null,
    pmid: null,
    pmcid: null,
    arxivId: normalizeArxiv(idText),
    abstract: summary,
    isOpenAccess: true,
    license: null
  };
}

/** Merge records describing the same paper: first non-empty value per field wins, in the order given. */
function mergeRecords(records) {
  const out = { providers: [], title: "", authors: [], year: null, venue: null, doi: null, pmid: null, pmcid: null, arxivId: null, abstract: "", isOpenAccess: false, license: null };
  for (const r of records.filter(Boolean)) {
    out.providers.push(r.provider);
    for (const f of ["title", "venue", "doi", "pmid", "pmcid", "arxivId", "year", "license"]) if (!out[f] && r[f]) out[f] = r[f];
    if (!out.authors.length && r.authors.length) out.authors = r.authors;
    if (r.abstract && r.abstract.length > out.abstract.length) out.abstract = r.abstract;
    if (r.isOpenAccess) out.isOpenAccess = true;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the provider facade
// ---------------------------------------------------------------------------------------------------------------
function createProviders({ http, env = process.env, logger = console } = {}) {
  const contact = (env.CONTACT_EMAIL || env.UNPAYWALL_EMAIL || "").trim();
  const mailto = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) ? `&mailto=${encodeURIComponent(contact)}` : "";
  const getHttp = http || createHttpsGet({ userAgent: `shoRDs/1.0 (research-intelligence${contact ? `; mailto:${contact}` : ""})` });

  async function getJson(provider, url, { notFoundOk = true } = {}) {
    let r;
    try {
      r = await getHttp(url, { accept: "application/json" });
    } catch (e) {
      if (e instanceof ProviderError) throw Object.assign(e, { provider });
      throw new ProviderError("NETWORK", String((e && e.message) || e).slice(0, 100), { provider });
    }
    if (r.status === 404 && notFoundOk) return null;
    if (r.status === 429 || r.status >= 500) throw new ProviderError(r.status === 429 ? "RATE_LIMITED" : "PROVIDER_5XX", `${provider} returned ${r.status}`, { httpStatus: r.status, provider });
    if (r.status < 200 || r.status >= 300) throw new ProviderError("PROVIDER_REJECTED", `${provider} returned ${r.status}`, { retryable: false, httpStatus: r.status, provider });
    try {
      return JSON.parse(r.body);
    } catch (_) {
      throw new ProviderError("BAD_PAYLOAD", `${provider} returned invalid JSON`, { retryable: false, provider });
    }
  }

  async function getText(provider, url, accept, maxBytes) {
    let r;
    try {
      r = await getHttp(url, { accept, maxBytes });
    } catch (e) {
      if (e instanceof ProviderError) throw Object.assign(e, { provider });
      throw new ProviderError("NETWORK", String((e && e.message) || e).slice(0, 100), { provider });
    }
    if (r.status === 404 || r.status === 400) return null;
    if (r.status === 429 || r.status >= 500) throw new ProviderError(r.status === 429 ? "RATE_LIMITED" : "PROVIDER_5XX", `${provider} returned ${r.status}`, { httpStatus: r.status, provider });
    if (r.status < 200 || r.status >= 300) throw new ProviderError("PROVIDER_REJECTED", `${provider} returned ${r.status}`, { retryable: false, httpStatus: r.status, provider });
    return { body: r.body, contentType: String((r.headers && (r.headers["content-type"] || r.headers["Content-Type"])) || "") };
  }

  const openAlexSelect = "select=id,doi,title,display_name,publication_year,ids,authorships,primary_location,locations,best_oa_location,open_access,abstract_inverted_index";

  async function openAlexByDoi(doi) {
    const j = await getJson("OpenAlex", `https://api.openalex.org/works/doi:${encodeURI(doi)}?${openAlexSelect}${mailto}`);
    return j ? parseOpenAlexWork(j) : null;
  }
  async function openAlexByPmid(pmid) {
    const j = await getJson("OpenAlex", `https://api.openalex.org/works/pmid:${pmid}?${openAlexSelect}${mailto}`);
    return j ? parseOpenAlexWork(j) : null;
  }
  async function europePmcSearch(query) {
    const j = await getJson("EuropePMC", `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=3`);
    const results = j && j.resultList && Array.isArray(j.resultList.result) ? j.resultList.result : [];
    return results.map(parseEuropePmcResult).filter(Boolean);
  }
  async function arxivById(id) {
    const t = await getText("arXiv", `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`, "application/atom+xml", METADATA_MAX_BYTES);
    return t ? parseArxivAtom(t.body) : null;
  }
  async function openAlexByTitle(title) {
    const j = await getJson("OpenAlex", `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=5&${openAlexSelect}${mailto}`);
    const results = j && Array.isArray(j.results) ? j.results : [];
    return results.map(parseOpenAlexWork).filter(Boolean);
  }

  /**
   * Resolve a canonical id to a metadata record. The returned record is only accepted if it really is the requested paper:
   * its own identifiers (or, for title ids, its recomputed canonical id) must match the request.
   * @returns {Promise<object|null>} merged record, or null when no provider knows the paper
   */
  async function fetchMetadata(ref) {
    const { kind, value, canonicalId } = ref;
    const records = [];
    if (kind === "doi") {
      const [oa, epmc] = await Promise.all([openAlexByDoi(value), europePmcSearch(`DOI:"${value}"`)]);
      if (oa && oa.doi === value) records.push(oa);
      records.push(...epmc.filter((r) => r.doi === value));
    } else if (kind === "pmid") {
      const [epmc, oa] = await Promise.all([europePmcSearch(`EXT_ID:${value} AND SRC:MED`), openAlexByPmid(value)]);
      records.push(...epmc.filter((r) => r.pmid === value));
      if (oa && oa.pmid === value) records.push(oa);
    } else if (kind === "arxiv") {
      const a = await arxivById(value);
      if (a && a.arxivId === value) records.push(a);
    } else if (kind === "title") {
      // A title cannot be looked up by key. Search, then accept only a candidate whose canonical id equals the request.
      const wanted = value.replace(/-[a-z]{0,40}-\d{4}$/, "");
      const candidates = await openAlexByTitle(wanted);
      const hit = candidates.find((c) => canonicalPaperId({ title: c.title, authors: c.authors, pubYear: c.year }) === canonicalId);
      if (hit) records.push(hit);
    }
    if (records.length === 0) return null;
    const merged = mergeRecords(records);
    // Cross-check: the record must itself list the identifier that was requested, so a provider that answers with a
    // different work (a redirect, a fuzzy match) can never be stored under the requested paper id.
    const lists = (kind === "doi" && merged.doi === value) || (kind === "pmid" && merged.pmid === value) || (kind === "arxiv" && merged.arxivId === value) || kind === "title";
    if (!lists) return null;
    return merged;
  }

  /**
   * Fetch open-access full text for a metadata record. Order: Europe PMC JATS (needs a PMCID and an open-access flag), then
   * arXiv HTML (needs an arXiv id). Returns null when neither source has it.
   * @returns {Promise<{format:string, body:string, url:string, source:string, license:string|null}|null>}
   */
  async function fetchFullText(record) {
    if (record.pmcid && record.isOpenAccess) {
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${record.pmcid}/fullTextXML`;
      const t = await getText("EuropePMC", url, "application/xml", FULLTEXT_MAX_BYTES);
      if (t && /<article[\s>]/i.test(t.body)) return { format: "JATS_XML", body: t.body, url, source: "Europe PMC", license: record.license || null };
    }
    if (record.arxivId) {
      const url = `https://arxiv.org/html/${record.arxivId}`;
      const t = await getText("arXiv", url, "text/html", FULLTEXT_MAX_BYTES);
      if (t && /text\/html|application\/xhtml/i.test(t.contentType || "text/html") && /ltx_|<article/i.test(t.body)) return { format: "HTML", body: t.body, url, source: "arXiv HTML", license: record.license || null };
    }
    return null;
  }

  return { fetchMetadata, fetchFullText };
}

/** Do two titles describe the same paper? Token Jaccard on normalised titles; used to reject a full text for the wrong paper. */
function titlesMatch(a, b, threshold = 0.6) {
  const ta = new Set(normalizeTitleString(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizeTitleString(b).split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter) >= threshold;
}

module.exports = { createProviders, createHttpsGet, ProviderError, parseOpenAlexWork, parseEuropePmcResult, parseArxivAtom, mergeRecords, reconstructAbstract, titlesMatch, ALLOWED_HOSTS };
