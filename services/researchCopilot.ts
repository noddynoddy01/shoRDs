import { Paper } from "@/types/models";

export type CopilotMilestone = {
  domain: string;
  completedCount: number;
  skillLevel: "Beginner" | "Intermediate" | "Advanced Researcher";
  currentMilestone: string;
  nextRecommendedPaper: {
    title: string;
    doi?: string;
    reason: string;
  };
  comprehensionDelta: string;
};

export class PersonalizedResearchCopilot {
  static getCopilotMilestone(userHistory: Paper[]): CopilotMilestone {
    const count = userHistory.length;
    
    return {
      domain: "Artificial Intelligence & Hardware Acceleration",
      completedCount: Math.max(1, count),
      skillLevel: count > 10 ? "Advanced Researcher" : count > 3 ? "Intermediate" : "Beginner",
      currentMilestone: "Foundations of Hardware-Aware Deep Learning Completed",
      nextRecommendedPaper: {
        title: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
        doi: "10.48550/arXiv.2312.00752",
        reason: "Builds upon state space models to achieve linear-time sequence scaling beyond traditional attention mechanisms."
      },
      comprehensionDelta: "30% -> 85%"
    };
  }
}
