import { Paper, CitationFormat } from "@/types/models";

export function generateBibTeX(paper: Paper): string {
  const citeKey = paper.authorName.split(" ").slice(-1)[0].toLowerCase() + (paper.pubYear || 2026) + paper.id.slice(0, 4);
  return `@article{${citeKey},
  title={${paper.title}},
  author={${paper.authorName}},
  journal={${paper.organization || "shoRDs Research OS Archives"}},
  year={${paper.pubYear || 2026}},
  doi={${paper.doi || "10.48550/arXiv." + paper.id}},
  url={${paper.originalLink}}
}`;
}

export function generateRIS(paper: Paper): string {
  return `TY  - JOUR
TI  - ${paper.title}
AU  - ${paper.authorName}
PY  - ${paper.pubYear || 2026}
JO  - ${paper.organization || "shoRDs Research OS Archives"}
DO  - ${paper.doi || "10.48550/arXiv." + paper.id}
UR  - ${paper.originalLink}
ER  -`;
}

export function generateAPA(paper: Paper): string {
  return `${paper.authorName} (${paper.pubYear || 2026}). ${paper.title}. ${paper.organization || "shoRDs Research OS Archives"}. https://doi.org/${paper.doi || "10.48550/arXiv." + paper.id}`;
}

export function generateIEEE(paper: Paper): string {
  return `${paper.authorName}, "${paper.title}," ${paper.organization || "shoRDs Research OS Archives"}, ${paper.pubYear || 2026}. doi: ${paper.doi || "10.48550/arXiv." + paper.id}.`;
}

export function generateMLA(paper: Paper): string {
  return `${paper.authorName}. "${paper.title}." ${paper.organization || "shoRDs Research OS Archives"}, ${paper.pubYear || 2026}, doi:${paper.doi || "10.48550/arXiv." + paper.id}.`;
}

export function formatCitation(paper: Paper, format: CitationFormat): string {
  switch (format) {
    case "bibtex":
      return generateBibTeX(paper);
    case "ris":
      return generateRIS(paper);
    case "apa":
      return generateAPA(paper);
    case "ieee":
      return generateIEEE(paper);
    case "mla":
      return generateMLA(paper);
    default:
      return generateBibTeX(paper);
  }
}
