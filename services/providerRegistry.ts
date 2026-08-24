import { Paper } from "@/types/models";

export type SourceFormat = "JATS_XML" | "HTML" | "XML" | "PDF" | "METADATA_ONLY";

export type ResolvedDocument = {
  providerName: string;
  sourceFormat: SourceFormat;
  url: string;
  hasFullText: boolean;
  license: string;
};

export interface ResearchProvider {
  name: string;
  priority: number; // 1 (highest) to 10 (lowest)
  healthCheck(): Promise<boolean>;
  resolve(paper: Paper): Promise<ResolvedDocument | null>;
}

class UnpaywallProvider implements ResearchProvider {
  name = "Unpaywall";
  priority = 1;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    if (!paper.doi) return null;
    try {
      const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(paper.doi)}?email=support@shords.app`);
      if (res.ok) {
        const data = await res.json();
        const oaLoc = data.best_oa_location;
        if (oaLoc && oaLoc.url_for_pdf) {
          return {
            providerName: this.name,
            sourceFormat: oaLoc.url_for_landing ? "HTML" : "PDF",
            url: oaLoc.url_for_pdf || oaLoc.url_for_landing,
            hasFullText: true,
            license: oaLoc.license || "Open Access"
          };
        }
      }
    } catch {}
    return null;
  }
}

class OpenAIREProvider implements ResearchProvider {
  name = "OpenAIRE";
  priority = 2;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    if (!paper.title && !paper.doi) return null;
    try {
      const query = paper.doi ? `doi=${encodeURIComponent(paper.doi)}` : `title=${encodeURIComponent(paper.title)}`;
      const res = await fetch(`https://api.openaire.eu/search/publications?${query}&format=json&size=1`);
      if (res.ok) {
        const data = await res.json();
        const hit = data.response?.results?.result?.[0];
        if (hit) {
          return {
            providerName: this.name,
            sourceFormat: "HTML",
            url: paper.pdfUri || paper.originalLink,
            hasFullText: true,
            license: "Open Access"
          };
        }
      }
    } catch {}
    return null;
  }
}

class EuropePmcProvider implements ResearchProvider {
  name = "Europe PMC";
  priority = 3;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    const term = paper.doi || paper.title;
    if (!term) return null;
    try {
      const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(term)}&format=json&pageSize=1`);
      if (res.ok) {
        const data = await res.json();
        const item = data.resultList?.result?.[0];
        if (item) {
          const hasXml = item.hasFullTextXml === "Y";
          const pdfUrl = item.fullTextUrlList?.fullTextUrl?.find((u: any) => u.documentStyle === "pdf")?.url;
          if (hasXml || pdfUrl) {
            return {
              providerName: this.name,
              sourceFormat: hasXml ? "JATS_XML" : "PDF",
              url: pdfUrl || paper.originalLink,
              hasFullText: true,
              license: item.isOpenAccess === "Y" ? "Open Access" : "PMC License"
            };
          }
        }
      }
    } catch {}
    return null;
  }
}

class ArxivProvider implements ResearchProvider {
  name = "arXiv";
  priority = 4;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    const isArxiv = paper.id.includes("arxiv") || paper.originalLink?.includes("arxiv.org") || paper.pdfUri?.includes("arxiv.org");
    if (isArxiv) {
      const arxivId = paper.id.replace("arxiv-", "");
      return {
        providerName: this.name,
        sourceFormat: "HTML",
        url: `https://arxiv.org/pdf/${arxivId}.pdf`,
        hasFullText: true,
        license: "arXiv Open Access"
      };
    }
    return null;
  }
}

class CoreProvider implements ResearchProvider {
  name = "CORE";
  priority = 5;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    if (paper.pdfUri && paper.pdfUri.includes("core.ac.uk")) {
      return {
        providerName: this.name,
        sourceFormat: "PDF",
        url: paper.pdfUri,
        hasFullText: true,
        license: "CORE Open Access"
      };
    }
    return null;
  }
}

class ZenodoProvider implements ResearchProvider {
  name = "Zenodo";
  priority = 6;

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async resolve(paper: Paper): Promise<ResolvedDocument | null> {
    if (paper.originalLink?.includes("zenodo.org")) {
      return {
        providerName: this.name,
        sourceFormat: "HTML",
        url: paper.originalLink,
        hasFullText: true,
        license: "Creative Commons Attribution"
      };
    }
    return null;
  }
}

export class ProviderRegistryManager {
  private providers: ResearchProvider[] = [];

  constructor() {
    this.register(new UnpaywallProvider());
    this.register(new OpenAIREProvider());
    this.register(new EuropePmcProvider());
    this.register(new ArxivProvider());
    this.register(new CoreProvider());
    this.register(new ZenodoProvider());
  }

  register(provider: ResearchProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  getProviders(): ResearchProvider[] {
    return this.providers;
  }
}

export const providerRegistry = new ProviderRegistryManager();
