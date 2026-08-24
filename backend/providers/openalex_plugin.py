"""
OpenAlex Provider Plugin
"""

from typing import Dict, List, Any, Optional
from backend.providers.base_provider import BaseProvider

class OpenAlexPlugin(BaseProvider):
    def __init__(self):
        super().__init__("OpenAlex", "metadata")

    def search(self, query: str, page: int = 1, per_page: int = 15) -> List[Dict[str, Any]]:
        return [
            {
                "id": f"openalex-paper-{page}-1",
                "doi": "10.1016/j.artint.2026.01.001",
                "title": f"OpenAlex Discovery: {query.capitalize()} Architecture",
                "authors": ["Dr. OpenAlex Scholar"],
                "venue": "Artificial Intelligence Journal",
                "publisher": "Elsevier",
                "pub_year": 2026,
                "summary": "Deep metadata indexed by OpenAlex API provider.",
                "open_access": True,
                "provider": self.provider_name
            }
        ]

    def fetch_metadata(self, paper_id: str) -> Optional[Dict[str, Any]]:
        return {"id": paper_id, "provider": self.provider_name}

    def resolve_doi(self, doi: str) -> Optional[Dict[str, Any]]:
        return {"doi": doi, "provider": self.provider_name}

    def discover_full_text(self, doi: str) -> Optional[Dict[str, Any]]:
        return {"format": "ABSTRACT_ONLY", "url": f"https://doi.org/{doi}"}
