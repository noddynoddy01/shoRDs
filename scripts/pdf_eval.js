#!/usr/bin/env node
"use strict";
/**
 * PDF extractor evaluation (Phase 6).
 *
 *   node scripts/pdf_eval.js make --out DIR
 *       builds a SYNTHETIC corpus of fictional PDFs with exact ground truth (needs Playwright + Chromium, pdftoppm). The papers are invented for
 *       this test; they are NOT real-world PDFs and results on them are not results on real papers.
 *   node scripts/pdf_eval.js run --corpus DIR [--out report.json] [--external name=DIR ...] [--ocr]
 *       scores `pdftotext` (poppler) in raw and layout mode, optionally OCR (tesseract) for scanned files, and any other extractor whose
 *       text output you saved as DIR/<docid>.txt|.md|.xml (GROBID TEI and Docling markdown are accepted; tags are stripped in document order).
 *   node scripts/pdf_eval.js truth-template --pdf file.pdf      (prints an empty ground-truth skeleton for a REAL permitted PDF you annotate by hand)
 *
 * Real PDFs: put <id>.pdf and <id>.truth.json (same schema as the synthetic ones) in a directory and use it as --corpus. Only use PDFs whose licence allows it.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const X = require("../backend/eval/pdfExtraction");
const { fromPlainText } = require("../backend/native/documentIntelligence");

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const multi = (n) => process.argv.reduce((a, v, i) => (v === `--${n}` ? [...a, process.argv[i + 1]] : a), []);

// ------------------------------------------------------------------------------------------------------------------ corpus
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const SECTIONS = [
  ["1 Introduction", ["Routing tokens to a small number of memory slots lowers the cost of attention in long documents, but earlier routing schemes lose accuracy when the evidence lies far from the question.", "We study whether a learned router can keep recall high at lower cost, and we report the cost in seconds per query and the recall in exact-match percent.", "Our contributions are threefold: a routing layer, a stable training recipe and a benchmark of 1,200 annotated questions."]],
  ["2 Methods", ["The routing layer replaces the dense attention of every fourth transformer layer. Each token is projected to a routing vector and assigned to its top-k slots by dot product, with k set to 4.", "Slots are updated with an exponential moving average of the assigned token states using a decay of 0.97, which keeps the slot statistics stable across batches.", "EQ1", "EQ2", "Training uses 38 billion tokens for 3 epochs on 12 accelerators with a learning rate of 3e-4 and a global batch of 512 sequences."]],
  ["3 Results", ["On the benchmark test split the routing model reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline and 82.6 percent for a sliding-window baseline.", "TABLE1", "Latency at 128k tokens falls from 41.2 seconds to 18.7 seconds per query, and peak memory falls from 61.0 to 38.5 gigabytes.", "Removing the moving-average update lowers accuracy to 83.0 percent, and setting k to 1 lowers it to 80.9 percent."]],
  ["4 Limitations", ["We evaluated only English text and a single model scale of 7 billion parameters, so the results may not carry over to other languages or sizes.", "Three people annotated the benchmark and we did not measure agreement on the evidence spans."]],
  ["5 Conclusion", ["Routing keeps long-range recall high at lower cost. Future work will test larger models and multilingual data."]]
];
const TABLE1 = [["Model", "Accuracy (%)", "Latency (s)", "Memory (GB)"], ["Dense", "79.1", "41.2", "61.0"], ["Sliding", "82.6", "30.4", "44.2"], ["Routing", "87.4", "18.7", "38.5"], ["Routing k=1", "80.9", "17.9", "36.1"]];
const EQ = { EQ1: "L = L_task + 0.01 L_route", EQ2: "A(Q,K,V) = softmax(Q K^T / sqrt(d_k)) V" };
const REFS = ["Tan S. Memory slots for attention. 2019.", "Okafor N. Sliding window models. 2020.", "Lindqvist A. Routing in transformers. 2021.", "Mehta R. Long context benchmarks. 2022.", "Ibarra C. Evidence annotation. 2022.", "Zhou W. Stable training of routers. 2023.", "Haddad F. Efficient inference. 2023.", "Novak P. Cost of attention. 2024."];
const TITLE = "Sparse Memory Routing for Long Documents (a fictional paper for extractor testing)";
const ABSTRACT = "We present a routing layer that assigns each token to at most four memory slots. On a benchmark of 1,200 questions it reaches 87.4 percent exact-match accuracy at 18.7 seconds per query, against 79.1 percent at 41.2 seconds for a dense baseline.";

function bodyBlocks() {
  const blocks = []; // {kind:'h'|'p'|'eq'|'table', ...}
  for (const [h, paras] of SECTIONS) {
    blocks.push({ kind: "h", text: h });
    for (const p of paras) blocks.push(p in EQ ? { kind: "eq", text: EQ[p] } : p === "TABLE1" ? { kind: "table", rows: TABLE1 } : { kind: "p", text: p });
  }
  blocks.push({ kind: "h", text: "References" });
  REFS.forEach((r, i) => blocks.push({ kind: "ref", text: `[${i + 1}] ${r}` }));
  return blocks;
}
const html = (b) => b.kind === "h" ? `<h2>${esc(b.text)}</h2>` : b.kind === "p" ? `<p>${esc(b.text)}</p>` : b.kind === "ref" ? `<p class="ref">${esc(b.text)}</p>` : b.kind === "eq" ? `<p class="eq">${esc(b.text)}</p>` : `<table>${b.rows.map((r, i) => `<tr>${r.map((c) => `<${i ? "td" : "th"}>${esc(c)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
const words = (s, n = 8) => s.split(/\s+/).slice(0, n).join(" ");

function truthFor(id, { pages, scanned = false, onlyPage1 = false }) {
  const blocks = bodyBlocks();
  const anchors = [{ text: words(ABSTRACT, 7), page: 1 }];
  blocks.filter((b) => b.kind === "p").forEach((b) => anchors.push({ text: words(b.text, 7), page: 0 }));
  return { id, pages, scanned, _synthetic: "FICTIONAL SYNTHETIC DOCUMENT FOR EXTRACTOR TESTING", anchors, headings: ["Abstract", ...blocks.filter((b) => b.kind === "h").map((b) => b.text)], tables: [{ rows: TABLE1 }], equations: Object.values(EQ), references: REFS.length };
}

async function make(out) {
  const { chromium } = require("playwright");
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const pdf = async (name, body, css, opts = {}) => {
    const p = await b.newPage();
    await p.setContent(`<html><head><style>body{font-family:serif;font-size:9.5pt;margin:0}h1{font-size:15pt;text-align:center;margin:0 0 6px}h2{font-size:11pt;margin:10px 0 3px}p{margin:0 0 5px;text-align:justify}.eq{text-align:center;font-style:italic}.ref{font-size:8.5pt}table{border-collapse:collapse;width:100%;margin:4px 0}td,th{border:1px solid #444;padding:2px 4px;font-size:8.5pt}.abs{margin:0 0 8px}${css}</style></head><body>${body}</body></html>`);
    await p.pdf({ path: path.join(out, name), format: "A4", displayHeaderFooter: true, headerTemplate: '<div style="font-size:7px;width:100%;text-align:center">Fictional Journal of Extractor Testing, vol. 1</div>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span></div>', margin: { top: "50px", bottom: "50px", left: "45px", right: "45px" }, ...opts });
    await p.close();
  };
  const head = `<h1>${esc(TITLE)}</h1><div class="abs"><h2>Abstract</h2><p>${esc(ABSTRACT)}</p></div>`;
  const blocks = bodyBlocks();
  const body = blocks.map(html).join("");
  // A: two columns, content stream in reading order
  await pdf("twocol_flow.pdf", `${head}<div style="column-count:2;column-gap:18px">${body}</div>`, "body{font-size:17pt}h2{font-size:18pt}");
  // B: two columns where the DOM (and so the content stream) lists the RIGHT column first: the visual order is right, the stream order is wrong
  const half = Math.ceil(blocks.length / 2);
  const left = blocks.slice(0, half).map(html).join(""), right = blocks.slice(half).map(html).join("");
  await pdf("twocol_scrambled.pdf", `${head}<div style="position:relative;height:1500px"><div style="position:absolute;left:50%;width:48%;top:0">${right}</div><div style="position:absolute;left:0;width:48%;top:0">${left}</div></div>`, "body{font-size:11pt}");
  // C: single column, table heavy
  await pdf("onecol_tables.pdf", `${head}${body}`, "body{font-size:15pt}");
  // D: scanned version of page 1 of A (image only, no text layer)
  const tmp = path.join(out, "_tmp");
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync("pdftoppm", ["-png", "-r", "150", "-f", "1", "-l", "1", path.join(out, "twocol_flow.pdf"), path.join(tmp, "p")]);
  const png = fs.readdirSync(tmp).find((f) => f.endsWith(".png"));
  const img = fs.readFileSync(path.join(tmp, png)).toString("base64");
  const p = await b.newPage();
  await p.setContent(`<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${img}"></body></html>`);
  await p.pdf({ path: path.join(out, "scanned_page1.pdf"), format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
  await p.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
  // ground truth: the page of every anchor is found by reading the reading-order text of the flow PDF (a correct stream order), so it is exact for A and B
  const flowText = execFileSync("pdftotext", [path.join(out, "twocol_flow.pdf"), "-"], { encoding: "utf8" });
  const pagesOfFlow = X.pagesOf(flowText).map(X.squash);
  const setPages = (t) => { for (const a of t.anchors) { const i = pagesOfFlow.findIndex((pg) => pg.includes(X.squash(a.text))); a.page = i >= 0 ? i + 1 : 1; } return t; };
  const nPages = (f) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(out, f)], { encoding: "utf8" }))[1]);
  for (const [id, f] of [["twocol_flow", "twocol_flow.pdf"], ["twocol_scrambled", "twocol_scrambled.pdf"], ["onecol_tables", "onecol_tables.pdf"]]) {
    const t = truthFor(id, { pages: nPages(f) });
    if (id === "twocol_flow" || id === "twocol_scrambled") setPages(t);
    else for (const a of t.anchors) a.page = 0; // page of an anchor is only graded for the two documents laid out identically
    fs.writeFileSync(path.join(out, `${id}.truth.json`), JSON.stringify(t, null, 1));
  }
  // scanned: the truth is only what is on page 1 of the flow PDF
  const first = X.squash(pagesOfFlow[0]);
  const t = truthFor("scanned_page1", { pages: 1, scanned: true });
  t.anchors = t.anchors.filter((a) => first.includes(X.squash(a.text))).map((a) => ({ ...a, page: 1 }));
  t.headings = t.headings.filter((h) => first.includes(X.squash(h)));
  t.tables = first.includes(X.squash("Accuracy (%)")) ? t.tables : [];
  t.equations = t.equations.filter((e) => first.includes(X.squash(e)));
  t.references = 0;
  fs.writeFileSync(path.join(out, "scanned_page1.truth.json"), JSON.stringify(t, null, 1));
  fs.writeFileSync(path.join(out, "scanned_page1.groundtruth.txt"), pagesOfFlow.length ? X.pagesOf(flowText)[0] : "");
  console.log(`corpus written to ${out}: ${fs.readdirSync(out).filter((f) => f.endsWith(".pdf")).join(", ")}`);
}

// --------------------------------------------------------------------------------------------------------------------- run
function timed(cmd, args) {
  const t0 = Date.now();
  // /usr/bin/time gives peak resident memory where it exists; otherwise only wall time is reported
  const hasTime = fs.existsSync("/usr/bin/time");
  const r = hasTime ? spawnSync("/usr/bin/time", ["-f", "%M", cmd, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }) : spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const peak = hasTime ? Number((r.stderr.trim().split("\n").pop() || "").trim()) : null;
  return { text: r.stdout || "", ms, peakRssMB: Number.isFinite(peak) && peak ? Math.round(peak / 1024) : null, ok: r.status === 0 };
}

function stripMarkup(s) { return /^\s*</.test(s) ? s.replace(/<(?:head|teiHeader)[\s\S]*?<\/(?:head|teiHeader)>/g, "").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : s.replace(/^#+\s*/gm, "").replace(/\*\*/g, ""); }

