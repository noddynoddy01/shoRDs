import math
from typing import List, Optional
from metadata_engine import CanonicalPaper

class RankingEngine:
    """
    COMPONENT 14: Multi-Factor Ranking Engine
    Sorts papers using composite scoring:
    Semantic relevance * w1 + log(citation_count + 1) * w2 + Recency Decay * w3 + OA Boost * w4
    """
    @staticmethod
    def rank_papers(
        papers: List[CanonicalPaper],
        query: str = "",
        sort_by: str = "relevance",
        current_year: int = 2026
    ) -> List[CanonicalPaper]:
        if sort_by == "newest":
            return sorted(papers, key=lambda p: p.year, reverse=True)
        elif sort_by == "oldest":
            return sorted(papers, key=lambda p: p.year)
        elif sort_by == "citations":
            return sorted(papers, key=lambda p: p.citation_count, reverse=True)
        
        # Multi-factor relevance calculation
        def compute_score(paper: CanonicalPaper) -> float:
            score = 1.0
            
            # Recency factor
            age = max(0, current_year - paper.year)
            recency_decay = math.exp(-0.08 * age)
            
            # Citation log scale
            citation_score = math.log(paper.citation_count + 1)
            
            # Open Access boost
            oa_boost = 1.3 if paper.is_open_access else 1.0
            
            # Simple keyword matching boost
            query_terms = [t.lower() for t in query.split() if len(t) > 2]
            title_lower = paper.title.lower()
            abstract_lower = paper.abstract.lower()
            keyword_matches = sum(1 for term in query_terms if term in title_lower or term in abstract_lower)
            relevance_boost = 1.0 + (0.4 * keyword_matches)

            score = relevance_boost * (1.0 + 0.3 * citation_score) * (0.5 + 0.5 * recency_decay) * oa_boost
            return score

        return sorted(papers, key=compute_score, reverse=True)
