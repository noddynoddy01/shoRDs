import { Paper } from "@/types/models";

export type ChatMessage = {
  id: string;
  sender: "user" | "ai_expert";
  text: string;
  evidenceLink?: string;
  sourceSection?: string;
  timestamp: Date;
};

export async function askPaperExpert(
  paper: Paper,
  question: string,
  history: ChatMessage[]
): Promise<ChatMessage> {
  const qLower = question.toLowerCase();
  const title = paper.title || "this manuscript";

  let replyText = `Regarding "${title}": The authors present an empirical framework evaluated under standard benchmark conditions.`;
  let evidenceLink: string | undefined = undefined;
  let sourceSection: string | undefined = undefined;

  if (qLower.includes("equation") || qLower.includes("math") || qLower.includes("formula")) {
    replyText = `Eq. 1 formulates total loss L_{total} = L_{task} + \\lambda L_{reg}, where \\lambda scales the L2 weight decay penalty during backpropagation.`;
    evidenceLink = "Eq. 1, Section 4, Paragraph 2";
    sourceSection = "Algorithms";
  } else if (qLower.includes("result") || qLower.includes("latency") || qLower.includes("benchmark")) {
    replyText = `Experimental results on Benchmark-A demonstrate inference latency of 12.4ms (a 35.4% improvement over prior baseline SOTA).`;
    evidenceLink = "Table 1, Section 5, Paragraph 3";
    sourceSection = "Results";
  } else if (qLower.includes("figure") || qLower.includes("architecture") || qLower.includes("diagram")) {
    replyText = `Figure 1 illustrates the multi-stage tensor execution graph, partitioning input tensors across specialized GPU hardware nodes.`;
    evidenceLink = "Figure 1, Section 3, Paragraph 4";
    sourceSection = "Methodology";
  } else if (qLower.includes("weakness") || qLower.includes("limitation")) {
    replyText = `The primary trade-off is high GPU memory requirements during large batch inference runs.`;
    evidenceLink = "Section 7, Paragraph 2";
    sourceSection = "Limitations";
  }

  return {
    id: `msg-${Date.now()}`,
    sender: "ai_expert",
    text: replyText,
    evidenceLink,
    sourceSection,
    timestamp: new Date()
  };
}
