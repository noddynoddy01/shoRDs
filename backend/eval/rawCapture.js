"use strict";
/**
 * Benchmark-only capture of the model's RAW output (before the claim guard), so the F1 review kit can measure false drops.
 *
 * It is OFF unless an operator sets BOTH `BENCHMARK_RAW_CAPTURE=1` and `BENCHMARK_RAW_CAPTURE_DIR=<absolute path>` in the environment of
 * a LOCAL benchmark process. There is no request parameter, header, route or database setting that can switch it on, and nothing it writes
 * is ever returned by the API or stored in the database.
 *
 *   - refuses to start (throws at process start) in anything that looks like a deployment: NODE_ENV=production, any RAILWAY_* variable,
 *     VERCEL, or a relative / missing directory. A misconfigured production service therefore fails to boot instead of silently keeping text.
 *   - writes one JSON file per model call into its own directory (0700), files 0600. The record has the paper header, the exact chunk
 *     texts sent, the raw model text and the parsed object, token usage and versions. It has NO user id, tenant, project, job id,
 *     idempotency key or IP address, and its content is never passed to the logger.
 *   - keeps text only for papers whose licence clearly allows an internal evaluation set (licensePolicy.evalCorpus === "yes"); for any other
 *     paper only a metadata record is written, with the reason.
 *   - a capture failure never affects the request that triggered it.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { permissionsFor } = require("../papers/licensePolicy");

const DEPLOYMENT_SIGNS = (env) => Object.keys(env).filter((k) => /^RAILWAY_/.test(k) || k === "VERCEL" || k === "KUBERNETES_SERVICE_HOST").slice(0, 3);

class RawCaptureConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "RawCaptureConfigError";
  }
}

/** @returns {{dir:string}|null} null = disabled (the default). Throws RawCaptureConfigError when it is requested somewhere it must not run. */
function loadRawCaptureConfig(env = process.env) {
  const on = String(env.BENCHMARK_RAW_CAPTURE || "").trim();
  const dir = String(env.BENCHMARK_RAW_CAPTURE_DIR || "").trim();
  if (on === "" && dir === "") return null;
  if (on !== "1") throw new RawCaptureConfigError("BENCHMARK_RAW_CAPTURE must be exactly 1 to enable benchmark capture (or unset to disable).");
  if (String(env.NODE_ENV || "").toLowerCase() === "production") throw new RawCaptureConfigError("benchmark raw-output capture is refused when NODE_ENV=production.");
  const signs = DEPLOYMENT_SIGNS(env);
  if (signs.length) throw new RawCaptureConfigError(`benchmark raw-output capture is refused in a deployed environment (${signs.join(", ")} is set).`);
  if (!dir || !path.isAbsolute(dir)) throw new RawCaptureConfigError("BENCHMARK_RAW_CAPTURE_DIR must be an absolute path.");
  if (/[\u0000-\u001f]/.test(dir)) throw new RawCaptureConfigError("BENCHMARK_RAW_CAPTURE_DIR contains control characters.");
  return { dir: path.resolve(dir) };
}

/**
 * @param {{dir:string}} cfg
 * @param {{now?:()=>number}} [deps]
 * @returns {{record:(entry:object)=>{written:boolean, file:string|null, reason?:string}}}
 */
function createRawCapture(cfg, { now = Date.now } = {}) {
  fs.mkdirSync(cfg.dir, { recursive: true, mode: 0o700 });
  function record(e) {
    const perm = permissionsFor(e && e.paper && e.paper.license);
    const textOk = perm.evalCorpus === "yes";
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const id = crypto.createHash("sha256").update(String(e.paper && e.paper.paperId)).digest("hex").slice(0, 10);
    const file = path.join(cfg.dir, `${stamp}_${id}_${String(e.requestId || "req").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}.json`);
    const out = {
      kind: "BENCHMARK_RAW_MODEL_OUTPUT",
      note: "Local benchmark data. Contains paper text and model output; never commit it, never put it in a log, a database or a response.",
      capturedAt: new Date(now()).toISOString(),
      paper: { paperId: e.paper.paperId, title: e.paper.title || null, license: perm.license.normalised, doi: e.paper.doi || null, sourceUrl: e.paper.sourceUrl || null },
      textKept: textOk,
      promptVersion: e.promptVersion, schemaVersion: e.schemaVersion || null, model: e.model, depth: e.depth, stopReason: e.stopReason || null, truncated: Boolean(e.truncated),
      usage: e.usage || null, costUsd: e.costUsd === undefined ? null : e.costUsd, costStatus: e.costStatus || null
    };
    if (textOk) {
      out.chunks = e.chunks.map((c) => ({ chunkId: c.chunkId, section: c.section || null, text: c.text }));
      out.rawText = e.rawText;
      out.modelOutput = e.modelOutput === undefined ? null : e.modelOutput;
    } else {
      out.reason = `licence "${perm.license.normalised}" does not clearly allow keeping the text in an evaluation set (${perm.reason})`;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return textOk ? { written: true, file } : { written: true, file, reason: out.reason };
  }
  return { record };
}

module.exports = { loadRawCaptureConfig, createRawCapture, RawCaptureConfigError };
