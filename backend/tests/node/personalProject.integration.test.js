"use strict";
/** POST /api/v1/projects/personal: one auto-created project per user, race-safe, idempotent, isolated between users. Real PostgreSQL + Redis. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("personal-key");
const tok = (uid) => tokenFor(keys, uid);
const PAPER = `doi:${fx.FIXTURE_DOI}`;

test("personal project (real PostgreSQL)", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, AI_CACHE_ENABLED: "false" }, overrides: { client: modelStub({ costUsd: 0.001, costStatus: "ESTIMATED" }) } });
  t.after(() => R.close());
  const mk = (uid, extra = {}) => R.call("POST", "/api/v1/projects/personal", { token: tok(uid), body: {}, headers: ipHeader(), ...extra });

  await t.test("created on first use (201), the same project afterwards (200), listed exactly once", async () => {
    const uid = uniq("p1-");
    const a = await mk(uid);
    assert.equal(a.status, 201);
    assert.match(a.json.projectId, /^prj_[0-9a-f]{18}$/);
    assert.equal(a.json.role, "OWNER");
    assert.equal(a.json.personal, true);
    const b = await mk(uid);
    assert.equal(b.status, 200);
    assert.equal(b.json.projectId, a.json.projectId);
    const list = await R.call("GET", "/api/v1/projects", { token: tok(uid), headers: ipHeader() });
    assert.equal(list.json.projects.filter((p) => p.projectId === a.json.projectId).length, 1);
  });

  await t.test("eight simultaneous first requests create exactly one project", async () => {
    const uid = uniq("p2-");
    const rs = await Promise.all(Array.from({ length: 8 }, () => mk(uid)));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status)));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(new Set(rs.map((r) => r.json.projectId)).size, 1);
    const n = await R.runtime.pool.query("SELECT count(*)::int AS n FROM projects WHERE created_by=$1", [uid]);
    assert.equal(n.rows[0].n, 1);
    const m = await R.runtime.pool.query("SELECT count(*)::int AS n FROM project_members WHERE project_id=$1", [rs[0].json.projectId]);
    assert.equal(m.rows[0].n, 1);
  });

  await t.test("users are isolated: different ids, and nobody can use someone else's personal project", async () => {
    const [u1, u2] = [uniq("p3-"), uniq("p3-")];
    const a = (await mk(u1)).json;
    const b = (await mk(u2)).json;
    assert.notEqual(a.projectId, b.projectId);
    assert.notEqual(a.tenantId, b.tenantId);
    const get = await R.call("GET", `/api/v1/projects/${a.projectId}`, { token: tok(u2), headers: ipHeader() });
    assert.equal(get.status, 403);
    const analysis = await R.call("POST", "/api/v1/analysis", { token: tok(u2), body: { projectId: a.projectId, paperId: PAPER }, headers: { ...ipHeader(), "idempotency-key": uniq("k-") } });
    assert.equal(analysis.status, 403);
  });

  await t.test("the personal project is accepted by the analysis endpoint", async () => {
    const uid = uniq("p4-");
    const p = (await mk(uid)).json;
    const r = await R.call("POST", "/api/v1/analysis", { token: tok(uid), body: { projectId: p.projectId, paperId: PAPER }, headers: { ...ipHeader(), "idempotency-key": uniq("k-") } });
    assert.equal(r.status, 202);
  });

  await t.test("a user who was removed from their personal project is told, not silently re-added", async () => {
    const uid = uniq("p5-");
    const p = (await mk(uid)).json;
    await R.runtime.pool.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [p.projectId, uid]);
    const r = await mk(uid);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "PERSONAL_PROJECT_UNAVAILABLE");
    const n = await R.runtime.pool.query("SELECT count(*)::int AS n FROM project_members WHERE project_id=$1", [p.projectId]);
    assert.equal(n.rows[0].n, 0);
  });

  await t.test("a signed-in user is required; a body that is not JSON is refused", async () => {
    const anon = await R.call("POST", "/api/v1/projects/personal", { body: {}, headers: ipHeader() });
    assert.equal(anon.status, 401);
    const bad = await R.call("POST", "/api/v1/projects/personal", { token: tok(uniq("p6-")), body: "{not json", headers: ipHeader() });
    assert.ok([400, 415].includes(bad.status), String(bad.status));
  });
});
