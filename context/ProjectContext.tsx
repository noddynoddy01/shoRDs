import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import { api } from "../services/auth/firebaseSession";
import { ApiError, describeApiError } from "../services/auth/apiClient";
import { decideProjectState, parseProjectList, validProjectName } from "../services/auth/projects";
import type { ProjectState, ProjectSummary } from "../services/auth/projects";

/**
 * Which project (tenant scope) the signed-in user is working in.
 * The backend's project list is authoritative; a remembered choice is only a preference and is used only if the server still lists it.
 */
type Phase = "IDLE" | "LOADING" | "READY" | "ERROR";

type ProjectValue = {
  phase: Phase;
  projects: ProjectSummary[];
  selection: ProjectState;
  active: ProjectSummary | null;
  error: string | null;
  refresh: () => Promise<void>;
  select: (projectId: string) => Promise<void>;
  create: (name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
};

const ProjectContext = createContext<ProjectValue | null>(null);
const prefKey = (uid: string) => `shords.activeProject.v1:${uid}`;

export function useProject(): ProjectValue {
  const v = useContext(ProjectContext);
  if (!v) throw new Error("useProject must be used inside <ProjectProvider>");
  return v;
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const uid = user ? user.uid : null;
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selection, setSelection] = useState<ProjectState>({ kind: "NONE" });
  const [error, setError] = useState<string | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async (forUid: string, prefer?: string) => {
    const mine = ++loadId.current;
    setPhase("LOADING");
    setError(null);
    try {
      const json = await api.get("/api/v1/projects");
      if (mine !== loadId.current) return; // a newer load (or a sign-out) superseded this one
      const list = parseProjectList(json);
      let preferred: string | null = prefer ?? null;
      if (!preferred) {
        try {
          preferred = await AsyncStorage.getItem(prefKey(forUid));
        } catch (_) {
          preferred = null;
        }
      }
      if (mine !== loadId.current) return;
      setProjects(list);
      setSelection(decideProjectState(list, preferred));
      setPhase("READY");
    } catch (e) {
      if (mine !== loadId.current) return;
      setError(describeApiError(e));
      setPhase("ERROR");
    }
  }, []);

  useEffect(() => {
    if (status === "SIGNED_IN" && uid) {
      void load(uid);
    } else {
      // signed out / loading: forget everything about the previous user's projects
      loadId.current++;
      setPhase("IDLE");
      setProjects([]);
      setSelection({ kind: "NONE" });
      setError(null);
    }
  }, [status, uid, load]);

  const select = useCallback(
    async (projectId: string) => {
      const chosen = projects.find((p) => p.projectId === projectId); // only a project the server listed can be chosen
      if (!chosen || !uid) return;
      setSelection({ kind: "SELECTED", project: chosen, auto: false });
      try {
        await AsyncStorage.setItem(prefKey(uid), projectId);
      } catch (_) {
        // preference only
      }
    },
    [projects, uid]
  );

  const create = useCallback<ProjectValue["create"]>(
    async (name) => {
      if (!uid) return { ok: false, message: "Sign in to create a project." };
      if (!validProjectName(name)) return { ok: false, message: "Give the project a name (up to 120 characters)." };
      try {
        const made = await api.post<{ projectId?: string }>("/api/v1/projects", { name: name.trim() });
        const id = typeof made.projectId === "string" ? made.projectId : undefined;
        if (id) {
          try {
            await AsyncStorage.setItem(prefKey(uid), id);
          } catch (_) {
            // preference only
          }
        }
        await load(uid, id);
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof ApiError ? describeApiError(e) : "Could not create the project." };
      }
    },
    [uid, load]
  );

  const value = useMemo<ProjectValue>(
    () => ({
      phase,
      projects,
      selection,
      active: selection.kind === "SELECTED" ? selection.project : null,
      error,
      refresh: async () => {
        if (uid) await load(uid);
      },
      select,
      create
    }),
    [phase, projects, selection, error, uid, load, select, create]
  );
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
