#!/usr/bin/env node
"use strict";
/**
 * Real-model pilot driver (Phase 6). LOCAL ONLY: it talks to a model server on 127.0.0.1 / localhost and refuses anything else.
 * It spends nothing, uploads nothing and touches no production system.
 *
 *   node scripts/native_pilot.js probe  [--model-dir DIR] [--out hardware.json]
 *       hardware inventory of THIS machine (CPU, RAM, GPU/VRAM via nvidia-smi, CUDA, free disk, which runtimes are on PATH)
 *   node scripts/native_pilot.js server --base http://127.0.0.1:8080/v1 --model NAME [--out server.json]
 *       checks the local server answers, reads what it reports about itself, and measures one short generation
 *   node scripts/native_pilot.js run    --papers papers.json --base http://127.0.0.1:8080/v1 --model NAME --out DIR
 *            [--revision SHA] [--quant MXFP4] [--runtime "llama.cpp bNNNN"] [--limit N] [--timeout-ms 900000] [--headroom 1500]
 *            [--reasoning-effort low|medium|high] [--no-thinking] [--concurrency 1] [--hardware hardware.json]
 *       runs system B (one prompt) and system C (the multi-stage pipeline) with the SAME model on the SAME chunks of each licensed paper,
 *       writes per-paper results, a measurements report, and blinded rating sheets for B versus C
 *   node scripts/native_pilot.js report --dir DIR      (rebuilds REPORT.md from the saved records)
 *
 * papers.json = { "papers": [ { "paperId", "title", "file", "format": "jats"|"text"|"pdf", "category",
 *                              "licence": { "spdx", "confirmedBy", "confirmedOn", "sourceUrl", "fullTextAllowed": true } } ] }
 *   A paper is processed only if a person recorded `licence.confirmedBy` AND the licence policy (papers/licensePolicy.js) allows keeping the text
 *   and the outputs derived from it in an evaluation set. Otherwise it is skipped and the reason is printed. No fictional paper is accepted
 *   as evidence: a paper whose id starts with "pap_fixture" or "fictional" is refused.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createOpenAiCompatibleAdapter } = require("../backend/native/modelAdapter");
const { runNativePipeline } = require("../backend/native/pipeline");
const { runDirect } = require("../backend/native/directBaseline");
const { fromPlainText, fromStructured } = require("../backend/native/documentIntelligence");
const { extractJats } = require("../backend/papers/extract");
const { permissionsFor } = require("../backend/papers/licensePolicy");
const C = require("../backend/eval/nativeCompare");
const M = require("../backend/eval/pilotMetrics");

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;
const die = (m, code = 2) => { console.error(m); process.exit(code); };
const tryRun = (cmd, args, timeout = 15000) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim(); } catch (_) { return null; } };
const onPath = (name) => tryRun(process.platform === "win32" ? "where" : "which", [name]);

// --------------------------------------------------------------------------------------------------------------------- probe
function probe(modelDir, out) {
  const cpus = os.cpus();
  const hw = {
    collectedAt: new Date().toISOString(), platform: process.platform, release: os.release(), arch: os.arch(), node: process.version,
    cpu: { model: cpus[0] && cpus[0].model, logicalCores: cpus.length },
    memory: { totalGB: Math.round((os.totalmem() / 1e9) * 10) / 10, freeGBAtProbe: Math.round((os.freemem() / 1e9) * 10) / 10 },
    gpu: { nvidia: null, cuda: null, other: null },
    runtimes: { "llama-server": onPath("llama-server"), "llama-cli": onPath("llama-cli"), ollama: onPath("ollama"), pdftotext: onPath("pdftotext"), python: onPath("python") },
    disk: null
  };
  const nv = tryRun("nvidia-smi", ["--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"]);
  if (nv) {
    hw.gpu.nvidia = nv.split(/\r?\n/).map((l) => { const [name, total, free, driver] = l.split(",").map((x) => x.trim()); return { name, vramTotalMiB: Number(total), vramFreeMiB: Number(free), driver }; });
    const head = tryRun("nvidia-smi", []);
    const m = head && /CUDA Version:\s*([\d.]+)/.exec(head);
    hw.gpu.cuda = m ? m[1] : null;
  }
  if (process.platform === "win32") { // read-only query of the display adapters; adapter RAM is reported as 32-bit by Windows and can be wrong above 4 GB
    const j = tryRun("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress"]);
    if (j) { try { hw.gpu.other = [].concat(JSON.parse(j)); } catch (_) { hw.gpu.other = j; } }
  }
  try { const s = fs.statfsSync(path.resolve(modelDir || ".")); hw.disk = { path: path.resolve(modelDir || "."), freeGB: Math.round((Number(s.bavail) * Number(s.bsize)) / 1e8) / 10, totalGB: Math.round((Number(s.blocks) * Number(s.bsize)) / 1e8) / 10 }; } catch (_) { /* leave null */ }
  const vram = hw.gpu.nvidia ? Math.max(...hw.gpu.nvidia.map((g) => g.vramTotalMiB)) / 1024 : 0;
  hw.summary = `${hw.cpu.model || "unknown CPU"}, ${hw.cpu.logicalCores} logical cores, ${hw.memory.totalGB} GB RAM, ${hw.gpu.nvidia ? `${hw.gpu.nvidia[0].name} ${(vram).toFixed(0)} GB VRAM (CUDA ${hw.gpu.cuda || "?"})` : "no NVIDIA GPU detected by nvidia-smi"}, ${hw.disk ? `${hw.disk.freeGB} GB free disk at ${hw.disk.path}` : "disk unknown"}`;
  hw.fit = {
    "gpt-oss-20b (MXFP4, ~12 GB weights)": vram >= 16 ? "fits in GPU memory" : hw.memory.totalGB >= 16 ? "CPU inference possible (needs ~13+ GB free RAM; slower)" : "does not fit",
    "Qwen3.8-27B (4-bit, ~16-19 GB weights)": vram >= 24 ? "fits in GPU memory" : hw.memory.totalGB >= 32 ? "CPU inference possible (dense model: slow)" : "does not fit"
  };
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(hw, null, 2)); }
  console.log(JSON.stringify(hw, null, 2));
}

