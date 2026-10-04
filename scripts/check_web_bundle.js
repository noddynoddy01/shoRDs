#!/usr/bin/env node
"use strict";
/**
 * Scan a built web bundle (default ./dist, the output of `npx expo export --platform web`) for things that must never ship to a
 * browser: private keys, provider API keys and hosts, server connection strings, server-only variable names and literal bearer
 * tokens. Zero dependencies. Prints one JSON line per finding; exit 1 if any, 0 if clean.
 *
 *   node scripts/check_web_bundle.js [dir] [--public-firebase-key <the EXPO_PUBLIC_FIREBASE_API_KEY value>]
 *
 * The Firebase *web* API key (starts with "AIza") is public by design and is expected in the bundle; pass it with
 * --public-firebase-key so any OTHER Google-style key is reported. Findings never print the matched secret, only a short
 * fingerprint of it, the file and the rule.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RULES = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { id: "openai-style-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { id: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "service-account-json", re: /"private_key_id"\s*:|"client_email"\s*:\s*"[^"]+gserviceaccount\.com"/g },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: "provider-host", re: /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/g },
  { id: "provider-header", re: /anthropic-version|x-api-key|dangerously-allow-browser/gi },
  { id: "server-connection-string", re: /\b(?:postgres(?:ql)?|redis|rediss):\/\/[^\s"'`]+/g },
  { id: "server-only-variable", re: /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|LLM_API_KEY|DATABASE_URL|REDIS_URL|ADMIN_UIDS|REDIS_TLS_CA|FIREBASE_PRIVATE_KEY)\b/g },
  { id: "literal-bearer-token", re: /Bearer\s+eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "google-api-key", re: /AIza[0-9A-Za-z_-]{30,}/g }
];
const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt|svg)$/i;

const fp = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

function scan(dir, { publicFirebaseKey = null } = {}) {
  const findings = [];
  const files = walk(dir);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const rule of RULES) {
      for (const m of text.matchAll(rule.re)) {
        if (rule.id === "google-api-key" && publicFirebaseKey && m[0] === publicFirebaseKey) continue;
        findings.push({ rule: rule.id, file: path.relative(dir, f), fingerprint: fp(m[0]), length: m[0].length });
      }
    }
  }
  // collapse repeats of the same thing in the same file
  const seen = new Set();
  const unique = findings.filter((x) => { const k = `${x.rule}|${x.file}|${x.fingerprint}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { filesScanned: files.length, findings: unique };
}

module.exports = { scan, RULES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const ki = args.indexOf("--public-firebase-key");
  const publicFirebaseKey = ki >= 0 ? args[ki + 1] : process.env.EXPO_PUBLIC_FIREBASE_API_KEY || null;
  const dir = args.find((a, i) => !a.startsWith("--") && i !== ki + 1) || "dist";
  if (!fs.existsSync(dir)) { console.error(`directory not found: ${dir} (build first: npx expo export --platform web)`); process.exit(2); }
  const { filesScanned, findings } = scan(dir, { publicFirebaseKey });
  for (const f of findings) console.log(JSON.stringify(f));
  console.log(JSON.stringify({ summary: { dir, filesScanned, findings: findings.length, status: filesScanned === 0 ? "NOT_VERIFIED" : findings.length ? "FAIL" : "PASS" } }));
  process.exit(filesScanned === 0 ? 2 : findings.length ? 1 : 0);
}
