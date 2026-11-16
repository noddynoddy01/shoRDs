#!/usr/bin/env node
"use strict";
/**
 * Run the native research-intelligence prototype on ONE local paper file. Local only; nothing is uploaded; no production system is touched.
 *
 *   node scripts/native_run_local.js --file paper.txt|paper.pdf|paper.xml --paper-id pap_demo [--model stub|<local base url> --model-name NAME]
 *                                    [--full-text-allowed] [--json out.json] [--raw-dir DIR]
 *
 *  - Default model is the free extractive STUB (not a language model).
 *  - A local OpenAI-compatible server (llama.cpp / vLLM / Ollama on 127.0.0.1) is used with --model http://127.0.0.1:PORT/v1 --model-name NAME.
 *  - A remote endpoint is NOT supported by this script: paid inference needs an approval, a verified price and a ceiling (see docs/phase5).
 *  - --full-text-allowed is YOUR statement that the paper's licence allows processing its full text; without it only the abstract is used.
 *  - PDF input uses the `pdftotext` program if installed (poppler); table cells and equations are not preserved (see the quality report).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createStubAdapter, createOpenAiCompatibleAdapter } = require("../backend/native/modelAdapter");
const { runNativePipeline, renderText } = require("../backend/native/pipeline");
const { extractJats } = require("../backend/papers/extract");

function arg(name, dflt = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? dflt : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); }

(async () => {
  const file = arg("file");
  if (!file || file === true) { console.error("usage: node scripts/native_run_local.js --file <paper.txt|.pdf|.xml> [--paper-id id] [--model stub|http://127.0.0.1:PORT/v1 --model-name NAME] [--full-text-allowed]"); process.exit(2); }
  const paperId = String(arg("paper-id", "pap_local"));
  let input;
  if (/\.pdf$/i.test(file)) input = { paperId, plainText: execFileSync("pdftotext", [path.resolve(file), "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) };
  else if (/\.xml$/i.test(file)) input = { paperId, ...extractJats(fs.readFileSync(file, "utf8")) };
  else input = { paperId, plainText: fs.readFileSync(file, "utf8") };
  const m = arg("model", "stub");
  let model;
  if (m === "stub") model = createStubAdapter();
  else {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(m)) { console.error("refused: this script only talks to a local server (127.0.0.1 / localhost). Remote inference needs an explicit approval and is not available here."); process.exit(2); }
    model = createOpenAiCompatibleAdapter({ baseUrl: m, model: String(arg("model-name", "local")), jsonMode: false });
  }
  const rawDir = arg("raw-dir");
  const raw = [];
  const r = await runNativePipeline({ model, input, fullTextAllowed: arg("full-text-allowed") === true, options: { onRaw: rawDir ? (x) => raw.push(x) : null } });
  console.log(renderText(r));
  console.log(`\n-- diagnostics: ${r.diagnostics.modelCalls} model calls, ${r.diagnostics.totalMs} ms, tokens in/out ${r.diagnostics.tokens.input}/${r.diagnostics.tokens.output}, cost ${r.diagnostics.costUsd === null ? "not measured" : `$${r.diagnostics.costUsd}`}; withheld ${r.validation.withheld.length} of ${r.validation.checked} statements`);
  if (r.document.quality.flags.length) console.log(`-- extraction notes: ${r.document.quality.flags.map((f) => f.code).join(", ")}`);
  const out = arg("json");
  if (out && out !== true) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  if (rawDir && rawDir !== true) { fs.mkdirSync(rawDir, { recursive: true }); fs.writeFileSync(path.join(rawDir, `${paperId}.raw.json`), JSON.stringify(raw)); console.log(`-- raw model output written to ${rawDir} (local files; they contain paper text)`); }
})().catch((e) => { console.error(`failed: ${e.category || ""} ${e.message}`); process.exit(1); });