// -------------------------------------------------------------------------------------------------------------------- server
async function serverCheck(base, name, out) {
  if (!LOCAL.test(base)) die("refused: only a local model server (127.0.0.1 / localhost) is allowed.");
  const root = base.replace(/\/v1\/?$/, "");
  const get = async (p) => { try { const r = await fetch(root + p, { signal: AbortSignal.timeout(10000) }); return r.ok ? await r.json() : { httpStatus: r.status }; } catch (e) { return { error: e.name }; } };
  const rec = { checkedAt: new Date().toISOString(), base, models: await get("/v1/models"), props: await get("/props"), health: await get("/health") };
  const model = createOpenAiCompatibleAdapter({ baseUrl: base, model: name, jsonMode: false });
  try {
    const r = await model.callMessages({ system: "Answer with one short sentence.", user: "Say that the local model server is working.", maxTokens: 48, timeoutMs: 600000 });
    rec.smoke = { ok: true, text: r.text.slice(0, 200), usage: r.usage, latencyMs: r.latencyMs, serverTimings: r.serverTimings, truncated: r.truncated };
  } catch (e) { rec.smoke = { ok: false, category: e.category || "UNKNOWN", message: e.message }; }
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(rec, null, 2)); }
  console.log(JSON.stringify(rec, null, 2));
}

// ----------------------------------------------------------------------------------------------------------------------- run
const ALLOWED_FORMATS = new Set(["jats", "text", "pdf"]);
function checkPaper(p, baseDir) {
  if (!p || typeof p !== "object") return "BAD_ENTRY";
  if (/^(pap_fixture|fictional|demo)/i.test(String(p.paperId || ""))) return "FICTIONAL_PAPER_NOT_ACCEPTED_AS_EVIDENCE";
  if (!p.paperId || !p.file || !ALLOWED_FORMATS.has(p.format)) return "MISSING_FIELD_OR_BAD_FORMAT";
  const l = p.licence;
  if (!l || !l.spdx || !l.confirmedBy || !l.confirmedOn) return "LICENCE_NOT_CONFIRMED_BY_A_PERSON";
  const perm = permissionsFor(l.spdx);
  if (perm.evalCorpus !== "yes") return `LICENCE_DOES_NOT_CLEARLY_ALLOW_EVALUATION_USE(${perm.evalCorpus})`;
  if (l.fullTextAllowed !== true) return "FULL_TEXT_NOT_CONFIRMED";
  if (!fs.existsSync(path.resolve(baseDir, p.file))) return "FILE_NOT_FOUND";
  return null;
}

