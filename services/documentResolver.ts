import { Paper } from "@/types/models";
import { providerRegistry, ResolvedDocument, SourceFormat } from "./providerRegistry";

export type SummaryLevel = "level1_full" | "level2_abstract" | "level3_metadata";

export type ProvenanceMetadata = {
  suppliedProvider: string;
  sourceFormat: SourceFormat;
  summaryLevel: SummaryLevel;
  badgeLabel: string;
  badgeColor: string;
  badgeIcon: string;
  description: string;
  fullTextUrl?: string;
  qualityScore: number;
};

export async function resolveDocumentProvenanceAsync(paper: Paper): Promise<ProvenanceMetadata> {
  if (!paper) {
    return createDefaultProvenance("Repository Index", "METADATA_ONLY", "level3_metadata", 50);
  }

  // Iterate across Provider Registry in priority order
  const providers = providerRegistry.getProviders();
  for (const provider of providers) {
    try {
      const resolved: ResolvedDocument | null = await provider.resolve(paper);
      if (resolved && resolved.hasFullText) {
        return {
          suppliedProvider: resolved.providerName,
          sourceFormat: resolved.sourceFormat,
          summaryLevel: "level1_full",
          badgeLabel: "Full Text Available",
          badgeColor: "#10B981",
          badgeIcon: "checkmark-circle-outline",
          description: `Full manuscript retrieved via ${resolved.providerName} (${resolved.sourceFormat}). Complete shoRDs Stack available.`,
          fullTextUrl: resolved.url,
          qualityScore: 98
        };
      }
    } catch {}
  }

  // Fallback 1: Check if Paper has a valid abstract (Level 2: Abstract Summary)
  const abstract = paper.summary || paper.fullExplanation || "";
  const hasAbstract = abstract.length > 30 && !abstract.startsWith("Indexed by OpenAlex") && !abstract.startsWith("Extraction Failed");

  if (hasAbstract) {
    return {
      suppliedProvider: paper.organization || "OpenAlex Metadata",
      sourceFormat: "METADATA_ONLY",
      summaryLevel: "level2_abstract",
      badgeLabel: "Abstract Only",
      badgeColor: "#F59E0B",
      badgeIcon: "alert-circle-outline",
      description: "Summary generated strictly from abstract. No methodology, experiments, or conclusions inferred.",
      fullTextUrl: paper.pdfUri || paper.originalLink,
      qualityScore: 85
    };
  }

  // Fallback 2: Metadata Only (Level 3)
  return createDefaultProvenance(paper.organization || "Repository Index", "METADATA_ONLY", "level3_metadata", 70);
}

function createDefaultProvenance(
  provider: string,
  format: SourceFormat,
  level: SummaryLevel,
  score: number
): ProvenanceMetadata {
  return {
    suppliedProvider: provider,
    sourceFormat: format,
    summaryLevel: level,
    badgeLabel: "Metadata Only",
    badgeColor: "#EF4444",
    badgeIcon: "lock-closed-outline",
    description: "Full text unavailable due to publisher paywall. Abstract & DOI metadata displayed below.",
    qualityScore: score
  };
}
