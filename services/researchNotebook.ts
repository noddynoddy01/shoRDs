export type NotebookHighlightEntry = {
  id: string;
  paperTitle: string;
  highlightedText: string;
  aiExplanation: string;
  personalNote: string;
  citation: string;
  flashcard: {
    question: string;
    answer: string;
  };
  researchTask: string;
  createdAt: Date;
};

export class AIResearchNotebookEngine {
  static createEntryFromHighlight(
    paperTitle: string,
    highlightedText: string,
    personalNote: string = ""
  ): NotebookHighlightEntry {
    return {
      id: `note-${Date.now()}`,
      paperTitle,
      highlightedText,
      aiExplanation: `Explanation: "${highlightedText.slice(0, 100)}..." represents a core empirical finding evaluated under standard benchmark conditions.`,
      personalNote: personalNote || "Check applicability to low-power edge microcontroller architectures.",
      citation: `Extracted from "${paperTitle}".`,
      flashcard: {
        question: `What performance advantage does this claim state?`,
        answer: highlightedText
      },
      researchTask: `Implement benchmark verification for "${paperTitle}".`,
      createdAt: new Date()
    };
  }
}
