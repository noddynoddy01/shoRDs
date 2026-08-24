/**
 * Provider-Neutral Prompt Engine for shoRDs AI Gateway
 * Versioned prompt management (PROMPT_VERSION = "2026.1") with injection guards and evidence formatting.
 */

import { LLMRequest } from "../../types/llmGateway";

export class PromptManager {
  static readonly PROMPT_VERSION = "2026.1";

  static buildSystemPrompt(operation: string): string {
    return [
      "You are the shoRDs Research Intelligence Copilot.",
      "CRITICAL INSTRUCTIONS:",
      "1. You must ONLY answer using the provided evidence chunks.",
      "2. Every claim must be grounded in and cited to a specific Chunk ID.",
      "3. If evidence is insufficient, explicitly declare INSUFFICIENT_EVIDENCE.",
      "4. Do NOT hallucinate, infer unfounded causal links, or alter numerical findings.",
      `5. Operation Mode: ${operation}`,
      `6. Engine Version: shoRDs-${PromptManager.PROMPT_VERSION}`
    ].join("\n");
  }

  static buildUserPrompt(request: LLMRequest): string {
    const sanitizedQuery = request.prompt.replace(/(\r\n|\n|\r)/gm, " ").trim();
    let prompt = `User Query: ${sanitizedQuery}\n\n`;

    if (request.evidenceChunks && request.evidenceChunks.length > 0) {
      prompt += "--- EVIDENCE CONTEXT CHUNKS ---\n";
      for (const chunk of request.evidenceChunks) {
        prompt += `[CHUNK ID: ${chunk.chunkId} | Paper: ${chunk.paperId} | Section: ${chunk.section} | Page: ${chunk.page}]\n`;
        prompt += `${chunk.text}\n\n`;
      }
      prompt += "--- END EVIDENCE ---\n";
    }

    prompt += "\nSynthesize a rigorous, evidence-grounded response adhering strictly to the above facts.";
    return prompt;
  }
}
