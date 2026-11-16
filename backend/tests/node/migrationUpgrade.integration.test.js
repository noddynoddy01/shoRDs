"use strict";
/**
 * Migrations on a fresh database AND on a representative EXISTING database (the schema as deployed before the latest migration,
 * holding data). Forward-only: the older rows must survive unchanged and the new indexes must appear exactly once, also when two
 * replicas start at the same moment.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { PgPool } = require("../../data/pgClient");
const { MIGRATIONS, runMigrations } = require("../../data/migrations");
const { infraSkip, INFRA } = require("./helpers");

const skip = infraSkip();
// These upgrade tests describe the aggregate-usage indexes added by migration 3. Migrations 4-6 (community tables) are exercised against a v3 database
// in the last subtest here and in socialMigrations.integration.test.js, so this set is deliberately "everything up to 3".
const THROUGH_3 = MIGRATIONS.filter((m) => m.version <= 3);
const reset = async (pool) => {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
};
const indexNames = async (pool) => (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows.map((r) => r.indexname);

test("migrations: fresh database and upgrade of an existing one", { skip }, async (t) => {
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 6 });
  t.after(() => pool.end());

  await t.test("fresh database: every migration applies, in order, once", async () => {
    await reset(pool);
    const r = await runMigrations(pool);
    assert.deepEqual(r.applied, MIGRATIONS.map((m) => m.version));
    assert.deepEqual((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((x) => x.version), MIGRATIONS.map((m) => m.version));
    const idx = await indexNames(pool);
    for (const n of ["ai_usage_project_idx", "ai_usage_user_idx", "ai_usage_tenant_idx", "analysis_jobs_idempotency_idx"]) assert.ok(idx.includes(n), n);
    const again = await runMigrations(pool);
    assert.deepEqual(again.applied, [], "a second run changes nothing");
  });

  await t.test("existing database at version 2 with data: the upgrade keeps every row and adds only the new indexes", async () => {
    await reset(pool);
    const old = await runMigrations(pool, MIGRATIONS.filter((m) => m.version <= 2));
    assert.deepEqual(old.applied, [1, 2]);
    const before = await indexNames(pool);
    assert.ok(!before.includes("ai_usage_project_idx"), "setup: the schema really is the older one");

    await pool.query("INSERT INTO projects (project_id,tenant_id,name,created_by) VALUES ('prj_a','t1','Alpha','u1'),('prj_b','t2','Beta','u2')");
    await pool.query("INSERT INTO project_members (project_id,user_id,role,added_by) VALUES ('prj_a','u1','OWNER','u1'),('prj_a','u3','VIEWER','u1')");
    await pool.query("INSERT INTO analysis_jobs (job_id,project_id,tenant_id,user_id,paper_id,idempotency_key,request,status,created_by_replica) VALUES ('job_1','prj_a','t1','u1','doi:10.1/x','k1','{\"depth\":\"standard\"}','COMPLETED','r1'),('job_2','prj_a','t1','u1','doi:10.1/x',NULL,'{}','QUEUED','r1')");
    await pool.query("INSERT INTO papers (paper_id,title,coverage,coverage_reason,content_hash,extractor_version,license) VALUES ('doi:10.1/x','A paper','FULL_TEXT','OA_FULL_TEXT','h',1,'cc-by')");
    await pool.query("INSERT INTO paper_chunks (paper_id,ordinal,chunk_id,section,source_type,text,text_hash) VALUES ('doi:10.1/x',1,'doi:10.1/x_chunk_1','RESULTS','JATS','Accuracy was 87.4 percent.','th')");
    for (let i = 0; i < 500; i++) {
      await pool.query("INSERT INTO ai_usage (request_id,project_id,user_hash,tenant_id,mode,provider,ai_called,cache_hit,fallback,cost_status,outcome) VALUES ($1,$2,$3,'t1','INTELLIGENCE','anthropic',true,false,false,'NOT_MEASURED','OK')", [`req_${i}`, i % 2 ? "prj_a" : "prj_b", `u${i % 5}`]);
    }
    const counts = async () => Object.fromEntries(await Promise.all(["projects", "project_members", "analysis_jobs", "papers", "paper_chunks", "ai_usage"].map(async (tb) => [tb, (await pool.query(`SELECT count(*)::int AS n FROM ${tb}`)).rows[0].n])));
    const beforeCounts = await counts();
    const beforeUsage = (await pool.query("SELECT md5(string_agg(request_id||coalesce(project_id,'')||coalesce(user_hash,''), ',' ORDER BY id)) AS h FROM ai_usage")).rows[0].h;

    const up = await runMigrations(pool, THROUGH_3);
    assert.deepEqual(up.applied, [3]);
    assert.deepEqual(up.alreadyApplied, [1, 2]);
    assert.deepEqual(await counts(), beforeCounts, "no row was added or lost");
    assert.equal((await pool.query("SELECT md5(string_agg(request_id||coalesce(project_id,'')||coalesce(user_hash,''), ',' ORDER BY id)) AS h FROM ai_usage")).rows[0].h, beforeUsage, "usage rows are byte-for-byte unchanged");
    assert.equal((await pool.query("SELECT text FROM paper_chunks")).rows[0].text, "Accuracy was 87.4 percent.");
    const after = await indexNames(pool);
    assert.deepEqual(after.filter((n) => !before.includes(n)), ["ai_usage_project_idx", "ai_usage_user_idx"], "only the two new indexes were added");
    assert.deepEqual(before.filter((n) => !after.includes(n)), [], "no index was removed");
    // The new indexes are really usable by the spend gate's seed query.
    await pool.query("ANALYZE ai_usage");
    // On a table this small the planner may pick a sequential scan whatever indexes exist, so forbid it for this one connection: the plan
    // can then only use the new index, and the assertion fails if the index does not serve the query (project/user + created_at).
    const planFor = (where) => pool.transaction(async (c) => {
      await c.query("SET LOCAL enable_seqscan = off");
      return (await c.query(`EXPLAIN SELECT count(*) FROM ai_usage WHERE ${where} AND created_at >= now() - interval '1 day'`)).rows.map((r) => Object.values(r)[0]).join("\n");
    });
    assert.match(await planFor("project_id = 'prj_a'"), /ai_usage_project_idx/, "the project seed query uses the new project index");
    assert.match(await planFor("user_hash = 'u_a'"), /ai_usage_user_idx/, "the user seed query uses the new user index");
  });

  await t.test("two replicas starting together on the old schema: exactly one applies the migration", async () => {
    await reset(pool);
    await runMigrations(pool, MIGRATIONS.filter((m) => m.version <= 2));
    const pools = [new PgPool({ url: INFRA.databaseUrl, max: 2 }), new PgPool({ url: INFRA.databaseUrl, max: 2 })];
    try {
      const results = await Promise.all(pools.map((p) => runMigrations(p, THROUGH_3)));
      const appliedAll = results.flatMap((r) => r.applied);
      assert.deepEqual(appliedAll, [3], "migration 3 applied once across both replicas");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 3);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  await t.test("a deployed v3 database upgrades to the community schema: migrations 4-6 apply once, also when two replicas start together, and old data is untouched", async () => {
    await reset(pool);
    await runMigrations(pool, THROUGH_3);
    await pool.query("INSERT INTO projects (project_id,tenant_id,name,created_by) VALUES ('prj_keep','t1','Keep','u1')");
    const tablesBefore = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")).rows.map((r) => r.table_name);
    const pools = [new PgPool({ url: INFRA.databaseUrl, max: 2 }), new PgPool({ url: INFRA.databaseUrl, max: 2 })];
    try {
      const results = await Promise.all(pools.map((p) => runMigrations(p)));
      assert.deepEqual(results.flatMap((r) => r.applied).sort((a, b) => a - b), [4, 5, 6, 7], "each community migration applied exactly once across both replicas");
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
    const tablesAfter = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")).rows.map((r) => r.table_name);
    assert.deepEqual(tablesBefore.filter((n) => !tablesAfter.includes(n)), [], "no existing table was dropped");
    for (const n of ["user_profiles", "mentor_applications", "mentorship_requests", "conversations", "messages", "notifications", "assistant_conversations", "assistant_messages"]) assert.ok(tablesAfter.includes(n), n);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, MIGRATIONS.length);
    assert.deepEqual((await pool.query("SELECT project_id, name FROM projects")).rows, [{ project_id: "prj_keep", name: "Keep" }], "existing data is untouched");
  });
});
