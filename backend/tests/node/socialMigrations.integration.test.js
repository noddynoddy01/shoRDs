"use strict";
/** Migrations 4-6 against a real (local *_test) PostgreSQL: up, constraints, the hand-run down script, and up again. Nothing here touches any other database. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { INFRA, infraSkip, resetInfra } = require("./helpers");

const skip = infraSkip();

test("social migrations: up, constraints, down, up again", { skip }, async (t) => {
  await resetInfra(); // base + social migrations applied
  const { PgPool } = require("../../data/pgClient");
  const { runMigrations } = require("../../data/migrations");
  const { SOCIAL_DOWN_SQL, V7_DOWN_SQL } = require("../../data/socialMigrations");
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 2 });
  t.after(() => pool.end());
  const tables = async () => (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")).rows.map((r) => r.table_name);
  const versions = async () => (await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => r.version);
  const SOCIAL = ["assistant_conversations", "assistant_messages", "conversation_participants", "conversations", "mentor_applications", "mentorship_relationships", "mentorship_requests", "message_reports", "messages", "notifications", "user_blocks", "user_profiles"];

  await t.test("up: versions 1-7 and the twelve community tables exist", async () => {
    assert.deepEqual(await versions(), [1, 2, 3, 4, 5, 6, 7]);
    const have = await tables();
    for (const n of SOCIAL) assert.ok(have.includes(n), n);
    assert.equal(have.length, 19);
  });

  await t.test("v7: mentor application detail columns exist, are constrained, and the v7-only down script removes just them", async () => {
    const cols = async () => (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='mentor_applications'")).rows.map((r) => r.column_name);
    for (const c of ["institution", "designation", "professional_bio", "orcid", "google_scholar_url", "verification_note"]) assert.ok((await cols()).includes(c), c);
    await pool.query("INSERT INTO user_profiles (uid, display_name, persona) VALUES ('v7u','N','MENTOR') ON CONFLICT DO NOTHING");
    let n = 0;
    const ins = (orcid, bio = "b".repeat(30)) => pool.query(
      "INSERT INTO mentor_applications (application_id, uid, status, background, experience, availability, capacity, institution, designation, professional_bio, orcid) VALUES ($4,'v7u','REJECTED',$1,$1,'AVAILABLE',2,'Uni','Dr',$2,$3)", ["x".repeat(30), bio, orcid, `v7app${++n}`]);
    await assert.rejects(() => ins("1234"), (e) => e.sqlState === "23514", "malformed ORCID refused by the database");
    await assert.rejects(() => ins(null, "short"), (e) => e.sqlState === "23514", "short biography refused by the database");
    await ins("0000-0002-1825-0097"); // a well-formed ORCID (checksum digit may be X) is accepted
    await pool.query("DELETE FROM mentor_applications WHERE uid='v7u'");
    await pool.query("DELETE FROM user_profiles WHERE uid='v7u'");
    await pool.withClient((c) => c.simple(`BEGIN; ${V7_DOWN_SQL} COMMIT;`));
    assert.deepEqual(await versions(), [1, 2, 3, 4, 5, 6]);
    for (const c of ["institution", "orcid", "verification_note"]) assert.ok(!(await cols()).includes(c), `${c} removed`);
    assert.ok((await tables()).includes("mentor_applications"), "the table itself stays");
    await runMigrations(pool);
    assert.deepEqual(await versions(), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok((await cols()).includes("institution"), "v7 re-applies");
  });

  await t.test("running the migrations again is a no-op", async () => {
    await runMigrations(pool);
    assert.deepEqual(await versions(), [1, 2, 3, 4, 5, 6, 7]);
  });

  await t.test("database constraints hold even if the application were bypassed", async () => {
    const bad = async (sql, params, code, why) => { await assert.rejects(() => pool.query(sql, params), (e) => e.sqlState === code, why); };
    const mkProfile = (uid, persona = "STUDENT") => pool.query("INSERT INTO user_profiles (uid, display_name, persona) VALUES ($1,'N',$2)", [uid, persona]);
    await bad("INSERT INTO user_profiles (uid, display_name, persona) VALUES ('u1','N','WIZARD')", [], "23514", "persona is constrained");
    await bad("INSERT INTO user_profiles (uid, display_name, persona) VALUES ('u1','','STUDENT')", [], "23514", "empty name refused");
    await bad("INSERT INTO user_profiles (uid, display_name, persona) VALUES ('u1', repeat('x',81), 'STUDENT')", [], "23514", "name length");
    await mkProfile("u1"); await mkProfile("u2"); await mkProfile("u3");
    await bad("INSERT INTO user_profiles (uid, display_name, persona) VALUES ('u1','Dup','STUDENT')", [], "23505", "uid is unique");
    assert.equal((await pool.query("SELECT verified_mentor FROM user_profiles WHERE uid='u1'")).rows[0].verified_mentor, false, "default is not verified");
    await bad("INSERT INTO mentorship_requests (request_id, mentee_uid, mentor_uid, domain, interests, guidance_needed) VALUES ('mreq_000000000000000001','u1','u1','d','long enough','long enough')", [], "23514", "no self-mentoring");
    await bad("INSERT INTO mentorship_requests (request_id, mentee_uid, mentor_uid, domain, interests, guidance_needed) VALUES ('mreq_000000000000000001','u1','ghost','d','long enough','long enough')", [], "23503", "foreign key to a real profile");
    const ins = "INSERT INTO mentorship_requests (request_id, mentee_uid, mentor_uid, domain, interests, guidance_needed) VALUES ($1,'u1','u2','d','long enough text','long enough text')";
    await pool.query(ins, ["mreq_000000000000000001"]);
    await bad(ins, ["mreq_000000000000000002"], "23505", "only one pending/accepted request per pair (partial unique index)");
    await pool.query("UPDATE mentorship_requests SET status='REJECTED' WHERE request_id='mreq_000000000000000001'");
    await pool.query(ins, ["mreq_000000000000000003"]); // allowed again once decided
    await bad("UPDATE mentorship_requests SET status='MAYBE' WHERE request_id='mreq_000000000000000003'", [], "23514", "status is constrained");
    await bad("INSERT INTO conversations (conversation_id, kind, created_by) VALUES ('conv_000000000000000001','GROUP','u1')", [], "23514", "conversation kind");
    await pool.query("INSERT INTO conversations (conversation_id, kind, direct_key, created_by) VALUES ('conv_000000000000000001','DIRECT','u1|u2','u1')");
    await bad("INSERT INTO conversations (conversation_id, kind, direct_key, created_by) VALUES ('conv_000000000000000002','DIRECT','u1|u2','u2')", [], "23505", "one direct conversation per pair");
    await pool.query("INSERT INTO conversation_participants (conversation_id, uid) VALUES ('conv_000000000000000001','u1'), ('conv_000000000000000001','u2')");
    await bad("INSERT INTO conversation_participants (conversation_id, uid) VALUES ('conv_000000000000000001','u1')", [], "23505", "membership is unique");
    await bad("INSERT INTO messages (conversation_id, sender_uid, body) VALUES ('conv_000000000000000001','u1','')", [], "23514", "empty message refused");
    await bad("INSERT INTO messages (conversation_id, sender_uid, body) VALUES ('conv_000000000000000001','u1', repeat('x',2001))", [], "23514", "message length bound in the database too");
    await pool.query("INSERT INTO messages (conversation_id, sender_uid, body, client_id) VALUES ('conv_000000000000000001','u1','hi','cid-0000001')");
    await bad("INSERT INTO messages (conversation_id, sender_uid, body, client_id) VALUES ('conv_000000000000000001','u1','hi again','cid-0000001')", [], "23505", "client id makes a retry idempotent");
    await bad("INSERT INTO messages (conversation_id, sender_uid, body) VALUES ('conv_missing','u1','x')", [], "23503", "a message needs a conversation");
    await bad("INSERT INTO user_blocks (blocker_uid, blocked_uid) VALUES ('u1','u1')", [], "23514", "no self-block");
    await bad("INSERT INTO assistant_messages (conversation_id, uid, role, content) VALUES ('nope','u1','user','x')", [], "23503", "assistant message needs its conversation");
    await pool.query("INSERT INTO assistant_conversations (conversation_id, uid, title) VALUES ('asst_000000000000000001','u1','t')");
    await bad("INSERT INTO assistant_messages (conversation_id, uid, role, content) VALUES ('asst_000000000000000001','u1','system','x')", [], "23514", "assistant roles are constrained");
    await pool.query("INSERT INTO assistant_messages (conversation_id, uid, role, content) VALUES ('asst_000000000000000001','u1','user','x')");
    await pool.query("DELETE FROM assistant_conversations WHERE conversation_id='asst_000000000000000001'");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM assistant_messages")).rows[0].n, 0, "deleting a conversation deletes its messages");
    await pool.query("DELETE FROM conversations WHERE conversation_id='conv_000000000000000001'");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages")).rows[0].n, 0, "a message never outlives its conversation");
    await pool.query("DELETE FROM user_profiles WHERE uid='u3'");
  });

  await t.test("list-style queries use an index (keyset/pagination friendly)", async () => {
    const idx = (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1")).rows.map((r) => r.indexname);
    for (const re of [/notifications/, /messages/, /assistant_conversations/, /mentorship_requests/, /user_profiles/]) assert.ok(idx.some((n) => re.test(n)), `an index on ${re}`);
  });

  await t.test("down: removes exactly the community tables and their schema_migrations rows; the base schema is untouched", async () => {
    await pool.withClient((c) => c.simple(`BEGIN; ${SOCIAL_DOWN_SQL} COMMIT;`)); // the same multi-statement path the migrator uses
    assert.deepEqual(await versions(), [1, 2, 3]);
    const have = await tables();
    for (const n of SOCIAL) assert.ok(!have.includes(n), `${n} dropped`);
    assert.equal(have.length, 7);
    for (const base of ["ai_usage", "schema_migrations"]) assert.ok(have.includes(base), `${base} survives`);
  });

  await t.test("up again after down works and recreates the same twelve tables", async () => {
    await runMigrations(pool);
    assert.deepEqual(await versions(), [1, 2, 3, 4, 5, 6, 7]);
    const have = await tables();
    for (const n of SOCIAL) assert.ok(have.includes(n), n);
    assert.equal(have.length, 19);
  });
});
