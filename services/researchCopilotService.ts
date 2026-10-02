/**
 * Research Copilot Orchestration Service for shoRDs Research Intelligence OS (Phase 28)
 *
 * PHASE 6 HONESTY FIX: this service used to return a hardcoded, always-"VERIFIED" answer (fake claims, a fake
 * 0.924 AUROC, fake chunk ids, fake papers and a fake 0.96 confidence) for ANY query, entirely in the browser.
 * That is fabricated evidence on a production screen, so it was removed. Until the screen is connected to the
 * authenticated backend (POST /api/v1/copilot/query with a Firebase ID token) and to paper retrieval, the
 * service returns an explicit, truthful "nothing was analysed" response instead of invented findings.
 *
 * The claim-first pipeline (Question -> Retrieve -> Structure -> Candidate Claims -> Verify -> Prose) is
 * implemented server-side; see backend/llm/copilotService.js and docs/AI_RUNTIME_AUDIT.md.
 */

import { CopilotMode, ResearchCopilotRequest, ResearchCopilotResponse } from "../types/researchCopilot";

export class ResearchCopilotService {
  /**
   * Returns an honest INSUFFICIENT_EVIDENCE response: no claims, no sources, no evidence, no confidence.
   * `_serverContext` is accepted for call-site compatibility only; identity is established by the backend from the
   * caller's verified ID token, never from client-supplied fields.
   */
  static async processCopilotRequest(
    request: ResearchCopilotRequest,
    _serverContext?: unknown
  ): Promise<ResearchCopilotResponse> {
    const mode: CopilotMode = request.mode || "ASK";
    const now = Date.now();
    return {
      responseId: `copilot_resp_${now}`,
      queryId: `qry_${now}`,
      conversationId: request.conversationId || `conv_${now}`,
      status: "INSUFFICIENT_EVIDENCE",
      mode,
      answer:
        "No analysis was generated: this screen is not connected to paper retrieval and the authenticated research backend yet, " +
        "so there is no paper text to ground an answer in. Nothing shown here is a finding.",
      claims: [],
      sources: [],
      evidence: [],
      graphContext: [],
      suggestedActions: [],
      uncertainty: "NOT_CONNECTED",
      limitations: [
        "No paper content was retrieved for this query.",
        "No claim was generated, so no claim was verified."
      ],
      createdAt: new Date(now).toISOString()
    };
  }
}
