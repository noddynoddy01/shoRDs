import asyncio
import httpx
import urllib.parse
import xml.etree.ElementTree as ET
from typing import List, Optional, Dict
from source_registry import registry
from metadata_engine import CanonicalPaper, UnifiedMetadataEngine
from deduplication import DeduplicationEngine
from ranking_engine import RankingEngine

SYNONYM_DICTIONARY = {
    "llm": ["large language model", "transformer", "generative ai"],
    "ai": ["artificial intelligence", "machine learning", "deep learning"],
    "quantum": ["quantum computing", "quantum information", "qubit"],
    "cancer": ["oncology", "carcinoma", "tumor"],
    "crispr": ["gene editing", "cas9", "genome engineering"]
}

def expand_query(query: str) -> str:
    """COMPONENT 13: Synonym Expansion and Intent Detection."""
    tokens = query.lower().split()
    expanded = list(tokens)
    for token in tokens:
        if token in SYNONYM_DICTIONARY:
            expanded.extend(SYNONYM_DICTIONARY[token])
    return " ".join(dict.fromkeys(expanded))

class FederatedSearchEngine:
    """
    COMPONENT 1: Federated Research Search
    Executes simultaneous async queries across active registered research sources.
    Never searches local papers.
    """
    @staticmethod
    async def fetch_openalex(client: httpx.AsyncClient, query: str, limit: int = 15) -> List[CanonicalPaper]:
        try:
            url = f"https://api.openalex.org/works?search={urllib.parse.quote(query)}&per-page={limit}"
            headers = {"User-Agent": "shoRDs-Bot/2.0 (mailto:support@shords.app)"}
            resp = await client.get(url, headers=headers, timeout=5.0)
            if resp.status_code != 200:
                return []
            data = resp.json()
            return [UnifiedMetadataEngine.normalize_openalex(item) for item in data.get("results", [])]
        except Exception as e:
            print(f"[OpenAlex Error]: {e}")
            return []

    @staticmethod
    async def fetch_arxiv(client: httpx.AsyncClient, query: str, limit: int = 15) -> List[CanonicalPaper]:
        try:
            url = f"https://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(query)}&start=0&max_results={limit}"
            resp = await client.get(url, timeout=5.0)
            if resp.status_code != 200:
                return []
            
            root = ET.fromstring(resp.text)
            ns = {'atom': 'http://www.w3.org/2005/Atom', 'arxiv': 'http://arxiv.org/schemas/atom'}
            papers = []
            
            for entry in root.findall('atom:entry', ns):
                title_elem = entry.find('atom:title', ns)
                summary_elem = entry.find('atom:summary', ns)
                id_elem = entry.find('atom:id', ns)
                published_elem = entry.find('atom:published', ns)
                
                authors = [a.find('atom:name', ns).text for a in entry.findall('atom:author', ns) if a.find('atom:name', ns) is not None]
                categories = [c.attrib.get('term') for c in entry.findall('atom:category', ns) if 'term' in c.attrib]
                
                pub_year = 2026
                if published_elem is not None and published_elem.text:
                    pub_year = int(published_elem.text[:4])

                raw = {
                    "id": id_elem.text if id_elem is not None else "",
                    "title": title_elem.text if title_elem is not None else "",
                    "summary": summary_elem.text if summary_elem is not None else "",
                    "authors": authors,
                    "year": pub_year,
                    "categories": categories
                }
                papers.append(UnifiedMetadataEngine.normalize_arxiv(raw))
            return papers
        except Exception as e:
            print(f"[arXiv Error]: {e}")
            return []

    @staticmethod
    async def fetch_crossref(client: httpx.AsyncClient, query: str, limit: int = 15) -> List[CanonicalPaper]:
        try:
            url = f"https://api.crossref.org/works?query={urllib.parse.quote(query)}&rows={limit}"
            headers = {"User-Agent": "shoRDs-Bot/2.0 (mailto:support@shords.app)"}
            resp = await client.get(url, headers=headers, timeout=5.0)
            if resp.status_code != 200:
                return []
            data = resp.json()
            items = data.get("message", {}).get("items", [])
            return [UnifiedMetadataEngine.normalize_crossref(item) for item in items]
        except Exception as e:
            print(f"[Crossref Error]: {e}")
            return []

    @staticmethod
    async def fetch_europepmc(client: httpx.AsyncClient, query: str, limit: int = 15) -> List[CanonicalPaper]:
        try:
            url = f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={urllib.parse.quote(query)}&format=json&pageSize={limit}"
            resp = await client.get(url, timeout=5.0)
            if resp.status_code != 200:
                return []
            data = resp.json()
            results = data.get("resultList", {}).get("result", [])
            return [UnifiedMetadataEngine.normalize_europepmc(item) for item in results]
        except Exception as e:
            print(f"[EuropePMC Error]: {e}")
            return []

    @classmethod
    async def search_all(
        cls,
        query: str,
        filters: Optional[Dict] = None,
        limit: int = 20,
        page: int = 1
    ) -> List[CanonicalPaper]:
        expanded_q = expand_query(query)
        
        async with httpx.AsyncClient(follow_redirects=True) as client:
            tasks = [
                cls.fetch_openalex(client, expanded_q, limit),
                cls.fetch_arxiv(client, expanded_q, limit),
                cls.fetch_crossref(client, expanded_q, limit),
                cls.fetch_europepmc(client, expanded_q, limit),
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        raw_papers: List[CanonicalPaper] = []
        for res in results:
            if isinstance(res, list):
                raw_papers.extend(res)

        # COMPONENT 3: Deduplication
        deduped = DeduplicationEngine.deduplicate_papers(raw_papers)

        # COMPONENT 15: Filters & COMPONENT 23: Security & OA rules
        filtered = deduped
        if filters:
            if filters.get("open_access_only"):
                filtered = [p for p in filtered if p.is_open_access]
            if filters.get("year_start"):
                filtered = [p for p in filtered if p.year >= filters["year_start"]]
            if filters.get("year_end"):
                filtered = [p for p in filtered if p.year <= filters["year_end"]]

        # COMPONENT 14: Multi-Factor Ranking
        sort_by = filters.get("sort_by", "relevance") if filters else "relevance"
        ranked = RankingEngine.rank_papers(filtered, query=query, sort_by=sort_by)

        # COMPONENT 11: Infinite Feed Pagination
        start_idx = (page - 1) * limit
        return ranked[start_idx : start_idx + limit]
