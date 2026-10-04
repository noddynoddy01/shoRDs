"use strict";
/**
 * Document extraction: turn provider payloads into a structured document
 *   { title, abstract, sections:[{heading, level, paragraphs[]}], tables:[{caption, headers, rows}], figures:[{caption}] }
 * Supported full-text formats: JATS XML (Europe PMC / PubMed Central open-access articles) and article HTML (arXiv HTML,
 * built by LaTeXML). PDF is NOT parsed by this runtime (no PDF library can be installed); a PDF-only paper therefore
 * resolves to ABSTRACT_ONLY, never to a fabricated full text.
 *
 * Section headings are mapped to the scholarly taxonomy already used by the app (services/sectionExtractionService.ts).
 */

const markup = require("./markup");

const MAX_PARAGRAPH_CHARS = 20000;

/** Same taxonomy as services/sectionExtractionService.ts normalizeScholarlySectionName, with a few ordering fixes (e.g. "Data availability" is boilerplate, not a dataset). */
function normalizeSectionName(heading) {
  if (!heading) return "OTHER";
  const c = String(heading).trim().toLowerCase();
  if (c.includes("abstract")) return "ABSTRACT";
  if (c.includes("availability")) return "REFERENCES"; // data/code availability statements are boilerplate
  if (c.includes("introduction")) return "INTRODUCTION";
  if (c.includes("related work") || c.includes("prior work")) return "RELATED_WORK";
  if (c.includes("background") || c.includes("context")) return "BACKGROUND";
  if (c.includes("limitation") || c.includes("threats to validity")) return "LIMITATIONS";
  if (c.includes("future") || c.includes("outlook") || c.includes("horizon")) return "FUTURE_WORK";
  if (c.includes("method") || c.includes("approach") || c.includes("architecture") || c.includes("formulation") || c.includes("algorithm") || c.includes("model")) return "METHODOLOGY";
  if (c.includes("dataset") || c.includes("corpus") || c.includes("material") || c.includes("data")) return "DATASET";
  if (c.includes("setup") || c.includes("implementation") || c.includes("training")) return "EXPERIMENTAL_SETUP";
  if (c.includes("result") || c.includes("finding") || c.includes("evaluation") || c.includes("experiment") || c.includes("benchmark")) return "RESULTS";
  if (c.includes("discussion")) return "DISCUSSION";
  if (c.includes("conclusion") || c.includes("summary")) return "CONCLUSION";
  if (c.includes("reference") || c.includes("bibliography") || c.includes("acknowledg") || c.includes("funding") || c.includes("competing interest") || c.includes("conflict of interest") || c.includes("author contribution") || c.includes("supplementary")) return "REFERENCES";
  return "OTHER";
}

