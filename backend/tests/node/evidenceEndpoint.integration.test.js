"use strict";
/**
 * GET /api/v1/papers/:id/evidence/:chunkId?start&end — sentence-level evidence text, served only where the recorded licence
 * allows redistribution. Real handler, real PostgreSQL + Redis; provider payloads are fictional fixtures.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra } = require("./helpers");
const fx = require("./paperFixtures");

const skip = infraSkip();
const keys = makeKeyPair();

test("evidence endpoint: text is served only under a licence that allows it", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys });
  t.after(() => R.close());
  const alice = uniq("alice-");
  const call = (method, path, token = tokenFor(keys, alice)) => R.call(method, path, { token, headers: ipHeader() });
  const paperId = `doi:${fx.FIXTURE_DOI}`;
  const enc = encodeURIComponent(paperId);

  const resolved = await R.call("POST", "/api/v1/papers/resolve", { token: tokenFor(keys, alice), body: { paperId }, headers: ipHeader() });
  assert.equal(resolved.status, 200, "setup: the fixture paper resolves");
  const { rows } = await R.runtime.pool.query("SELECT chunk_id, text FROM paper_chunks WHERE paper_id=$1 ORDER BY ordinal", [resolved.json.paper?.paperId || paperId]);
  assert.ok(rows.length >= 8, "setup: chunks were stored");
  const chunk = rows.find((r) => /87\.4 percent/.test(r.text));
  assert.ok(chunk, "setup: the RESULTS chunk with the headline number exists");
  const at = chunk.text.indexOf("87.4 percent");
  const url = (cid, s, e) => `/api/v1/papers/${enc}/evidence/${encodeURIComponent(cid)}?start=${s}&end=${e}`;

  await t.test("cc-by: the exact characters are returned with attribution and a hash", async () => {
    const r = await call("GET", url(chunk.chunk_id, at, at + 12));
    assert.equal(r.status, 200);
    assert.equal(r.json.available, true);
    assert.equal(r.json.text, "87.4 percent");
    assert.equal(r.json.text, chunk.text.slice(at, at + 12));
    assert.match(r.json.textHash, /^[0-9a-f]{16,}$/);
    assert.equal(r.json.source.attributionRequired, true);
    assert.equal(r.json.source.license, "cc-by");
  });

  await t.test("a licence that does not allow redistribution gets metadata and the reason, never text", async () => {
    for (const lic of ["cc-by-nc", "cc-by-nd", "publisher-specific-oa", null]) {
      await R.runtime.pool.query("UPDATE papers SET license=$1 WHERE paper_id=$2", [lic, resolved.json.paper?.paperId || paperId]);
      const r = await call("GET", url(chunk.chunk_id, at, at + 12));
      assert.equal(r.status, 200, String(lic));
      assert.equal(r.json.available, false, `licence ${lic} must not serve text`);
      assert.equal(r.json.reason, "LICENSE_DOES_NOT_ALLOW_SERVING_TEXT");
      assert.equal("text" in r.json, false);
      assert.equal(JSON.stringify(r.json).includes("87.4"), false, "no excerpt leaks through any field");
      assert.ok(r.json.source.title);
      // a span far past the end of the chunk must not reveal the chunk's length either: same answer as a span inside it
      const past = await call("GET", url(chunk.chunk_id, chunk.text.length, chunk.text.length + 5));
      assert.equal(past.status, 200, `licence ${lic}: out-of-range span`);
      assert.equal(past.json.available, false);
    }
    await R.runtime.pool.query("UPDATE papers SET license='cc-by' WHERE paper_id=$1", [resolved.json.paper?.paperId || paperId]);
  });

  await t.test("bad spans, ids and unknown chunks are refused with 4xx and no text", async () => {
    const len = chunk.text.length;
    const cases = [
      [url(chunk.chunk_id, 5, 5), 400], [url(chunk.chunk_id, 9, 3), 400], [url(chunk.chunk_id, 0, 1501), 400],
      [url(chunk.chunk_id, 0, len + 1), 400], [`/api/v1/papers/${enc}/evidence/${encodeURIComponent(chunk.chunk_id)}`, 400],
      [`/api/v1/papers/${enc}/evidence/${encodeURIComponent(chunk.chunk_id)}?start=-1&end=4`, 400],
      [`/api/v1/papers/${enc}/evidence/${encodeURIComponent(chunk.chunk_id)}?start=a&end=4`, 400],
      [url("../../etc/passwd", 0, 5), 400], [url("nope:chunk:0", 0, 5), 400], [url(`${paperId}_chunk_9999`, 0, 5), 404], [url("doi:10.9999/other.paper_chunk_1", 0, 5), 400],
      [`/api/v1/papers/${encodeURIComponent("doi:10.9999/never.stored")}/evidence/${encodeURIComponent("doi:10.9999/never.stored_chunk_1")}?start=0&end=5`, 404],
      [`/api/v1/papers/${encodeURIComponent("../x")}/evidence/x?start=0&end=5`, 400]
    ];
    for (const [path, status] of cases) {
      const r = await call("GET", path);
      assert.equal(r.status, status, path);
      assert.equal("text" in (r.json || {}), false, path);
    }
  });

  await t.test("a signed-in user is required", async () => {
    const r = await R.call("GET", url(chunk.chunk_id, at, at + 12), { headers: ipHeader() });
    assert.equal(r.status, 401);
    assert.equal(r.text.includes("87.4"), false);
  });
});
