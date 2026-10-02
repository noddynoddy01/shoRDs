"use strict";
/**
 * Schema migrations for the production runtime. Forward-only, applied in order, each in one transaction, serialised across
 * replicas with a Postgres advisory lock so two replicas booting together cannot race.
 *
 * SQL here is static (no user data is ever interpolated).
 */

const ADVISORY_LOCK_KEY = 727274001; // arbitrary constant shared by all replicas

const MIGRATIONS = [
  {
    version: 1,
    name: "projects_members_analysis_jobs",
    sql: `
      CREATE TABLE projects (
        project_id  TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX projects_tenant_idx ON projects (tenant_id);

      CREATE TABLE project_members (
        project_id  TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('VIEWER','COMMENTER','EDITOR','OWNER')),
        added_by    TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX project_members_user_idx ON project_members (user_id);

      CREATE TABLE analysis_jobs (
        job_id              TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects (project_id),
        tenant_id           TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        paper_id            TEXT NOT NULL,
        idempotency_key     TEXT,
        request             JSONB NOT NULL,
        status              TEXT NOT NULL CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED','CANCELLED')),
        progress            INTEGER NOT NULL DEFAULT 0,
        attempts            INTEGER NOT NULL DEFAULT 0,
        max_attempts        INTEGER NOT NULL DEFAULT 3,
        result              JSONB,
        error_code          TEXT,
        error_message       TEXT,
        cancel_requested    BOOLEAN NOT NULL DEFAULT FALSE,
        worker_id           TEXT,
        lease_expires_at    TIMESTAMPTZ,
        created_by_replica  TEXT NOT NULL,
        processed_by_replica TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at          TIMESTAMPTZ,
        finished_at         TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX analysis_jobs_idempotency_idx ON analysis_jobs (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX analysis_jobs_status_idx ON analysis_jobs (status, updated_at);
      CREATE INDEX analysis_jobs_project_idx ON analysis_jobs (project_id, created_at DESC);
    `
  }
];

/**
 * @param {import('./pgClient').PgPool} pool
 * @returns {Promise<{applied: number[], alreadyApplied: number[], current: number}>}
 */
async function runMigrations(pool, migrations = MIGRATIONS) {
  return pool.withClient(async (c) => {
    await c.query("SELECT pg_advisory_lock($1::bigint)", [ADVISORY_LOCK_KEY]);
    try {
      await c.simple(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
      );
      const done = new Set((await c.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
      const applied = [];
      for (const m of migrations) {
        if (done.has(m.version)) continue;
        if (!Number.isInteger(m.version) || !/^[a-z0-9_]+$/.test(m.name)) throw new Error("invalid migration definition");
        await c.simple(`BEGIN; ${m.sql}; INSERT INTO schema_migrations (version, name) VALUES (${m.version}, '${m.name}'); COMMIT;`);
        applied.push(m.version);
      }
      const current = Math.max(0, ...migrations.map((m) => m.version));
      return { applied, alreadyApplied: [...done].sort((a, b) => a - b), current };
    } finally {
      try {
        await c.query("SELECT pg_advisory_unlock($1::bigint)", [ADVISORY_LOCK_KEY]);
      } catch (_) {
        /* the lock is released when the session ends anyway */
      }
    }
  });
}

/** Is the schema at the version this code expects? Used by /ready. Never throws. */
async function schemaStatus(pool, migrations = MIGRATIONS) {
  const expected = Math.max(0, ...migrations.map((m) => m.version));
  try {
    const r = await pool.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations");
    const current = r.rows[0].v;
    return { ok: current >= expected, current, expected };
  } catch (e) {
    return { ok: false, current: null, expected, error: e.code || "PG_ERROR" };
  }
}

module.exports = { MIGRATIONS, runMigrations, schemaStatus, ADVISORY_LOCK_KEY };
