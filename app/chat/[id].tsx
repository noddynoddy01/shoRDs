import { FeatureUnavailable } from "@/components/FeatureUnavailable";

/**
 * Mentor / advisor chat is not built: there is no messaging backend and no mentor behind it, and this chat is not connected to an
 * AI model. An earlier version answered with fixed canned replies shown under a mentor's name; that was removed.
 * Paper-grounded AI answers come only from the authenticated backend (Research Copilot, POST /api/v1/copilot/query).
 */
export default function ChatScreen() {
  return (
    <FeatureUnavailable
      title="Mentor chat"
      description="Chat with mentors is planned. This chat is not connected to an AI model or to a messaging service, so no one can reply here. For answers about a paper, use the Research Copilot."
    />
  );
}
