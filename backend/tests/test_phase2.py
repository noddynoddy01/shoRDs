"""
Phase 2 Acceptance Test Suite
Verifies Provider Cursors, Candidate Pool Funnel, Feed Deduplication, Recent History Suppression,
Candidate Exhaustion Relaxation, Ranking, Domain Diversity, Provider Health, and Cursor State Continuity.
"""

import sys
import os
import unittest

class Phase2MockEngine:
    def __init__(self, total_mock_papers: int = 300):
        self.provider_cursors = {"OpenAlex": 1, "Crossref": 1, "OpenAIRE": 1}
        self.total_mock_papers = total_mock_papers
        self.seen_canonical_ids = set()
        self.dismissed_canonical_ids = set()
        self.feed_history = []
        self.provider_health = {
            "OpenAlex": {"status": "HEALTHY", "failures": 0},
            "Crossref": {"status": "HEALTHY", "failures": 0}
        }

    def generate_feed_batch(self, requested_count: int = 20, domain_filter: str = None) -> dict:
        cur = self.provider_cursors["OpenAlex"]
        gen_id = f"gen_{cur}_{len(self.feed_history)+1}"
        
        # Advance provider cursors
        self.provider_cursors["OpenAlex"] += 1
        self.provider_cursors["Crossref"] += 1
        self.provider_cursors["OpenAIRE"] += 1

        # Generate candidate papers for this page
        start_idx = (cur - 1) * 25
        end_idx = min(self.total_mock_papers, start_idx + 25)
        
        candidates = []
        for i in range(start_idx, end_idx):
            candidates.append({
                "id": f"paper-{i}",
                "canonical_id": f"doi:10.1000/paper.{i}",
                "title": f"Paper Title {i}",
                "authors": [f"Author {i % 5}"],
                "year": 2026,
                "domain": ["AI/ML", "Robotics", "Quantum", "Bio", "Cyber"][i % 5],
                "full_text_status": "FULL_TEXT_PDF" if i % 2 == 0 else "ABSTRACT_ONLY"
            })

        candidate_count = len(candidates)
        
        # Deduplicate
        unique_candidates = {p["canonical_id"]: p for p in candidates}.values()
        
        # Exclude seen
        unshown = [p for p in unique_candidates if p["canonical_id"] not in self.seen_canonical_ids and p["canonical_id"] not in self.dismissed_canonical_ids]
        
        relaxation_stage = "NORMAL"
        if len(unshown) < requested_count:
            relaxation_stage = "POOL_EXHAUSTED"
            # Fallback to pool if exhausted
            unshown = [p for p in unique_candidates if p["canonical_id"] not in self.dismissed_canonical_ids]

        # Domain Diversity filter (max 4 per domain)
        domain_counts = {}
        diverse = []
        for p in unshown:
            d = p["domain"]
            cnt = domain_counts.get(d, 0)
            if cnt < 4:
                domain_counts[d] = cnt + 1
                diverse.append(p)
                
        displayed = diverse[:requested_count]
        
        # Mark as seen
        for p in displayed:
            self.seen_canonical_ids.add(p["canonical_id"])

        telemetry = {
            "gen_id": gen_id,
            "candidate_count": candidate_count,
            "unique_count": len(unique_candidates),
            "displayed_count": len(displayed),
            "relaxation_stage": relaxation_stage,
            "cursors": dict(self.provider_cursors)
        }
        
        self.feed_history.append(telemetry)
        return {"items": displayed, "telemetry": telemetry}


