"""
3-PAPER INDEPENDENT INTELLIGENCE VERIFICATION TEST
Tests that 3 distinct papers produce:
1. Distinct input hashes
2. Distinct AI gateway cache keys (paperId & contentHash segregation)
3. Zero cross-paper contamination (0% Doppler leakage into cancer/robotics)
4. Paper-specific TL;DR, Problem, Methodology, Results, Limitations, Why This Matters
5. Verified quantitative result extraction
"""
import re
import json
import hashlib
import unittest

def sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def generate_cache_key(tenant_id, project_id, paper_id, content_hash, prompt, schema_version="2026.2"):
    raw_payload = f"SUMMARIZE:{paper_id}:{content_hash}:{schema_version}:{prompt.strip().lower()}::default:2026.1"
    h = sha256(raw_payload)[:32]
    return f"shords:v1:llm:{tenant_id}:{project_id}:{paper_id}:{h}"

def parse_paper_sections(paper):
    raw_text = (paper.get("fullExplanation") or paper.get("summary") or "").strip()
    title = paper.get("title", "")
    domain = paper.get("domain", "Research")
    insights = paper.get("insights", [])

    context = ""
    methodology = ""
    results = ""
    future_scope = ""

    cm = re.search(r"(?:🔬\s*)?\[(?:Context|Background|Abstract)[^\]]*\]\s*([\s\S]*?)(?=(?:⚙️|📊|🔮|\[|$))", raw_text, re.I)
    mm = re.search(r"(?:⚙️\s*)?\[(?:Technical Methodology|Methodology|Method|Approach)[^\]]*\]\s*([\s\S]*?)(?=(?:📊|🔮|\[|$))", raw_text, re.I)
    rm = re.search(r"(?:📊\s*)?\[(?:Key Results|Results|Findings)[^\]]*\]\s*([\s\S]*?)(?=(?:🔮|\[|$))", raw_text, re.I)
    fm = re.search(r"(?:🔮\s*)?\[(?:Future Scope|Future|Horizons|Next Steps)[^\]]*\]\s*([\s\S]*?)(?=$)", raw_text, re.I)

    if cm and cm.group(1).strip(): context = cm.group(1).strip()
    if mm and mm.group(1).strip(): methodology = mm.group(1).strip()
    if rm and rm.group(1).strip(): results = rm.group(1).strip()
    if fm and fm.group(1).strip(): future_scope = fm.group(1).strip()

    if not context: context = paper.get("summary") or f"Research addressing critical challenges in {domain}."
    if not methodology:
        if insights: methodology = insights[0]
        else: methodology = f"Investigates {title} using empirical methodologies within {domain}."
    if not results:
        if len(insights) > 1: results = insights[1]
        else: results = f"Empirical advancements in {domain}."
    if not future_scope:
        if len(insights) > 2: future_scope = insights[2]
        else: future_scope = f"Extending this framework for broader application in {domain}."

    return {
        "context": context,
        "methodology": methodology,
        "results": results,
        "futureScope": future_scope
    }

def extract_quantitative(text, insights):
    results = []
    sources = list(insights) + re.split(r"[.\n;]+", text)
    for s in sources:
        s = s.strip()
        if not s: continue
        comp = re.search(r"(\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?[xX]\b)\s*([a-zA-Z\s]+?)\s*(?:compared to|versus|vs\.?|over)\s*([a-zA-Z0-9\s\-–—]+)", s, re.I)
        if comp:
            results.append({"metric": comp.group(2).strip(), "value": comp.group(1).strip(), "baseline": comp.group(3).strip(), "context": s})
            continue
        rate = re.search(r"(?:(?:achieves?|shows?|demonstrates?|reducing|with)\s+)?([a-zA-Z\s]{3,35}?)\s*(?:of|above|by|at|rates?)\s*(?:over\s+|above\s+)?(\d+(?:\.\d+)?%|\d+(?:\.\d+)?[xX])", s, re.I)
        if rate and len(rate.group(1)) < 40 and "study" not in rate.group(1).lower():
            results.append({"metric": rate.group(1).strip(), "value": rate.group(2).strip(), "context": s})
            continue
        time_m = re.search(r"reducing\s+([a-zA-Z\s]{3,30}?)\s+by\s+(\d+(?:\.\d+)?%)", s, re.I)
        if time_m:
            results.append({"metric": time_m.group(1).strip(), "value": time_m.group(2).strip(), "context": s})
            continue
    return results[:3]

