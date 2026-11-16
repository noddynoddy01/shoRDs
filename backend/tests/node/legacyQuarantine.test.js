"use strict";
/**
 * The legacy Python engines that return invented output are quarantined (Phase 6). This test keeps three promises:
 *   1. the quarantined files are byte-identical to what was moved (sha256 in MANIFEST.json), and nothing was deleted;
 *   2. none of them is still at its old location;
 *   3. nothing in the production path, the deployment files or the evaluation/native code refers to them.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..", "..", "..");
const q = path.join(root, "backend", "legacy_quarantine");
const manifest = JSON.parse(fs.readFileSync(path.join(q, "MANIFEST.json"), "utf8"));
const names = manifest.files.map((f) => path.basename(f.file, ".py"));

test("quarantine: README states the rules, the manifest lists ten files and every file is byte-identical to what was moved", () => {
  const readme = fs.readFileSync(path.join(q, "README.md"), "utf8");
  for (const phrase of ["not functional", "must not be exposed through any production endpoint", "must not be used for training or evaluation"]) assert.ok(readme.includes(phrase), phrase);
  assert.equal(manifest.files.length, 10);
  for (const f of manifest.files) {
    const buf = fs.readFileSync(path.join(q, f.file));
    assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), f.sha256, f.file);
    assert.ok(f.why && f.why.length > 20, `${f.file} has a reason`);
  }
});

test("quarantine: none of the files is still at its original location", () => {
  for (const n of names) assert.equal(fs.existsSync(path.join(root, "backend", `${n}.py`)), false, n);
});

test("quarantine: no production, deployment, native-engine or evaluation file refers to a quarantined engine", () => {
  const scan = [
    "Dockerfile", "docker-compose.yml", "railway.json", "package.json", ".github/workflows/ci.yml",
    "backend/start_local_server.js", "backend/app.js", "backend/runtime.js"
  ].map((f) => path.join(root, f));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const d of ["backend/llm", "backend/native", "backend/eval", "backend/papers", "scripts"]) scan.push(...walk(path.join(root, d)).filter((f) => /\.(js|json|ya?ml)$/.test(f)));
  for (const f of scan.filter((p) => fs.existsSync(p))) {
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!text.includes("legacy_quarantine") || /legacyQuarantine|guard_before_after/.test(f), `${path.relative(root, f)} mentions legacy_quarantine`);
    for (const n of names) assert.ok(!new RegExp(`\\b${n}\\b`).test(text), `${path.relative(root, f)} mentions ${n}`);
  }
});

test("quarantine: the folder is excluded from the Docker image", () => {
  assert.match(fs.readFileSync(path.join(root, ".dockerignore"), "utf8"), /^backend\/legacy_quarantine$/m);
});