function pipelineView(text, id) {
  try {
    const d = fromPlainText(text, { paperId: id });
    return { sectionsFound: d.quality.sectionsFound, sectionsMissing: d.quality.sectionsMissing, chunks: d.quality.counts.chunks, tablesRecovered: d.quality.counts.tables, pageProvenance: d.quality.pageProvenance, flags: d.quality.flags.map((f) => f.code) };
  } catch (e) { return { error: e.message }; }
}

function run(corpus, outFile) {
  const ids = fs.readdirSync(corpus).filter((f) => f.endsWith(".truth.json")).map((f) => f.replace(/\.truth\.json$/, ""));
  const externals = multi("external").map((s) => { const [n, d] = s.split("="); return { name: n, dir: d }; });
  const rows = [];
  for (const id of ids) {
    const truth = JSON.parse(fs.readFileSync(path.join(corpus, `${id}.truth.json`), "utf8"));
    const pdf = path.join(corpus, `${id}.pdf`);
    const gtFile = path.join(corpus, `${id}.groundtruth.txt`);
    const gt = fs.existsSync(gtFile) ? fs.readFileSync(gtFile, "utf8") : null;
    const outputs = [];
    if (fs.existsSync(pdf)) {
      const raw = timed("pdftotext", [pdf, "-"]);
      outputs.push({ extractor: "poppler pdftotext (default order)", ...raw });
      const lay = timed("pdftotext", ["-layout", pdf, "-"]);
      outputs.push({ extractor: "poppler pdftotext -layout", ...lay });
      if (process.argv.includes("--ocr") && truth.scanned) {
        const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "ocr-"));
        execFileSync("pdftoppm", ["-png", "-r", "200", pdf, path.join(tmp, "p")]);
        const t0 = Date.now();
        let text = "";
        for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".png")).sort()) text += execFileSync("tesseract", [path.join(tmp, f), "-", "--psm", "1"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) + "\f";
        outputs.push({ extractor: "poppler render + tesseract OCR", text, ms: Date.now() - t0, peakRssMB: null, ok: true });
      }
    }
    for (const e of externals) {
      const f = ["txt", "md", "xml"].map((x) => path.join(e.dir, `${id}.${x}`)).find((p) => fs.existsSync(p));
      if (f) { const t0 = Date.now(); outputs.push({ extractor: e.name, text: stripMarkup(fs.readFileSync(f, "utf8")), ms: null, peakRssMB: null, ok: true, note: "text saved by the owner; runtime not measured here" }); }
    }
    for (const o of outputs) rows.push({ document: id, extractor: o.extractor, runtimeMs: o.ms, peakRssMB: o.peakRssMB, ...X.score(o.text, truth, { groundTruthText: gt }), pipeline: pipelineView(o.text, id) });
  }
  const res = { _kind: ids.some((i) => /^(twocol|onecol|scanned)/.test(i)) ? "SYNTHETIC_CORPUS_NOT_REAL_WORLD_PDFS" : "CORPUS_AS_SUPPLIED", measuredAt: new Date().toISOString(), poppler: (spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).stderr || "").split("\n")[0], tesseract: (spawnSync("tesseract", ["--version"], { encoding: "utf8" }).stdout || "").split("\n")[0], rows };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 2));
  const f = (x) => (x === null || x === undefined ? "n/a" : x);
  console.log("document | extractor | order recall/in-order | headings recall/in-order | table row integrity | equations | refs | page breaks/anchors on page | ms");
  for (const r of rows) console.log([r.document, r.extractor, `${f(r.readingOrder.recall)}/${f(r.readingOrder.inOrder)}`, `${f(r.headings.recall)}/${f(r.headings.inOrder)}`, r.tables ? `${r.tables.rowIntegrity} (cells ${r.tables.cellRecall})` : "n/a", r.equations ? r.equations.recall : "n/a", r.references ? r.references.recall : "n/a", `${r.pages.pageBreaksPreserved}/${f(r.pages.anchorsOnCorrectPage)}`, f(r.runtimeMs)].join(" | "));
  return res;
}

const cmd = process.argv[2];
if (cmd === "make") make(arg("out", "pdf_corpus")).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "run") run(arg("corpus"), arg("out"));
else if (cmd === "truth-template") { const n = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [arg("pdf")], { encoding: "utf8" }))[1]); console.log(JSON.stringify({ id: path.basename(arg("pdf"), ".pdf"), pages: n, scanned: false, anchors: [{ text: "first words of paragraph 1", page: 1 }], headings: ["Abstract"], tables: [{ rows: [["cell", "cell"]] }], equations: [], references: 0 }, null, 2)); }
else { console.error("usage: pdf_eval.js make|run|truth-template (see the header of this file)"); process.exit(2); }