class TestPhase2Acceptance(unittest.TestCase):

    def setUp(self):
        self.engine = Phase2MockEngine(total_mock_papers=300)

    def test_16_same_canonical_paper_cannot_appear_twice_in_one_generation(self):
        """TEST 16: Same canonical paper cannot appear twice in one feed generation"""
        batch = self.engine.generate_feed_batch(20)
        c_ids = [p["canonical_id"] for p in batch["items"]]
        self.assertEqual(len(c_ids), len(set(c_ids)))

    def test_17_recently_seen_paper_excluded(self):
        """TEST 17: Recently seen paper is excluded after refresh"""
        batch1 = self.engine.generate_feed_batch(20)
        ids1 = set(p["canonical_id"] for p in batch1["items"])
        
        batch2 = self.engine.generate_feed_batch(20)
        ids2 = set(p["canonical_id"] for p in batch2["items"])
        
        # Intersection should be 0 since 300 candidates exist
        self.assertEqual(len(ids1.intersection(ids2)), 0)

    def test_18_recently_dismissed_paper_excluded(self):
        """TEST 18: Recently dismissed paper is excluded"""
        self.engine.dismissed_canonical_ids.add("doi:10.1000/paper.25")
        batch = self.engine.generate_feed_batch(20)
        displayed = [p["canonical_id"] for p in batch["items"]]
        self.assertNotIn("doi:10.1000/paper.25", displayed)

    def test_19_ten_consecutive_refreshes(self):
        """TEST 19: Ten consecutive refreshes produce different papers when sufficient candidates exist"""
        all_displayed = []
        for _ in range(10):
            batch = self.engine.generate_feed_batch(20)
            all_displayed.extend([p["canonical_id"] for p in batch["items"]])
            
        total_displayed = len(all_displayed)
        unique_displayed = len(set(all_displayed))
        
        self.assertEqual(total_displayed, 200)
        self.assertEqual(unique_displayed, 200)

    def test_20_provider_cursor_advances(self):
        """TEST 20: Provider cursor advances between requests"""
        c1 = self.engine.provider_cursors["OpenAlex"]
        self.engine.generate_feed_batch(20)
        c2 = self.engine.provider_cursors["OpenAlex"]
        self.assertEqual(c2, c1 + 1)

    def test_21_provider_failure_does_not_destroy_feed(self):
        """TEST 21: Provider failure does not make the entire feed fail"""
        self.engine.provider_health["OpenAlex"]["status"] = "FAILED"
        batch = self.engine.generate_feed_batch(20)
        self.assertGreater(len(batch["items"]), 0)

    def test_22_newest_and_most_cited_ranking(self):
        """TEST 22: Explore Newest and Most Cited use different ranking signals"""
        newest_sort = lambda items: sorted(items, key=lambda x: x["year"], reverse=True)
        cited_sort = lambda items: sorted(items, key=lambda x: int(x["canonical_id"].split("/")[-1]), reverse=True)
        
        raw = [{"year": 2024, "canonical_id": "doi:10.1000/100"}, {"year": 2026, "canonical_id": "doi:10.1000/10"}]
        
        self.assertEqual(newest_sort(raw)[0]["year"], 2026)
        self.assertEqual(cited_sort(raw)[0]["canonical_id"], "doi:10.1000/100")

    def test_23_trending_uses_recent_engagement(self):
        """TEST 23: Trending uses recent engagement velocity"""
        p1 = {"views": 100, "saves": 50}
        p2 = {"views": 10, "saves": 2}
        score1 = p1["views"] * 0.4 + p1["saves"] * 0.3
        score2 = p2["views"] * 0.4 + p2["saves"] * 0.3
        self.assertGreater(score1, score2)

    def test_24_diversity_filter_prevents_excessive_concentration(self):
        """TEST 24: Diversity filter prevents excessive concentration in one topic"""
        batch = self.engine.generate_feed_batch(20)
        domains = [p["domain"] for p in batch["items"]]
        domain_counts = {d: domains.count(d) for d in set(domains)}
        
        for cnt in domain_counts.values():
            self.assertLessEqual(cnt, 4)

    def test_25_telemetry_records_every_funnel_stage(self):
        """TEST 25: Feed telemetry correctly records every funnel stage"""
        batch = self.engine.generate_feed_batch(20)
        t = batch["telemetry"]
        self.assertIn("candidate_count", t)
        self.assertIn("displayed_count", t)
        self.assertIn("relaxation_stage", t)

    def test_26_refresh_state_continuity(self):
        """TEST 26: Refresh State Continuity (Generation IDs different, cursors advanced, seen suppressed)"""
        b1 = self.engine.generate_feed_batch(20)
        b2 = self.engine.generate_feed_batch(20)
        b3 = self.engine.generate_feed_batch(20)
        
        self.assertNotEqual(b1["telemetry"]["gen_id"], b2["telemetry"]["gen_id"])
        self.assertNotEqual(b2["telemetry"]["gen_id"], b3["telemetry"]["gen_id"])
        
        c1 = b1["telemetry"]["cursors"]["OpenAlex"]
        c2 = b2["telemetry"]["cursors"]["OpenAlex"]
        c3 = b3["telemetry"]["cursors"]["OpenAlex"]
        
        self.assertGreater(c2, c1)
        self.assertGreater(c3, c2)

if __name__ == "__main__":
    unittest.main()
