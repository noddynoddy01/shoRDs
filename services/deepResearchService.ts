/**
 * Deep Research & Methodology Jargon Adaptation Engine for shoRDs Research Intelligence OS
 * Manages dual reading levels (RESEARCH BRIEF vs DEEP RESEARCH) and controlled explanation
 * layers for methodology jargon with evidence-grounded glossaries.
 */

export type ReadingLevel = "RESEARCH_BRIEF" | "DEEP_RESEARCH";

export interface JargonExplanation {
  term: string;
  scientificDefinition: string;
  readerExplanation: string;
  contextExample: string;
}

export interface DeepResearchSection {
  sectionTitle: string;
  level: "methodology" | "dataset" | "experiments" | "equations" | "limitations";
  content: string;
  evidenceChunkIds: string[];
  jargonTermsFound?: string[];
}

const SCHOLARLY_JARGON_DICTIONARY: Record<string, JargonExplanation> = {
  "adam optimizer": {
    term: "Adam Optimizer",
    scientificDefinition: "An adaptive learning rate optimization algorithm utilizing first and second moments of gradient vectors.",
    readerExplanation: "An efficient algorithm that tunes model parameters during training by adapting speed based on past gradients.",
    contextExample: "Optimization was performed using Adam with a learning rate of 0.0001."
  },
  "learning rate": {
    term: "Learning Rate",
    scientificDefinition: "A tuning hyperparameter that determines the step size at each iteration while moving toward a minimum of a loss function.",
    readerExplanation: "The speed at which the model updates its knowledge during training.",
    contextExample: "Trained with a learning rate of 1e-4 (0.0001)."
  },
  "cross-attention": {
    term: "Cross-Attention",
    scientificDefinition: "An attention mechanism in transformer architectures that mixes information from two different input sequences.",
    readerExplanation: "A mechanism that allows the model to connect related concepts between two different inputs (such as text and image).",
    contextExample: "Visual tokens attend to textual tokens via multi-head cross-attention."
  },
  "residual connection": {
    term: "Residual Connection",
    scientificDefinition: "A skip-connection that allows gradients to flow directly through network layers without attenuation.",
    readerExplanation: "A shortcut pathway that lets neural networks learn without signal decay across deep layers.",
    contextExample: "Each block includes identity skip connections."
  }
};

export class DeepResearchService {
  /**
   * Adapts technical methodology text with reader-friendly inline explanations without altering scientific meaning.
   */
  static adaptMethodologyText(text: string): { adaptedText: string; explanations: JargonExplanation[] } {
    let adapted = text;
    const detected: JargonExplanation[] = [];

    for (const [key, explanation] of Object.entries(SCHOLARLY_JARGON_DICTIONARY)) {
      const regex = new RegExp(`\\b${key}\\b`, "gi");
      if (regex.test(text)) {
        detected.push(explanation);
      }
    }

    // Replace specific notation with clear readable format
    adapted = adapted
      .replace(/1e-4/gi, "0.0001 (1e-4)")
      .replace(/1e-3/gi, "0.001 (1e-3)")
      .replace(/1e-5/gi, "0.00001 (1e-5)");

    return {
      adaptedText: adapted,
      explanations: detected
    };
  }

  /**
   * Formats Deep Research mode payload.
   */
  static getDeepResearchSections(paperId: string, briefSections: string[]): DeepResearchSection[] {
    return [
      {
        sectionTitle: "Formal Mathematical Methodology",
        level: "methodology",
        content: "Detailed algorithm specifications with objective loss functions and convergence proofs.",
        evidenceChunkIds: [`${paperId}-chunk-03`, `${paperId}-chunk-04`],
        jargonTermsFound: ["Adam Optimizer", "Learning Rate"]
      },
      {
        sectionTitle: "Dataset & Experimental Setup",
        level: "dataset",
        content: "Benchmark splits, preprocessing pipelines, and baseline comparative configurations.",
        evidenceChunkIds: [`${paperId}-chunk-05`],
        jargonTermsFound: ["Cross-Attention"]
      },
      {
        sectionTitle: "Ablation Studies & Limitations",
        level: "limitations",
        content: "Explicit error boundaries, computational complexity constraints, and negative results.",
        evidenceChunkIds: [`${paperId}-chunk-08`]
      }
    ];
  }
}
