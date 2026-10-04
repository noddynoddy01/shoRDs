/**
 * Research Copilot client for shoRDs.
 *
 * Questions go to the authenticated backend (POST /api/v1/copilot/query) with the signed-in user's Firebase ID token.
 * The backend verifies the token, authorizes the project, retrieves the paper itself, selects the evidence, calls the model
 * and returns an answer with citations. This client sends only { projectId, paperId, query }; it never sends evidence text,
 * a user id, a tenant id or a role (the server rejects client-supplied evidence and decides identity from the token).
 *
 * History: this service once returned a hardcoded, always-"VERIFIED" answer in the browser; that was removed as fabricated
 * evidence. Now every answer is from the server and shows its real status (UNVERIFIED / FALLBACK / CONTENT_UNAVAILABLE ...).
 */

import { ResearchCopilotRequest, ResearchCopilotResponse } from "../types/researchCopilot";
import { api } from "./auth/firebaseSession";
import { ApiError, describeApiError } from "./auth/apiClient";
import { failed, mapCopilotResponse, needsPaper } from "./copilotMapping";

export class ResearchCopilotService {
  static async processCopilotRequest(request: ResearchCopilotRequest, _serverContext?: unknown): Promise<ResearchCopilotResponse> {
    const createdAt = new Date().toISOString();
    const paperId = request.selectedPaperIds && request.selectedPaperIds.length > 0 ? request.selectedPaperIds[0].trim() : "";
    if (!paperId) return needsPaper(createdAt);
    if (!request.query || !request.query.trim()) return { ...needsPaper(createdAt), answer: "Type a question about the paper." };

    const body: Record<string, unknown> = { query: request.query.trim(), paperId };
    if (request.projectId) body.projectId = request.projectId;
    if (request.selectedEvidenceIds && request.selectedEvidenceIds.length > 0) body.chunkIds = request.selectedEvidenceIds.slice(0, 40);

    try {
      const json = await api.post("/api/v1/copilot/query", body);
      return mapCopilotResponse(json);
    } catch (e) {
      const note = e instanceof ApiError && e.requestId ? `Reference: ${e.requestId}` : undefined;
      return failed(describeApiError(e), createdAt, note);
    }
  }
}
