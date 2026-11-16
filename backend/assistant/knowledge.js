"use strict";
/**
 * The assistant's product knowledge base: plain markdown files in ./kb, one topic per file, with a small front-matter block
 *   id, title, status (implemented | planned), tags (comma separated)
 * and a VERSION file. The files are the single source of truth for what the assistant may say about the app; they are loaded once,
 * validated, and frozen. A broken knowledge base fails loudly at startup (and in the unit tests), never silently at answer time.
 */

const fs = require("fs");
const path = require("path");

const KB_DIR = path.join(__dirname, "kb");
const STATUSES = new Set(["implemented", "planned"]);
const MAX_DOC_CHARS = 6000;

function parseDoc(file, raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`knowledge base file ${file} has no front matter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const k of ["id", "title", "status", "tags"]) if (!meta[k]) throw new Error(`knowledge base file ${file} is missing "${k}"`);
  if (!/^[a-z0-9-]{1,40}$/.test(meta.id)) throw new Error(`knowledge base file ${file} has an invalid id`);
  if (!STATUSES.has(meta.status)) throw new Error(`knowledge base file ${file} has an unknown status "${meta.status}"`);
  const body = m[2].trim();
  if (!body || body.length > MAX_DOC_CHARS) throw new Error(`knowledge base file ${file} must have 1-${MAX_DOC_CHARS} characters of content`);
  return Object.freeze({ id: meta.id, title: meta.title, status: meta.status, tags: Object.freeze(meta.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)), body });
}

function loadKnowledge(dir = KB_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) throw new Error("the assistant knowledge base is empty");
  const docs = files.map((f) => parseDoc(f, fs.readFileSync(path.join(dir, f), "utf8")));
  const ids = new Set();
  for (const d of docs) {
    if (ids.has(d.id)) throw new Error(`duplicate knowledge base id ${d.id}`);
    ids.add(d.id);
  }
  const version = fs.readFileSync(path.join(dir, "VERSION"), "utf8").trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version)) throw new Error("knowledge base VERSION must look like 2026.11.14");
  return Object.freeze({ version, docs: Object.freeze(docs) });
}

module.exports = { loadKnowledge, parseDoc, KB_DIR };
