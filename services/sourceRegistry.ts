import { ResearchSource } from "@/types/federated";

export const researchSourceRegistry: ResearchSource[] = [
  {
    id: "openalex",
    name: "OpenAlex Metadata API",
    apiEndpoint: "https://api.openalex.org/works",
    authRequired: false,
    rateLimit: "100 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "publication", "publisher", "pdf_url", "html_url", "license", "citation_count", "research_field", "institution"],
    fullTextAvailable: true,
    licenseInfo: "CC0 Open Data",
    healthStatus: "operational",
    updateSchedule: "Daily Ingestion"
  },
  {
    id: "arxiv",
    name: "arXiv Open Repository API",
    apiEndpoint: "https://export.arxiv.org/api/query",
    authRequired: false,
    rateLimit: "3 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "publication", "pdf_url", "html_url", "license", "research_field"],
    fullTextAvailable: true,
    licenseInfo: "arXiv License / Open Access",
    healthStatus: "operational",
    updateSchedule: "Realtime Stream"
  },
  {
    id: "crossref",
    name: "Crossref REST API",
    apiEndpoint: "https://api.crossref.org/works",
    authRequired: false,
    rateLimit: "50 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "publication", "publisher", "html_url", "license", "citation_count"],
    fullTextAvailable: false,
    licenseInfo: "Crossref Open Metadata",
    healthStatus: "operational",
    updateSchedule: "Daily Stream"
  },
  {
    id: "europepmc",
    name: "Europe PMC REST API",
    apiEndpoint: "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
    authRequired: false,
    rateLimit: "20 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "publication", "pdf_url", "html_url", "license", "citation_count"],
    fullTextAvailable: true,
    licenseInfo: "Europe PMC Open Access",
    healthStatus: "operational",
    updateSchedule: "Realtime Ingestion"
  },
  {
    id: "pubmed",
    name: "PubMed E-utilities API",
    apiEndpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    authRequired: false,
    rateLimit: "10 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "publication", "html_url", "citation_count"],
    fullTextAvailable: false,
    licenseInfo: "NCBI Open Metadata",
    healthStatus: "operational",
    updateSchedule: "Daily Update"
  },
  {
    id: "core",
    name: "CORE Open Access API",
    apiEndpoint: "https://api.core.ac.uk/v3/search/works",
    authRequired: false,
    rateLimit: "10 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "pdf_url", "html_url", "license"],
    fullTextAvailable: true,
    licenseInfo: "CORE Open Access Index",
    healthStatus: "operational",
    updateSchedule: "Daily Ingestion"
  },
  {
    id: "doaj",
    name: "DOAJ Open Access API",
    apiEndpoint: "https://doaj.org/api/v2/search/articles",
    authRequired: false,
    rateLimit: "15 req/sec",
    supportedFields: ["title", "authors", "doi", "year", "abstract", "publication", "publisher", "pdf_url", "license"],
    fullTextAvailable: true,
    licenseInfo: "DOAJ Open Journal License",
    healthStatus: "operational",
    updateSchedule: "Weekly Ingestion"
  }
];

export function getActiveSources(): ResearchSource[] {
  return researchSourceRegistry.filter(s => s.healthStatus === "operational");
}