function loadDoc(p, baseDir) {
  const file = path.resolve(baseDir, p.file);
  if (p.format === "jats") return fromStructured({ paperId: p.paperId, ...extractJats(fs.readFileSync(file, "utf8")) }, { abstractOnly: false });
  if (p.format === "pdf") return fromPlainText(execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }), { paperId: p.paperId, title: p.title });
  return fromPlainText(fs.readFileSync(file, "utf8"), { paperId: p.paperId, title: p.title });
}

const safeName = (id) => String(id).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

async function run() {
  const papersFile = arg("papers"), base = arg("base"), name = arg("model"), outDir = arg("out");
  if (!papersFile || !base || !name || !outDir) die("usage: native_pilot.js run --papers papers.json --base http://127.0.0.1:PORT/v1 --model NAME --out DIR (see the header of this file)");
  if (!LOCAL.test(base)) die("refused: only a local model server (127.0.0.1 / localhost) is allowed. Paid or remote inference needs an explicit approval and is not available here.");
  const manifest = JSON.parse(fs.readFileSync(papersFile, "utf8"));
  const baseDir = path.dirname(path.resolve(papersFile));
  const effort = arg("reasoning-effort", null);
  const noThinking = process.argv.includes("--no-thinking"); // Qwen3-style hybrid models: ask the chat template for the non-thinking mode
  const model = createOpenAiCompatibleAdapter({
    baseUrl: base, model: name, jsonMode: false, timeoutMs: Number(arg("timeout-ms", 900000)), reasoningHeadroomTokens: Number(arg("headroom", 0)),
    extraBody: effort || noThinking ? { chat_template_kwargs: { ...(effort ? { reasoning_effort: effort } : {}), ...(noThinking ? { enable_thinking: false } : {}) } } : undefined
  });
  const hardware = arg("hardware") ? JSON.parse(fs.readFileSync(arg("hardware"), "utf8")) : null;
  const meta = { model: name, revision: arg("revision", "NOT RECORDED"), quantization: arg("quant", "NOT RECORDED"), runtime: arg("runtime", "NOT RECORDED"), hardware: hardware || { summary: "NOT RECORDED (run `probe` and pass --hardware)" }, startedAt: new Date().toISOString(), pipeline: require("../backend/native/pipeline").PIPELINE_VERSION, promptVersion: require("../backend/native/prompts").PROMPT_VERSION };
  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "papers"), { recursive: true });
  const limit = Number(arg("limit", 3));
  const concurrency = Number(arg("concurrency", 1));
  const records = [], items = [], skipped = [];
  for (const p of (manifest.papers || [])) {
    if (records.length >= limit) break;
    const why = checkPaper(p, baseDir);
    if (why) { skipped.push({ paperId: p && p.paperId, reason: why }); console.log(`skipped ${p && p.paperId}: ${why}`); continue; }
    console.log(`\n== ${p.paperId} (${p.category || "uncategorised"})`);
    const doc = loadDoc(p, baseDir);
    const chunks = doc.chunks;
    const passages = Object.fromEntries(chunks.map((c) => [c.chunkId, c.text]));
    const raw = [];
    // B: one prompt
    const tB = Date.now();
    const b = await runDirect({ model, chunks, coverage: "FULL_TEXT", onRaw: (x) => raw.push({ system: "B", ...x }) });
    const bMs = Date.now() - tB;
    const secB = b.ok ? C.sectionsFromValidated(b.validation.sections) : null;
    console.log(`   B one-shot: ${b.ok ? `${b.validation.stats.supported} shown, ${b.validation.stats.withheld} withheld` : `FAILED (${b.category})`} in ${bMs} ms`);
    // C: multi-stage, on exactly the same chunks (same ids, same text)
    const c = await runNativePipeline({ model, input: { paperId: p.paperId, title: p.title, chunks }, fullTextAllowed: true, options: { concurrency, onRaw: (x) => raw.push({ system: "C", ...x }) } });
    const secC = C.sectionsFromValidated(Object.fromEntries(c.brief.map((s) => [s.key, s.statements])));
    console.log(`   C pipeline: ${c.validation.supported} shown, ${c.validation.withheld.length} withheld, ${c.diagnostics.modelCalls} calls (${c.diagnostics.failedCalls} failed) in ${c.diagnostics.totalMs} ms`);
    const rec = { paper: { paperId: p.paperId, title: p.title, category: p.category || null, licence: p.licence, documentQuality: doc.quality, contentHash: doc.contentHash }, run: meta, B: M.summariseDirect(b, chunks, secB, bMs), C: M.summarisePipeline(c, chunks, secC) };
    records.push(rec);
    fs.writeFileSync(path.join(outDir, "papers", `${safeName(p.paperId)}.json`), JSON.stringify({ ...rec, results: { B: b.ok ? { sections: secB, withheld: b.validation.withheld } : null, C: { brief: c.brief, validation: c.validation, representation: c.representation } } }, null, 2));
    fs.writeFileSync(path.join(outDir, "raw", `${safeName(p.paperId)}.raw.json`), JSON.stringify(raw)); // local only: contains paper text and unfiltered model output
    const systems = { C_native_pipeline: { sections: secC, passages } };
    if (secB) systems.B_open_weight_direct = { sections: secB, passages };
    items.push({ paperId: p.paperId, title: p.title || p.paperId, link: p.licence.sourceUrl || "", license: p.licence.spdx, systems });
  }
  fs.writeFileSync(path.join(outDir, "run.json"), JSON.stringify({ meta, skipped, papers: records.map((r) => r.paper.paperId) }, null, 2));
  fs.writeFileSync(path.join(outDir, "records.json"), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(outDir, "items.json"), JSON.stringify(items, null, 2));
  writeReport(outDir);
  if (items.length) {
    const plan = C.buildComparisonPlan(items, { raters: ["rater_a", "rater_b"], seed: 1, kind: "HUMAN_RATED_STUDY" });
    fs.mkdirSync(path.join(outDir, "rating"), { recursive: true });
    for (const [r, csv] of Object.entries(plan.sheets)) fs.writeFileSync(path.join(outDir, "rating", `sheet_${r}.csv`), csv);
    fs.writeFileSync(path.join(outDir, "rating", "key.json"), JSON.stringify(plan.key, null, 2));
    console.log(`\nblinded rating sheets (B vs C) written to ${path.join(outDir, "rating")}; keep key.json away from the raters.`);
  }
  console.log(`\npapers processed: ${records.length}; skipped: ${skipped.length}. Report: ${path.join(outDir, "REPORT.md")}`);
}

function writeReport(dir) {
  const records = JSON.parse(fs.readFileSync(path.join(dir, "records.json"), "utf8"));
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const md = M.pilotReportMarkdown(records, run.meta) + (run.skipped.length ? `\n## Skipped papers\n\n${run.skipped.map((s) => `- ${s.paperId}: ${s.reason}`).join("\n")}\n` : "");
  fs.writeFileSync(path.join(dir, "REPORT.md"), md);
}

const cmd = process.argv[2];
if (cmd === "probe") probe(arg("model-dir", "."), arg("out"));
else if (cmd === "server") serverCheck(arg("base"), arg("model", "local"), arg("out")).catch((e) => die(`failed: ${e.message}`, 1));
else if (cmd === "run") run().catch((e) => die(`failed: ${e.category || ""} ${e.message}`, 1));
else if (cmd === "report") { writeReport(arg("dir")); console.log("report rebuilt"); }
else die("usage: native_pilot.js probe|server|run|report (see the header of this file)");
