"use strict";
/**
 * Project resources and authorization (PostgreSQL). Authentication says WHO the caller is (security/auth.js);
 * this module decides WHAT that caller may touch.
 *
 * Model: a project belongs to a tenant (tenant_id; today the creating user's personal tenant) and has members with a
 * role. Role hierarchy matches types/researchWorkspace.ts / researchWorkspaceEngineService.ts: VIEWER < COMMENTER < EDITOR < OWNER.
 * A caller who is not a member and a caller whose role is too low both get the same 403, so project ids cannot be probed.
 */

const crypto = require("crypto");

const ROLE_RANK = { VIEWER: 1, COMMENTER: 2, EDITOR: 3, OWNER: 4 };
const ROLES = Object.keys(ROLE_RANK);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

class AuthzError extends Error {
  constructor(message = "not authorized for this project") {
    super(message);
    this.name = "AuthzError";
    this.code = "FORBIDDEN";
    this.httpStatus = 403;
  }
}

function newProjectId() {
  return `prj_${crypto.randomBytes(9).toString("hex")}`;
}

function personalTenant(uid) {
  return `tenant_${crypto.createHash("sha256").update(uid).digest("hex").slice(0, 16)}`;
}

async function createProject(pool, { name, userId }) {
  const projectId = newProjectId();
  const tenantId = personalTenant(userId);
  await pool.transaction(async (c) => {
    await c.query("INSERT INTO projects (project_id, tenant_id, name, created_by) VALUES ($1,$2,$3,$4)", [projectId, tenantId, name, userId]);
    await c.query("INSERT INTO project_members (project_id, user_id, role, added_by) VALUES ($1,$2,'OWNER',$2)", [projectId, userId]);
  });
  return { projectId, tenantId, name, role: "OWNER" };
}

async function getMembership(pool, projectId, userId) {
  if (!ID_RE.test(projectId)) return null;
  const r = await pool.query(
    "SELECT p.project_id, p.tenant_id, p.name, m.role FROM projects p JOIN project_members m ON m.project_id = p.project_id WHERE p.project_id = $1 AND m.user_id = $2",
    [projectId, userId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return { projectId: row.project_id, tenantId: row.tenant_id, name: row.name, role: row.role };
}

/** Throws AuthzError unless the principal is a member with at least `minRole`. */
async function authorizeProject(pool, principal, projectId, minRole) {
  if (!ROLE_RANK[minRole]) throw new Error(`unknown role ${minRole}`);
  const m = await getMembership(pool, projectId, principal.uid);
  if (!m || ROLE_RANK[m.role] < ROLE_RANK[minRole]) throw new AuthzError();
  return m;
}

async function listProjects(pool, userId) {
  const r = await pool.query(
    "SELECT p.project_id, p.tenant_id, p.name, m.role, p.created_at FROM projects p JOIN project_members m ON m.project_id = p.project_id WHERE m.user_id = $1 ORDER BY p.created_at DESC LIMIT 100",
    [userId]
  );
  return r.rows.map((x) => ({ projectId: x.project_id, tenantId: x.tenant_id, name: x.name, role: x.role, createdAt: x.created_at }));
}

class LastOwnerError extends Error {
  constructor() {
    super("a project must keep at least one OWNER");
    this.name = "LastOwnerError";
    this.code = "LAST_OWNER";
  }
}

async function setMember(pool, { projectId, targetUserId, role, actingUserId }) {
  if (!ROLE_RANK[role]) throw new Error("invalid role");
  await pool.transaction(async (c) => {
    // lock the project's owner rows so two concurrent demotions cannot both succeed
    const owners = await c.query("SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'OWNER' FOR UPDATE", [projectId]);
    const demotingOwner = role !== "OWNER" && owners.rows.some((o) => o.user_id === targetUserId);
    if (demotingOwner && owners.rowCount <= 1) throw new LastOwnerError();
    await c.query(
      "INSERT INTO project_members (project_id, user_id, role, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role",
      [projectId, targetUserId, role, actingUserId]
    );
  });
}

module.exports = { ROLE_RANK, ROLES, ID_RE, AuthzError, LastOwnerError, createProject, getMembership, authorizeProject, listProjects, setMember, personalTenant };
