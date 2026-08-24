from typing import List, Optional
from pydantic import BaseModel

class ResearchSource(BaseModel):
    id: str
    name: str
    api_endpoint: str
    auth_required: bool = False
    rate_limit: str
    supported_fields: List[str]
    full_text_available: bool
    license_info: str
    health_status: str = "operational"  # operational | degraded | offline
    update_schedule: str
    headers: Optional[dict] = None

class ResearchSourceRegistry:
    """
    Centralized Research Source Registry (Architectural Core)
    Consulted by the backend to decide where and how to retrieve papers dynamically.
    """
    def __init__(self):
        self.sources: List[ResearchSource] = [
            ResearchSource(
                id="openalex",
                name="OpenAlex Metadata API",
                api_endpoint="https://api.openalex.org/works",
                auth_required=False,
                rate_limit="100 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "publication", "publisher", "pdf_url", "html_url", "license", "citation_count", "research_field", "institution"],
                full_text_available=True,
                license_info="CC0 Open Data",
                health_status="operational",
                update_schedule="Daily Ingestion",
                headers={"User-Agent": "shoRDs-Bot/2.0 (mailto:support@shords.app)"}
            ),
            ResearchSource(
                id="arxiv",
                name="arXiv Open Access API",
                api_endpoint="https://export.arxiv.org/api/query",
                auth_required=False,
                rate_limit="3 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "publication", "pdf_url", "html_url", "license", "research_field"],
                full_text_available=True,
                license_info="arXiv Open Access License",
                health_status="operational",
                update_schedule="Realtime Stream"
            ),
            ResearchSource(
                id="crossref",
                name="Crossref REST API",
                api_endpoint="https://api.crossref.org/works",
                auth_required=False,
                rate_limit="50 req/sec",
                supported_fields=["title", "authors", "doi", "year", "publication", "publisher", "html_url", "license", "citation_count"],
                full_text_available=False,
                license_info="Crossref Open Metadata",
                health_status="operational",
                update_schedule="Daily Ingestion",
                headers={"User-Agent": "shoRDs-Bot/2.0 (mailto:support@shords.app)"}
            ),
            ResearchSource(
                id="europepmc",
                name="Europe PMC REST API",
                api_endpoint="https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                auth_required=False,
                rate_limit="20 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "publication", "pdf_url", "html_url", "license", "citation_count"],
                full_text_available=True,
                license_info="Europe PMC Open Access",
                health_status="operational",
                update_schedule="Realtime Stream"
            ),
            ResearchSource(
                id="pubmed",
                name="PubMed Metadata E-utilities",
                api_endpoint="https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
                auth_required=False,
                rate_limit="10 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "publication", "html_url", "citation_count"],
                full_text_available=False,
                license_info="NCBI Open Metadata",
                health_status="operational",
                update_schedule="Daily Ingestion"
            ),
            ResearchSource(
                id="core",
                name="CORE Open Access Repository API",
                api_endpoint="https://api.core.ac.uk/v3/search/works",
                auth_required=False,
                rate_limit="10 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "pdf_url", "html_url", "license"],
                full_text_available=True,
                license_info="CORE Open Access Index",
                health_status="operational",
                update_schedule="Daily Ingestion"
            ),
            ResearchSource(
                id="doaj",
                name="Directory of Open Access Journals (DOAJ)",
                api_endpoint="https://doaj.org/api/v2/search/articles",
                auth_required=False,
                rate_limit="15 req/sec",
                supported_fields=["title", "authors", "doi", "year", "abstract", "publication", "publisher", "pdf_url", "license"],
                full_text_available=True,
                license_info="DOAJ Open Journal License",
                health_status="operational",
                update_schedule="Weekly Ingestion"
            )
        ]

    def get_active_sources((self) -> List[ResearchSource]:
        return [s for s in self.sources if s.health_status == "operational"]

    def get_source_by_id(self, source_id: str) -> Optional[ResearchSource]:
        for s in self.sources:
            if s.id.lower() == source_id.lower():
                return s
        return None

registry = ResearchSourceRegistry()
