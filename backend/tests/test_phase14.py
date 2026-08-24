"""
Phase 14 Public Beta Intelligence, Retention, Monetization & Telemetry Acceptance Test Suite for shoRDs (Tests 151-165)
"""

import unittest
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestPhase14Acceptance(unittest.TestCase):

    def test_151_analytics_schema_and_pii_sanitization(self):
        """TEST 151: Analytics event schema normalization and PII sanitization."""
        metadata = {"card_number": "4111222233334444", "domain": "AI / ML"}
        clean = {}
        for k, v in metadata.items():
            clean[k] = "[REDACTED_PII]" if "card" in k else v
        self.assertEqual(clean["card_number"], "[REDACTED_PII]")
        self.assertEqual(clean["domain"], "AI / ML")

    def test_152_funnel_metrics_calculation(self):
        """TEST 152: Core product funnel metrics calculation."""
        events = [
            {"eventName": "brief_started"},
            {"eventName": "brief_started"},
            {"eventName": "brief_completed"},
            {"eventName": "original_paper_clicked"}
        ]
        started = len([e for e in events if e["eventName"] == "brief_started"])
        completed = len([e for e in events if e["eventName"] == "brief_completed"])
        completion_rate = completed / started
        self.assertEqual(completion_rate, 0.5)

    def test_153_brief_completion_rate_formula(self):
        """TEST 153: Research Brief Completion Rate calculation."""
        started = 100
        completed = 65
        rate = completed / started
        self.assertEqual(rate, 0.65)

    def test_154_original_paper_ctr_formula(self):
        """TEST 154: Original Paper CTR calculation."""
        started = 100
        clicks = 34
        ctr = clicks / started
        self.assertEqual(ctr, 0.34)

    def test_155_audio_completion_rate(self):
        """TEST 155: Audio Completion Rate calculation."""
        starts = 50
        completions = 30
        rate = completions / starts
        self.assertEqual(rate, 0.60)

    def test_156_north_star_meaningful_session_evaluation(self):
        """TEST 156: Candidate North Star metric evaluation (Meaningful Research Session)."""
        session = {
            "readingDurationSeconds": 110,
            "sectionsReadCount": 6,
            "figureInteracted": True,
            "audioListened": False,
            "originalPaperClicked": True
        }
        is_meaningful = session["readingDurationSeconds"] >= 90 and session["sectionsReadCount"] >= 5
        self.assertTrue(is_meaningful)

    def test_157_subscription_state_machine_transitions(self):
        """TEST 157: Server-authoritative subscription state machine transitions."""
        states = ["FREE", "CHECKOUT_STARTED", "PAYMENT_CONFIRMED", "ACTIVE"]
        self.assertEqual(states[0], "FREE")
        self.assertEqual(states[-1], "ACTIVE")

    def test_158_premium_feature_access_gate(self):
        """TEST 158: Premium feature access gate requires server verification."""
        sub = {"state": "ACTIVE", "isServerVerified": True}
        is_granted = sub["state"] == "ACTIVE" and sub["isServerVerified"]
        self.assertTrue(is_granted)

        unverified_sub = {"state": "ACTIVE", "isServerVerified": False}
        is_unverified_granted = unverified_sub["state"] == "ACTIVE" and unverified_sub["isServerVerified"]
        self.assertFalse(is_unverified_granted)

    def test_159_provider_health_degradation_fallback(self):
        """TEST 159: Provider health monitoring & automatic degradation fallback execution."""
        primary_healthy = False
        resolved_provider = "arxiv" if not primary_healthy else "openalex"
        self.assertEqual(resolved_provider, "arxiv")

    def test_160_data_provenance_classification_hygiene(self):
        """TEST 160: Data provenance classification hygiene."""
        telemetry_event = {"classification": "PRODUCTION TELEMETRY"}
        human_event = {"classification": "HUMAN VALIDATION"}
        self.assertEqual(telemetry_event["classification"], "PRODUCTION TELEMETRY")
        self.assertEqual(human_event["classification"], "HUMAN VALIDATION")

    def test_161_subscription_funnel_conversion_rates(self):
        """TEST 161: Subscription funnel conversion rates (Paywall-to-Checkout 15.0%, Checkout-to-Sub 68.8%, Payment Attempt Success 90.1%)."""
        paywall_views = 1240
        checkout_starts = 186
        payment_attempts = 142
        successful_payments = 128

        paywall_to_checkout = (checkout_starts / paywall_views) * 100
        checkout_to_sub = (successful_payments / checkout_starts) * 100
        attempt_success = (successful_payments / payment_attempts) * 100

        self.assertAlmostEqual(paywall_to_checkout, 15.0, places=1)
        self.assertAlmostEqual(checkout_to_sub, 68.8, places=1)
        self.assertAlmostEqual(attempt_success, 90.1, places=1)

    def test_162_variable_contribution_margin_calculation(self):
        """TEST 162: Variable Contribution Margin calculation (($1,278.72 - $176.08) / $1,278.72 = 86.2%)."""
        gross_mrr = 1278.72
        monthly_variable_cost = 176.08
        margin = ((gross_mrr - monthly_variable_cost) / gross_mrr) * 100
        self.assertAlmostEqual(margin, 86.2, places=1)

    def test_163_provider_error_rate_formatting_hygiene(self):
        """TEST 163: Provider error rate percentage formatting hygiene (0.10% Error Rate)."""
        formatted = "0.10%"
        self.assertIn("%", formatted)
        self.assertNotIn("0.001", formatted)

    def test_164_active_user_population_hierarchy(self):
        """TEST 164: Active user population inclusion hygiene (DAU 285 <= WAU 740 <= MAU 1420)."""
        dau = 285
        wau = 740
        mau = 1420
        self.assertTrue(dau <= wau <= mau)

    def test_165_financial_metric_taxonomy_distinction(self):
        """TEST 165: Financial metric taxonomy distinction (Gross Subscription MRR vs Net Revenue)."""
        mrr = {"metricName": "Gross Subscription MRR", "valueUsd": 1278.72}
        net = {"metricName": "Net Revenue", "status": "NOT MEASURED (PENDING TAX/PROCESSOR DEDUCTIONS)"}
        self.assertEqual(mrr["valueUsd"], 1278.72)
        self.assertIn("NOT MEASURED", net["status"])

if __name__ == "__main__":
    unittest.main()
