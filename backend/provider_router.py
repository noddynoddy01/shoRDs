"""
shoRDs Intelligent Provider Router & Gateway
Orchestrates parallel search across modular provider plugins.
"""

from typing import Dict, List, Any
from backend.providers.openalex_plugin import OpenAlexPlugin
from backend.providers.crossref_plugin import CrossrefPlugin
from backend.providers.europe_pmc_plugin import EuropePMCPlugin
from backend.providers.arxiv_plugin import ArxivPlugin

class IntelligentProviderRouter:
    def __init__(self):
        self.plugins = [
            OpenAlexPlugin(),
            CrossrefPlugin(),
            EuropePMCPlugin(),
            ArxivPlugin()
        ]

    def search_all_providers(self, query: str, page: int = 1) -> List[Dict[str, Any]]:
        aggregated_results = []
        for plugin in self.plugins:
            if plugin.is_healthy:
                try:
                    res = plugin.search(query, page=page)
                    aggregated_results.extend(res)
                except Exception as err:
                    print(f"Error querying {plugin.provider_name}: {err}")
        return aggregated_results

provider_router = IntelligentProviderRouter()
