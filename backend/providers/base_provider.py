"""
shoRDs Modular Base Provider Plugin Interface
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional

class BaseProvider(ABC):
    def __init__(self, provider_name: str, category: str):
        self.provider_name = provider_name
        self.category = category # "metadata" | "repository" | "publisher"
        self.latency_ms = 120
        self.is_healthy = True

    @abstractmethod
    def search(self, query: str, page: int = 1, per_page: int = 15) -> List[Dict[str, Any]]:
        """Search provider for papers matching query."""
        pass

    @abstractmethod
    def fetch_metadata(self, paper_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve detailed paper metadata."""
        pass

    @abstractmethod
    def resolve_doi(self, doi: str) -> Optional[Dict[str, Any]]:
        """Resolve paper metadata via universal DOI."""
        pass

    @abstractmethod
    def discover_full_text(self, doi: str) -> Optional[Dict[str, Any]]:
        """Discover richest legally available full text copy."""
        pass