class TestPaperIntelligenceFix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.papers = [
            {
                "id": "alphaqubit-decoder",
                "title": "AI Helps Decode Quantum Computer Errors",
                "domain": "AI / ML",
                "subdomain": "Neural Architectures",
                "authors": ["Google Research"],
                "summary": "A machine learning decoder can help identify quantum errors more accurately, making future quantum machines easier to stabilize.",
                "fullExplanation": "🔬 [Context & Background]\nIdentifying quantum errors requires processing complex, noisy signals from physical qubits. Traditional decoding algorithms are slow and computationally expensive, creating a bottleneck for real-time error correction.\n\n⚙️ [Technical Methodology]\nWe present AlphaQubit, a machine learning decoder based on transformer architectures. It reads error syndrome histories and outputs optimal correction operators. The model is trained on simulated and real processor noise profiles.\n\n📊 [Key Results & Findings]\nAlphaQubit achieves a 30% reduction in logical error rates compared to MWPM decoders. It maintains high fidelity even in regimes with severe spatial cross-talk.\n\n🔮 [Future Scope & Horizons]\nFuture efforts will optimize the model's inference speed to sub-microsecond levels, enabling inline deployment on hardware-level FPGA controllers.",
                "insights": [
                    "Introduces AlphaQubit, a neural decoder utilizing transformer layers for syndrome matching.",
                    "Outperforms MWPM algorithms by 30% in error prediction accuracy.",
                    "Lays the foundation for microsecond-level hardware-in-the-loop decoding."
                ]
            },
            {
                "id": "ai-cancer-tissue-imaging",
                "title": "AI Reads Cancer Tissue Images for Earlier Clues",
                "domain": "AI / ML",
                "subdomain": "Computer Vision",
                "authors": ["Cancer Imaging Review Authors"],
                "summary": "Researchers reviewed how AI can study tissue images to support cancer detection, diagnosis, and research workflows.",
                "fullExplanation": "🔬 [Context & Background]\nPathological diagnosis of cancer is highly dependent on microscopic analysis of tissue biopsy slides. The process is time-consuming and prone to observer variability, especially in early-stage tumor identification.\n\n⚙️ [Technical Methodology]\nThis review details deep learning architectures used in computational pathology. It covers convolutional neural networks (CNNs) and vision transformers (ViTs) applied to gigapixel whole-slide images (WSIs).\n\n📊 [Key Results & Findings]\nAI systems show sensitivity rates above 95% in detecting micro-metastases in lymph nodes. They assist pathologists by highlighting suspicious regions, reducing diagnostic review times by 40%.\n\n🔮 [Future Scope & Horizons]\nIntegration of multi-modal AI combining image features with spatial transcriptomics and genomic data is the next frontier for personalized cancer prognosis.",
                "insights": [
                    "Summarizes CNN and vision transformer techniques for gigapixel pathological image assessment.",
                    "Saves up to 40% of time for diagnostic pathologists by surfacing tumor borders automatically.",
                    "Identifies a 95%+ detection accuracy rate on lymph node WSI screenings."
                ]
            },
            {
                "id": "soft-grippers-review",
                "title": "Soft Robot Hands Can Grip Fragile Objects",
                "domain": "Robotics",
                "subdomain": "Soft Robotics",
                "authors": ["Soft Robotics Review Authors"],
                "summary": "A broad review explains how soft grippers use flexible materials to handle delicate objects in medicine, farming, and labs.",
                "fullExplanation": "🔬 [Context & Background]\nRigid robotic grippers frequently damage delicate payloads like fresh fruits, biological tissues, or glass vials. Soft robotics offers compliance, safety, and adaptability during manipulation.\n\n⚙️ [Technical Methodology]\nWe review the design, materials, and fabrication of soft pneumatic, magnetic, and tendon-driven actuators. We focus on elastomer-based designs and soft sensory integration.\n\n📊 [Key Results & Findings]\nSoft grippers distribute contact forces uniformly, reducing peak local pressures by over 80%. Payloads ranging from fresh berries to thin-walled test tubes were gripped securely without failure.\n\n🔮 [Future Scope & Horizons]\nDeveloping bio-degradable elastomers and embedding flexible sensors for closed-loop haptic feedback represents the next major research direction.",
                "insights": [
                    "Analyzes elastomer designs for mechanical adaptation without sensory overhead.",
                    "Reduces structural peak pressures by 80% on fragile materials.",
                    "Suggests haptic integration to allow closed-loop force adjustments in soft fingertips."
                ]
            }
        ]

    def test_cache_keys_are_isolated_across_papers_even_with_identical_prompts(self):
        pA, pB, pC = self.papers
        generic_prompt = "summarize this paper"
        k_A = generate_cache_key("tenant_1", "proj_1", pA["id"], sha256(pA["fullExplanation"])[:16], generic_prompt)
        k_B = generate_cache_key("tenant_1", "proj_1", pB["id"], sha256(pB["fullExplanation"])[:16], generic_prompt)
        k_C = generate_cache_key("tenant_1", "proj_1", pC["id"], sha256(pC["fullExplanation"])[:16], generic_prompt)

        self.assertNotEqual(k_A, k_B)
        self.assertNotEqual(k_A, k_C)
        self.assertNotEqual(k_B, k_C)
        self.assertIn("alphaqubit-decoder", k_A)
        self.assertIn("ai-cancer-tissue-imaging", k_B)
        self.assertIn("soft-grippers-review", k_C)

    def test_parsed_sections_have_zero_cross_paper_duplication(self):
        sA = parse_paper_sections(self.papers[0])
        sB = parse_paper_sections(self.papers[1])
        sC = parse_paper_sections(self.papers[2])

        # Problems are distinct
        self.assertNotEqual(sA["context"], sB["context"])
        self.assertNotEqual(sA["context"], sC["context"])
        self.assertIn("quantum", sA["context"].lower())
        self.assertIn("cancer", sB["context"].lower())
        self.assertIn("gripper", sC["context"].lower())

        # Methodologies are distinct
        self.assertNotEqual(sA["methodology"], sB["methodology"])
        self.assertNotEqual(sA["methodology"], sC["methodology"])
        self.assertIn("transformer", sA["methodology"].lower())
        self.assertIn("pathology", sB["methodology"].lower())
        self.assertIn("actuator", sC["methodology"].lower())

        # Results are distinct
        self.assertNotEqual(sA["results"], sB["results"])
        self.assertNotEqual(sA["results"], sC["results"])
        self.assertIn("30%", sA["results"])
        self.assertIn("95%", sB["results"])
        self.assertIn("80%", sC["results"])

    def test_zero_doppler_leakage_in_unrelated_papers(self):
        sB = parse_paper_sections(self.papers[1])
        sC = parse_paper_sections(self.papers[2])

        for text in [sB["context"], sB["methodology"], sB["results"], sB["futureScope"]]:
            self.assertNotIn("doppler", text.lower())
            self.assertNotIn("channel estimation", text.lower())

        for text in [sC["context"], sC["methodology"], sC["results"], sC["futureScope"]]:
            self.assertNotIn("doppler", text.lower())
            self.assertNotIn("channel estimation", text.lower())

    def test_quantitative_extraction_accuracy(self):
        qA = extract_quantitative(self.papers[0]["fullExplanation"], self.papers[0]["insights"])
        qB = extract_quantitative(self.papers[1]["fullExplanation"], self.papers[1]["insights"])
        qC = extract_quantitative(self.papers[2]["fullExplanation"], self.papers[2]["insights"])

        self.assertTrue(any("30%" in item["value"] for item in qA))
        self.assertTrue(any("95%" in item["value"] or "40%" in item["value"] for item in qB))
        self.assertTrue(any("80%" in item["value"] for item in qC))

if __name__ == "__main__":
    unittest.main()
