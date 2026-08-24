"""
shoRDs Multi-Version Paper Resolver
Evaluates version hierarchy to select the richest legal copy.
"""

from typing import Dict, List, Any

VERSION_HIERARCHY = [
    "JATS_XML",
    "HTML_PARSED",
    "FULL_TEXT_PDF",
    "ACCEPTED_MANUSCRIPT",
    "PREPRINT",
    "ABSTRACT_ONLY",
    "METADATA_ONLY"
]

class MultiVersionPaperResolver:
    def resolve_best_version(self, available_versions: List[Dict[str, Any]]) -> Dict[str, Any]:
        sorted_versions = sorted(
            available_versions,
            key=lambda v: VERSION_HIERARCHY.index(v.get("format", "METADATA_ONLY")) if v.get("format") in VERSION_HIERARCHY else 99
        )
        return sorted_versions[0] if sorted_versions else {"format": "METADATA_ONLY"}

version_resolver = MultiVersionPaperResolver()
