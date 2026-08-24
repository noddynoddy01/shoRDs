import re
from typing import List
from metadata_engine import CanonicalPaper

def normalize_title(title: str) -> str:
    """Removes punctuation and normalizes whitespace/case for fuzzy matching."""
    s = re.sub(r'[^a-zA-Z0-9\s]', '', title.lower())
    return ' '.join(s.split())

def title_jaccard_similarity(t1: str, t2: str) -> float:
    set1 = set(normalize_title(t1).split())
    set2 = set(normalize_title(t2).split())
    if not set1 or not set2:
        return 0.0
    intersection = len(set1.intersection(set2))
    union = len(set1.union(set2))
    return intersection / float(union)

class DeduplicationEngine:
    """
    COMPONENT 3: Duplicate Detection
    Detects duplicates across federated sources using exact IDs and fuzzy similarity.
    Consolidates into one canonical paper record.
    """
    @staticmethod
    def deduplicate_papers(papers: List[CanonicalPaper]) -> List[CanonicalPaper]:
        canonical_list: List[CanonicalPaper] = []

        for paper in papers:
            matched_index = None

            # 1. Exact Identifier Checks (DOI, arXiv ID, PMCID)
            for idx, existing in enumerate(canonical_list):
                if paper.doi and existing.doi and paper.doi.lower() == existing.doi.lower():
                    matched_index = idx
                    break
                if paper.arxiv_id and existing.arxiv_id and paper.arxiv_id.lower() == existing.arxiv_id.lower():
                    matched_index = idx
                    break
                if paper.pmcid and existing.pmcid and paper.pmcid.lower() == existing.pmcid.lower():
                    matched_index = idx
                    break
                
                # 2. Fuzzy Title & Author Similarity Check
                sim = title_jaccard_similarity(paper.title, existing.title)
                if sim > 0.85:
                    # Verify year or author overlap to prevent false positives on common titles
                    author_overlap = set([a.lower() for a in paper.authors]).intersection(
                        set([a.lower() for a in existing.authors])
                    )
                    if author_overlap or abs(paper.year - existing.year) <= 1:
                        matched_index = idx
                        break

            if matched_index is not None:
                # Merge into canonical record (keep richest fields & links)
                existing = canonical_list[matched_index]
                canonical_list[matched_index] = DeduplicationEngine.merge_canonical_records(existing, paper)
            else:
                canonical_list.append(paper)

        return canonical_list

    @staticmethod
    def merge_canonical_records(p1: CanonicalPaper, p2: CanonicalPaper) -> CanonicalPaper:
        """Merges two paper records, keeping the most complete metadata and valid links."""
        return CanonicalPaper(
            id=p1.id if "openalex" in p1.id or "arxiv" in p1.id else p2.id,
            title=p1.title if len(p1.title) >= len(p2.title) else p2.title,
            authors=p1.authors if len(p1.authors) >= len(p2.authors) else p2.authors,
            doi=p1.doi or p2.doi,
            year=min(p1.year, p2.year),
            abstract=p1.abstract if len(p1.abstract) >= len(p2.abstract) else p2.abstract,
            publication=p1.publication or p2.publication,
            publisher=p1.publisher or p2.publisher,
            pdf_url=p1.pdf_url or p2.pdf_url,
            html_url=p1.html_url or p2.html_url,
            license=p1.license if p1.license != "Unknown" else p2.license,
            keywords=list(set(p1.keywords + p2.keywords)),
            citation_count=max(p1.citation_count, p2.citation_count),
            research_field=p1.research_field if p1.research_field != "General Science" else p2.research_field,
            institution=p1.institution or p2.institution,
            source=f"{p1.source}, {p2.source}",
            primary_url=p1.primary_url or p2.primary_url,
            is_open_access=p1.is_open_access or p2.is_open_access,
            arxiv_id=p1.arxiv_id or p2.arxiv_id,
            pmcid=p1.pmcid or p2.pmcid
        )
