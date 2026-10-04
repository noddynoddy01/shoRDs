/**
 * Project / tenant selection.
 *
 * The backend is the only authority on which projects a user belongs to (GET /api/v1/projects, derived from the verified ID
 * token). The frontend never decides membership: it only remembers a *preference* (the last chosen project id), and that
 * preference is honoured only if the server's list still contains it.
 *
 *   0 projects  -> NONE     (onboarding / empty state: "create your first project")
 *   1 project   -> SELECTED (auto-selected)
 *   many        -> SELECTED if the remembered preference is in the server list, otherwise PICK (show the picker)
 */

export type ProjectRole = "VIEWER" | "COMMENTER" | "EDITOR" | "OWNER";
export type ProjectSummary = { projectId: string; name: string; role: ProjectRole };

export type ProjectState =
  | { kind: "NONE" }
  | { kind: "SELECTED"; project: ProjectSummary; auto: boolean }
  | { kind: "PICK"; projects: ProjectSummary[] };

export const PROJECT_ID_RE = /^prj_[0-9a-f]{18}$/;
const ROLES: readonly string[] = ["VIEWER", "COMMENTER", "EDITOR", "OWNER"];

/** Validate the server's project list. Malformed entries are dropped, never repaired. */
export function parseProjectList(json: unknown): ProjectSummary[] {
  const list = json && typeof json === "object" ? (json as { projects?: unknown }).projects : undefined;
  if (!Array.isArray(list)) return [];
  const out: ProjectSummary[] = [];
  const seen = new Set<string>();
  for (const p of list.slice(0, 100)) {
    if (!p || typeof p !== "object") continue;
    const { projectId, name, role } = p as { projectId?: unknown; name?: unknown; role?: unknown };
    if (typeof projectId !== "string" || !PROJECT_ID_RE.test(projectId) || seen.has(projectId)) continue;
    if (typeof name !== "string" || name.length === 0 || name.length > 120) continue;
    if (typeof role !== "string" || !ROLES.includes(role)) continue;
    seen.add(projectId);
    out.push({ projectId, name, role: role as ProjectRole });
  }
  return out;
}

export function decideProjectState(projects: readonly ProjectSummary[], preferredId: string | null | undefined): ProjectState {
  if (projects.length === 0) return { kind: "NONE" };
  if (projects.length === 1) return { kind: "SELECTED", project: projects[0], auto: true };
  const preferred = preferredId ? projects.find((p) => p.projectId === preferredId) : undefined;
  if (preferred) return { kind: "SELECTED", project: preferred, auto: false };
  return { kind: "PICK", projects: [...projects] };
}

/** Roles that may create analysis jobs (mirrors the server, for UI hints only; the server enforces it). */
export function canAnalyze(role: ProjectRole | undefined): boolean {
  return role === "EDITOR" || role === "OWNER";
}

export function validProjectName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 120;
}
