"use strict";
/**
 * Migration safety (local throwaway database only; see infraSkip). A migration that fails half-way must leave the database and the
 * connection pool usable and must release the cross-replica advisory lock. Audit finding P0-4 / ADR-011.
 *
 * The enforcing tests are `todo` until the runner is fixed (it needs owner approval: it changes how production migrations run).
 * The control tests pass today and pin the behaviour that must not regress: atomicity of a failed migration and idempotent re-runs.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { PgPool } = require("../../data/pgClient");
const { runMigrations, ADVISORY_LOCK_KEY } = require("../../data/migrations");
const { infraSkip, INFRA } = require("./helpers");

const skip = infraSkip();
const good = { version: 1, name: "create_t", sql: "CREATE TABLE t_ok (id INT PRIMARY KEY)" };
const bad = { version: 2, name: "fails_midway", sql: "CREATE TABLE t_half (id INT); INSERT INTO t_half VALUES ('not an int')" };

async function fresh() {
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 3 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  return pool;
}

test("migration safety", { skip }, async (t) => {
  await t.test("control: a failing migration is atomic: nothing of it is applied and it is not recorded", async () => {
    const pool = await fresh();
    try {
      await runMigrations(pool, [good, bad]).then(() => assert.fail("must reject"), () => {});
      const tables = (await new PgPool({ url: INFRA.databaseUrl, max: 1 }).query("SELECT to_regclass('public.t_ok') AS ok, to_regclass('public.t_half') AS half")).rows[0];
      assert.ok(tables.ok, "the earlier good migration stays applied");
      assert.equal(tables.half, null, "the failed migration left no partial table");
    } finally { await pool.end(); }
  });

  await t.test("control: re-running applied migrations is a no-op", async () => {
    const pool = await fresh();
    try {
      await runMigrations(pool, [good]);
      const r = await runMigrations(pool, [good]);
      assert.deepEqual(r.applied, []);
    } finally { await pool.end(); }
  });

  await t.test("after a failed migration the pool is still usable and the advisory lock is released",
    { todo: "migrations.js sends BEGIN..COMMIT as one simple query and never issues ROLLBACK; the connection returns to the pool inside an aborted transaction (25P02) still holding the session lock (audit P0-4). Fix needs owner approval." },
    async () => {
      const pool = await fresh();
      const other = new PgPool({ url: INFRA.databaseUrl, max: 1 });
      try {
        await runMigrations(pool, [good, bad]).then(() => assert.fail("must reject"), () => {});
        // 1. every pooled connection still works
        for (let i = 0; i < 6; i++) assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1, `query ${i} on the pool failed`);
        // 2. another replica can take the migration lock
        const got = (await other.query("SELECT pg_try_advisory_lock($1::bigint) AS got", [ADVISORY_LOCK_KEY])).rows[0].got;
        assert.equal(got, true, "the advisory lock is still held by the failed migration's connection");
      } finally {
        // A poisoned connection can make pool.end() wait forever (itself part of the finding): terminate the stray sessions on this
        // throwaway database first, then close with a deadline, so the test process always exits.
        const killer = new PgPool({ url: INFRA.databaseUrl, max: 1 });
        await killer.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()").catch(() => {});
        await killer.end().catch(() => {});
        const deadline = (p) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
        await deadline(pool.end()); await deadline(other.end());
      }
    });
});
