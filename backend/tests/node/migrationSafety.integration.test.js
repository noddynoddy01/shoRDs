"use strict";
/**
 * Migration safety (local throwaway database only; see infraSkip). A migration that fails half-way must leave the database and the
 * connection pool usable and must release the cross-replica advisory lock. Audit finding P0-4 / ADR-011.
 *
 * Fixed in P0.4. The tests that were `todo` while the runner was broken are now enforced, plus regression tests for: the next
 * migration run on the same pool after a failure, a connection killed mid-migration (transient), a connection left inside a
 * transaction never being reused, the runtime stopping on a permanent failure and retrying a transient one, and error messages
 * that never carry SQL text or data values.
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

  // Can another session take the migration lock right now? (It is released again so the check does not itself block later runs.)
  const lockFree = async (other) => {
    const got = (await other.query("SELECT pg_try_advisory_lock($1::bigint) AS got", [ADVISORY_LOCK_KEY])).rows[0].got;
    if (got) await other.query("SELECT pg_advisory_unlock($1::bigint)", [ADVISORY_LOCK_KEY]);
    return got;
  };
  const cleanup = async (...pools) => {
    // Bounded close so a regression (a poisoned connection) fails the assertions instead of hanging the test process.
    const killer = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    await killer.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()").catch(() => {});
    await killer.end().catch(() => {});
    for (const p of pools) await Promise.race([p.end().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
  };

  await t.test("after a failed migration the pool is still usable and the advisory lock is released", async () => {
    const pool = await fresh();
    const other = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    try {
      await runMigrations(pool, [good, bad]).then(() => assert.fail("must reject"), () => {});
      for (let i = 0; i < 6; i++) assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1, `query ${i} on the pool failed`);
      assert.equal(await lockFree(other), true, "the advisory lock is still held by the failed migration's connection");
    } finally { await cleanup(pool, other); }
  });

  await t.test("a failed migration can be followed by a corrected migration run on the same pool", async () => {
    const pool = await fresh();
    try {
      await runMigrations(pool, [good, bad]).then(() => assert.fail("must reject"), () => {});
      const fixed = { version: 2, name: "fails_midway", sql: "CREATE TABLE t_half (id INT); INSERT INTO t_half VALUES (1)" };
      const r = await runMigrations(pool, [good, fixed]);
      assert.deepEqual(r.applied, [2]);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM t_half")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT max(version) AS v FROM schema_migrations")).rows[0].v, 2);
    } finally { await cleanup(pool); }
  });

  await t.test("the error names the version and category only, never SQL text or data values, and marks it permanent", async () => {
    const pool = await fresh();
    try {
      const e = await runMigrations(pool, [good, bad]).then(() => null, (x) => x);
      assert.equal(e.code, "MIGRATION_FAILED");
      assert.equal(e.version, 2);
      assert.equal(e.migration, "fails_midway");
      assert.equal(e.sqlState, "22P02");
      assert.equal(e.permanent, true);
      assert.ok(!/not an int|INSERT|t_half/.test(e.message), e.message);
    } finally { await cleanup(pool); }
  });

  await t.test("a connection killed in the middle of a migration: transient error, nothing partial, pool and lock recover", async () => {
    const pool = await fresh();
    const other = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    const killer = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    try {
      const slow = { version: 2, name: "slow", sql: "CREATE TABLE t_slow (id INT); SELECT pg_sleep(5)" };
      const run = runMigrations(pool, [good, slow]).then(() => null, (x) => x);
      for (let i = 0; i < 50; i++) {
        const r = await killer.query("SELECT pg_terminate_backend(pid) AS k FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%pg_sleep(5)%' AND pid <> pg_backend_pid()");
        if (r.rows.some((x) => x.k)) break;
        await new Promise((r2) => setTimeout(r2, 100));
      }
      const e = await run;
      assert.ok(e, "the migration must fail");
      assert.equal(e.code, "MIGRATION_FAILED");
      assert.equal(e.permanent, false, "a killed connection is transient and may be retried: " + e.message);
      assert.equal((await pool.query("SELECT to_regclass('public.t_slow') AS t")).rows[0].t, null, "nothing of the killed migration remains");
      for (let i = 0; i < 4; i++) assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1);
      assert.equal(await lockFree(other), true);
      const r = await runMigrations(pool, [good, { ...slow, sql: "CREATE TABLE t_slow (id INT)" }]);
      assert.deepEqual(r.applied, [2], "the retry applies cleanly");
    } finally { await cleanup(pool, other, killer); }
  });

  await t.test("pool: a connection returned inside a transaction (open or aborted) is discarded, never reused", async () => {
    const pool = new PgPool({ url: INFRA.databaseUrl, max: 1 });
    try {
      await pool.withClient(async (c) => { await c.simple("BEGIN"); });                       // forgot to COMMIT
      assert.equal((await pool.query("SELECT pg_current_xact_id_if_assigned() IS NULL AS clean")).rows[0].clean, true);
      await pool.withClient(async (c) => { await c.simple("BEGIN"); await c.simple("SELECT 1/0").catch(() => {}); }); // aborted (25P02)
      assert.equal((await pool.query("SELECT 1 AS one")).rows[0].one, 1, "the next caller must not receive an aborted transaction");
      await pool.withClient(async (c) => { await c.query("SELECT pg_advisory_lock(424242::bigint)"); await c.simple("BEGIN"); }); // lock + open txn
      const probe = new PgPool({ url: INFRA.databaseUrl, max: 1 });
      try { assert.equal((await probe.query("SELECT pg_try_advisory_lock(424242::bigint) AS got")).rows[0].got, true, "discarding the connection released its session lock"); }
      finally { await cleanup(probe); }
    } finally { await cleanup(pool); }
  });

  await t.test("runtime: a permanent migration failure stops retrying, is logged without SQL/data, and calls onFatal once", async () => {
    const { createRuntime } = require("../../runtime");
    const lines = [];
    const logger = { log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m), info() {}, debug() {} };
    await (await fresh()).end(); // empty schema
    const rt = createRuntime({ DATABASE_URL: INFRA.databaseUrl, REDIS_URL: INFRA.redisUrl, WORKER_ENABLED: "false", MIGRATION_RETRY_MS: "30" }, { migrations: [good, bad], logger, logRequests: false });
    let fatal = 0;
    try {
      await rt.startBackground({ onFatal: () => { fatal++; } });
      await new Promise((r) => setTimeout(r, 300)); // several retry periods: a retry loop would attempt again and log again
      assert.equal(fatal, 1);
      const fatals = lines.filter((l) => /FATAL/.test(l));
      assert.equal(fatals.length, 1, lines.join("\n"));
      assert.match(fatals[0], /migration 2 \(fails_midway\) failed/);
      assert.ok(!lines.some((l) => /not an int/.test(l)), "no data value in the log");
      assert.equal((await rt.readiness()).ready, false);
    } finally { await rt.shutdown(500); }
  });

  await t.test("runtime: a transient failure (database not reachable yet) is retried until the migrations apply", async () => {
    const { createRuntime } = require("../../runtime");
    const lines = [];
    const logger = { log: (m) => lines.push(m), warn() {}, error: (m) => lines.push(m), info() {}, debug() {} };
    const real = await fresh();
    let failures = 2;
    const flaky = new Proxy(real, { get(t, k) { if (k === "withClient") return (fn) => (failures-- > 0 ? Promise.reject(Object.assign(new Error("[PG_CONNECT_FAILED] down"), { code: "PG_CONNECT_FAILED" })) : t.withClient(fn)); const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
    const rt = createRuntime({ WORKER_ENABLED: "false", MIGRATION_RETRY_MS: "30" }, { pool: flaky, migrations: [good], logger, logRequests: false });
    try {
      await rt.startBackground({ onFatal: () => assert.fail("a transient failure is not fatal") });
      await new Promise((r) => setTimeout(r, 400));
      assert.ok(lines.some((l) => /database schema at version 1/.test(l)), lines.join("\n"));
      assert.equal(lines.filter((l) => /retrying/.test(l)).length, 2);
    } finally { await rt.shutdown(500); await real.end().catch(() => {}); }
  });
});
