"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCacheKey, contentHash } = require("../../llm/resultCache");

const base = { tenantId: "tenant_a", projectId: "prj_1", paperId: "paper-1", contentHash: contentHash([{ chunkId: "c1", text: "alpha" }]), model: "claude-sonnet-5-5", mode: "STANDARD", promptVersion: "v1", query: "What was found?" };

test("identical inputs give identical keys", () => {
  assert.equal(buildCacheKey(base), buildCacheKey({ ...base }));
});

test("every identity field changes the key (no cross-tenant / cross-paper / cross-model contamination)", () => {
  const variants = {
    tenantId: "tenant_b",
    projectId: "prj_2",
    paperId: "paper-2",
    contentHash: contentHash([{ chunkId: "c1", text: "alpha CHANGED" }]),
    model: "claude-opus-5-5",
    mode: "DEEP",
    promptVersion: "v2",
    query: "What was found? (different question)"
  };
  const seen = new Set([buildCacheKey(base)]);
  for (const [field, value] of Object.entries(variants)) {
    const k = buildCacheKey({ ...base, [field]: value });
    assert.ok(!seen.has(k), `changing ${field} must change the key`);
    seen.add(k);
  }
  assert.equal(seen.size, 1 + Object.keys(variants).length);
});

test("field boundaries cannot be forged by moving characters between fields", () => {
  const a = buildCacheKey({ ...base, tenantId: "t", projectId: "1:prj" });
  const b = buildCacheKey({ ...base, tenantId: "t:1", projectId: "prj" });
  const c = buildCacheKey({ ...base, tenantId: "t1", projectId: ":prj" });
  assert.equal(new Set([a, b, c]).size, 3);
});

test("a missing identity field is an error, never a shared default key", () => {
  for (const f of Object.keys(base)) assert.throws(() => buildCacheKey({ ...base, [f]: "" }), new RegExp(f));
  assert.throws(() => buildCacheKey({ ...base, tenantId: undefined }));
});

test("content hash depends on text and chunk identity but not on chunk order", () => {
  const a = [{ chunkId: "c1", section: "s", page: 1, text: "one" }, { chunkId: "c2", section: "s", page: 2, text: "two" }];
  assert.equal(contentHash(a), contentHash([...a].reverse()));
  assert.notEqual(contentHash(a), contentHash([{ ...a[0], text: "ONE" }, a[1]]));
  assert.notEqual(contentHash(a), contentHash([{ ...a[0], chunkId: "c9" }, a[1]]));
  assert.notEqual(contentHash(a), contentHash([a[0]]));
});
