"""
shoRDs Duplicate Resolution Engine
Merges duplicate paper records from multiple providers into canonical entries.
"""

from typing import Dict, List, Any

class DeduplicationEngine:
    def deduplicate_papers(self, papers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen_dois = set()
        unique_papers = []

        for p in papers:
            doi = p.get("doi")
            if doi and doi in seen_dois:
                continue
            if doi:
                seen_dois.add(doi)
            unique_papers.append(p)

        return unique_papers

deduplication_engine = DeduplicationEngine()