function cleanText(s) {
  return String(s).replace(/\s+/g, " ").replace(/\s+([.,;:!?)\]])/g, "$1").replace(/([(\[])\s+/g, "$1").trim();
}

function tableFromEl(tableEl, captionText) {
  const rows = [];
  for (const tr of markup.findAll(tableEl, "tr")) {
    const cells = (tr.children || []).filter((c) => markup.isEl(c) && (c.name === "td" || c.name === "th" || /^ltx_td|ltx_th/.test(c.attrs.class || ""))).map((c) => cleanText(markup.textOf(c)));
    if (cells.length) rows.push({ cells, header: (tr.children || []).some((c) => markup.isEl(c) && c.name === "th") });
  }
  if (rows.length === 0) return null;
  const headerRows = rows.filter((r) => r.header);
  const headers = headerRows.length ? headerRows[0].cells : [];
  const body = (headerRows.length ? rows.filter((r) => !r.header) : rows).map((r) => r.cells);
  return { caption: captionText || "", headers, rows: body.slice(0, 200) };
}

// ---------------------------------------------------------------------------------------------------------------
// JATS (Europe PMC / PMC open-access full text)
// ---------------------------------------------------------------------------------------------------------------
function extractJats(xml) {
  const root = markup.parse(xml);
  const article = markup.findFirst(root, "article");
  if (!article) return { ok: false, reason: "NOT_JATS" };

  const titleEl = markup.findFirst(markup.findFirst(article, "title-group") || article, "article-title");
  const title = titleEl ? cleanText(markup.textOf(titleEl)) : "";

  const absEl = markup.findAll(article, "abstract").find((a) => !a.attrs["abstract-type"] || a.attrs["abstract-type"] === "") || markup.findFirst(article, "abstract");
  const abstract = absEl ? cleanText(markup.childEls(absEl).filter((c) => c.name !== "title").map((c) => markup.textOf(c)).join(" ")) || cleanText(markup.textOf(absEl)) : "";

  const body = markup.findFirst(article, "body");
  const sections = [];
  const tables = [];
  const figures = [];

  function paragraphsIn(sec) {
    const out = [];
    for (const c of markup.childEls(sec)) {
      if (c.name === "p") {
        const t = cleanText(markup.textOf(c, { skip: (n) => n.name === "xref" && n.attrs["ref-type"] === "bibr" }));
        if (t.length > 1) out.push(t.slice(0, MAX_PARAGRAPH_CHARS));
      } else if (c.name === "list") {
        for (const li of markup.findAll(c, "list-item")) {
          const t = cleanText(markup.textOf(li));
          if (t) out.push(t.slice(0, MAX_PARAGRAPH_CHARS));
        }
      }
    }
    return out;
  }

  function visitSec(sec, path, level) {
    const titleChild = markup.childEls(sec, "title")[0];
    const heading = titleChild ? cleanText(markup.textOf(titleChild)) : "";
    const full = [...path, heading].filter(Boolean);
    const paragraphs = paragraphsIn(sec);
    if (paragraphs.length) sections.push({ heading: full.join(" > ") || "Body", leaf: heading, level, paragraphs });
    for (const sub of markup.childEls(sec, "sec")) visitSec(sub, full, level + 1);
  }

  if (body) {
    const direct = paragraphsIn(body);
    if (direct.length) sections.push({ heading: "Body", leaf: "Body", level: 1, paragraphs: direct });
    for (const sec of markup.childEls(body, "sec")) visitSec(sec, [], 1);
    for (const tw of markup.findAll(body, "table-wrap")) {
      const cap = markup.findFirst(tw, "caption");
      const tbl = markup.findFirst(tw, "table");
      const t = tbl ? tableFromEl(tbl, cap ? cleanText(markup.textOf(cap)) : "") : null;
      if (t) tables.push(t);
    }
    for (const fg of markup.findAll(body, "fig")) {
      const cap = markup.findFirst(fg, "caption");
      const text = cap ? cleanText(markup.textOf(cap)) : "";
      if (text) figures.push({ caption: text });
    }
  }
  return { ok: true, format: "JATS_XML", title, abstract, sections, tables, figures };
}

// ---------------------------------------------------------------------------------------------------------------
// Article HTML (arXiv HTML / LaTeXML and similar)
// ---------------------------------------------------------------------------------------------------------------
const hasClass = (n, cls) => (n.attrs.class || "").split(/\s+/).includes(cls);

function extractHtmlArticle(html) {
  const root = markup.parse(html);
  const article = markup.findFirst(root, "article") || markup.findFirst(root, "main") || markup.findFirst(root, "body") || root;

  let title = "";
  const h1 = markup.findAll(article, "h1").find((h) => hasClass(h, "ltx_title_document")) || markup.findFirst(article, "h1");
  if (h1) title = cleanText(markup.textOf(h1));
  if (!title) {
    const t = markup.findFirst(root, "title");
    title = t ? cleanText(markup.textOf(t)) : "";
  }

  let abstract = "";
  const absEl = markup.findAll(article, "div").find((d) => hasClass(d, "ltx_abstract")) || markup.findAll(article, "section").find((d) => /abstract/i.test(d.attrs.id || "") || hasClass(d, "ltx_abstract"));
  if (absEl) {
    abstract = cleanText(markup.findAll(absEl, "p").map((p) => markup.textOf(p)).join(" "));
    if (!abstract) abstract = cleanText(markup.textOf(absEl)).replace(/^abstract[:.]?\s*/i, "");
  }

  const sections = [];
  const tables = [];
  const figures = [];

  const sectionEls = markup.findAll(article, "section").filter((s) => hasClass(s, "ltx_section") || hasClass(s, "ltx_subsection") || hasClass(s, "ltx_subsubsection") || hasClass(s, "ltx_appendix"));
  const headingOf = (sec) => {
    const h = (sec.children || []).find((c) => markup.isEl(c) && /^h[1-6]$/.test(c.name));
    return h ? cleanText(markup.textOf(h)).replace(/^\d+(\.\d+)*\.?\s+/, "") : "";
  };
  const parentHeadings = (sec) => {
    const path = [];
    for (let n = sec.parent; n; n = n.parent) if (markup.isEl(n) && n.name === "section") {
      const h = headingOf(n);
      if (h) path.unshift(h);
    }
    return path;
  };
  for (const sec of sectionEls) {
    const heading = headingOf(sec);
    // paragraphs belonging directly to this section (not to sub-sections)
    const paras = [];
    for (const c of sec.children || []) {
      if (!markup.isEl(c)) continue;
      if (c.name === "section") continue;
      const pEls = c.name === "p" ? [c] : markup.findAll(c, "p").filter((p) => {
        for (let n = p.parent; n && n !== sec; n = n.parent) if (markup.isEl(n) && (n.name === "section" || n.name === "figure" || n.name === "table")) return false;
        return true;
      });
      for (const p of pEls) {
        const t = cleanText(markup.textOf(p, { skip: (n) => n.name === "cite" || hasClass(n, "ltx_cite") }));
        if (t.length > 1) paras.push(t.slice(0, MAX_PARAGRAPH_CHARS));
      }
    }
    if (paras.length) {
      const full = [...parentHeadings(sec), heading].filter(Boolean);
      sections.push({ heading: full.join(" > ") || "Body", leaf: heading, level: full.length || 1, paragraphs: paras });
    }
  }

  for (const fg of markup.findAll(article, "figure")) {
    const cap = markup.findFirst(fg, "figcaption");
    const capText = cap ? cleanText(markup.textOf(cap)) : "";
    const tbl = markup.findFirst(fg, "table");
    if (tbl) {
      const t = tableFromEl(tbl, capText);
      if (t) tables.push(t);
    } else if (capText) figures.push({ caption: capText });
  }
  return { ok: true, format: "HTML", title, abstract, sections, tables, figures };
}

module.exports = { extractJats, extractHtmlArticle, normalizeSectionName, cleanText };
