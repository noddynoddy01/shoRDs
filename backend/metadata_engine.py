from typing import List, Optional
from pydantic import BaseModel, Field

class CanonicalPaper(BaseModel):
    """
    COMPONENT 2: Unified Metadata Engine
    Strict canonical paper schema output by all federated providers.
    """
    id: str
    title: str
    authors: List[str] = Field(default_factory=list)
    doi: Optional[str] = None
    year: int = 2026
    abstract: str = ""
    publication: str = ""
    publisher: str = ""
    pdf_url: Optional[str] = None
    html_url: Optional[str] = None
    license: str = "Unknown"
    keywords: List[str] = Field(default_factory=list)
    citation_count: int = 0
    research_field: str = "General Science"
    institution: str = ""
    source: str = ""

    # COMPONENT 5: Strict Link Resolver Metadata
    primary_url: Optional[str] = None
    is_open_access: bool = False
    arxiv_id: Optional[str] = None
    pmcid: Optional[str] = None

class UnifiedMetadataEngine:
    @staticmethod
    def normalize_openalex(raw_item: dict) -> CanonicalPaper:
        title = raw_item.get("title") or "Untitled Manuscript"
        doi_raw = raw_item.get("doi") or ""
        doi = doi_raw.replace("https://doi.org/", "") if doi_raw else None
        
        authorships = raw_item.get("authorships") or []
        authors = [a.get("author", {}).get("display_name", "") for a in authorships if a.get("author", {}).get("display_name")]
        if not authors:
            authors = ["Academic Scholar"]

        inst = ""
        if authorships and authorships[0].get("institutions"):
            inst = authorships[0]["institutions"][0].get("display_name", "")

        pub_year = raw_item.get("publication_year") or 2026
        citations = raw_item.get("cited_by_count") or 0
        
        host_venue = raw_item.get("host_venue") or {}
        publication = host_venue.get("display_name") or "OpenAlex Index"
        publisher = host_venue.get("publisher") or ""
        
        oa_info = raw_item.get("open_access") or {}
        is_oa = oa_info.get("is_oa", False)
        pdf_url = oa_info.get("oa_url") or (f"https://doi.org/{doi}" if doi and is_oa else None)
        html_url = raw_item.get("doi") or raw_item.get("id") or ""
        
        concepts = raw_item.get("concepts") or []
        keywords = [c.get("display_name") for c in concepts if c.get("display_name")]
        field = keywords[0] if keywords else "Multidisciplinary"

        return CanonicalPaper(
            id=f"openalex-{raw_item.get('id', '').split('/')[-1]}",
            title=title,
            authors=authors,
            doi=doi,
            year=pub_year,
            abstract=raw_item.get("abstract") or f"Indexed by OpenAlex in {publication}. Citations: {citations}.",
            publication=publication,
            publisher=publisher,
            pdf_url=pdf_url,
            html_url=html_url,
            license="CC0 / Open Metadata",
            keywords=keywords[:5],
            citation_count=citations,
            research_field=field,
            institution=inst,
            source="OpenAlex",
            primary_url=html_url,
            is_open_access=is_oa
        )

    @staticmethod
    def normalize_arxiv(raw_item: dict) -> CanonicalPaper:
        title = raw_item.get("title", "").replace("\n", " ").strip() or "Untitled arXiv Paper"
        arxiv_id = raw_item.get("id", "").split("/")[-1].split("v")[0]
        authors = raw_item.get("authors", [])
        if isinstance(authors, str):
            authors = [authors]
        
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        html_url = f"https://arxiv.org/abs/{arxiv_id}"
        
        return CanonicalPaper(
            id=f"arxiv-{arxiv_id}",
            title=title,
            authors=authors if authors else ["arXiv Author"],
            doi=raw_item.get("doi"),
            year=raw_item.get("year", 2026),
            abstract=raw_item.get("summary", "").strip(),
            publication="arXiv Preprint Repository",
            publisher="Cornell University",
            pdf_url=pdf_url,
            html_url=html_url,
            license="arXiv Open Access",
            keywords=raw_item.get("categories", ["Computer Science"]),
            citation_count=0,
            research_field=raw_item.get("primary_category", "Computer Science"),
            institution="arXiv",
            source="arXiv",
            primary_url=html_url,
            is_open_access=True,
            arxiv_id=arxiv_id
        )

    @staticmethod
    def normalize_crossref(raw_item: dict) -> CanonicalPaper:
        title_list = raw_item.get("title") or ["Crossref Work"]
        title = title_list[0] if title_list else "Crossref Work"
        doi = raw_item.get("DOI")
        
        authors_raw = raw_item.get("author") or []
        authors = [f"{a.get('given', '')} {a.get('family', '')}".strip() for a in authors_raw]
        if not authors:
            authors = ["Crossref Scholar"]
            
        pub_parts = raw_item.get("created", {}).get("date-parts", [[2026]])
        year = pub_parts[0][0] if pub_parts and pub_parts[0] else 2026
        
        container = raw_item.get("container-title") or []
        publication = container[0] if container else "Crossref Journal"
        publisher = raw_item.get("publisher", "")
        
        link_list = raw_item.get("link") or []
        pdf_url = link_list[0].get("URL") if link_list else None
        html_url = raw_item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
        
        return CanonicalPaper(
            id=f"crossref-{doi.replace('/', '-') if doi else 'work'}",
            title=title,
            authors=authors,
            doi=doi,
            year=year,
            abstract=raw_item.get("abstract", f"Crossref publication record in {publication}."),
            publication=publication,
            publisher=publisher,
            pdf_url=pdf_url,
            html_url=html_url,
            license="Crossref Metadata",
            keywords=[],
            citation_count=raw_item.get("is-referenced-by-count", 0),
            research_field="Academic Research",
            institution="",
            source="Crossref",
            primary_url=html_url,
            is_open_access=bool(pdf_url)
        )

    @staticmethod
    def normalize_europepmc(raw_item: dict) -> CanonicalPaper:
        title = raw_item.get("title") or "Europe PMC Publication"
        doi = raw_item.get("doi")
        pmcid = raw_item.get("pmcid")
        author_string = raw_item.get("authorString", "BioMed Researcher")
        authors = [a.strip() for a in author_string.split(",")]
        
        pub_year = int(raw_item.get("pubYear", 2026))
        publication = raw_item.get("journalTitle") or "Europe PMC"
        is_oa = raw_item.get("isOpenAccess") == "Y"
        
        pdf_url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML" if pmcid and is_oa else None
        html_url = f"https://europepmc.org/article/MED/{raw_item.get('pmid')}" if raw_item.get("pmid") else f"https://doi.org/{doi}"

        return CanonicalPaper(
            id=f"europepmc-{pmcid or raw_item.get('id', 'med')}",
            title=title,
            authors=authors,
            doi=doi,
            year=pub_year,
            abstract=raw_item.get("abstractText", f"Biomedical research article indexed in Europe PMC."),
            publication=publication,
            publisher="",
            pdf_url=pdf_url,
            html_url=html_url,
            license="Europe PMC Open Access" if is_oa else "Subscription / Abstract Only",
            keywords=["Biomedical", "Life Sciences"],
            citation_count=int(raw_item.get("citedByCount", 0)),
            research_field="Biomedical Sciences",
            institution="",
            source="Europe PMC",
            primary_url=html_url,
            is_open_access=is_oa,
            pmcid=pmcid
        )
