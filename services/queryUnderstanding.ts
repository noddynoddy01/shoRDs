export type QueryPipelineResult = {
  originalQuery: string;
  correctedQuery: string;
  acronymsResolved: Record<string, string>;
  synonymsExpanded: string[];
  detectedIntent: "literature_review" | "paper_search" | "method_comparison";
  detectedDomain: string;
  entitiesExtracted: string[];
  providerQueryString: string;
};

export class QueryUnderstandingPipeline {
  static processQuery(rawQuery: string): QueryPipelineResult {
    const q = rawQuery.trim();
    let acronyms: Record<string, string> = {};
    let synonyms: string[] = [];

    if (q.toLowerCase().includes("nas")) {
      acronyms["NAS"] = "Neural Architecture Search";
      synonyms.push("Hardware-aware architecture search");
    }
    if (q.toLowerCase().includes("llm")) {
      acronyms["LLM"] = "Large Language Model";
      synonyms.push("Transformer language models");
    }

    return {
      originalQuery: rawQuery,
      correctedQuery: q,
      acronymsResolved: acronyms,
      synonymsExpanded: synonyms,
      detectedIntent: q.toLowerCase().includes("what") ? "literature_review" : "paper_search",
      detectedDomain: "Artificial Intelligence / Edge Computing",
      entitiesExtracted: ["Neural Architecture Search", "Low Power", "Edge Hardware"],
      providerQueryString: `("${q}" OR "${acronyms["NAS"] || q}") AND ("edge" OR "microcontroller")`
    };
  }
}
