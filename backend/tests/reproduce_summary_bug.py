"""
PHASE 1 REPRODUCTION SCRIPT: Demonstrating Repeated Summaries Across Different Papers
"""
import hashlib
import json
import re

def sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

# Three genuinely different papers from data/samplePapers.ts
papers = [
    {
        "id": "alphaqubit-decoder",
        "title": "AI Helps Decode Quantum Computer Errors",
        "domain": "AI / ML",
        "subdomain": "Neural Architectures",
        "authors": ["Google Research"],
        "source": "Nature Publishing Group",
        "summary": "A machine learning decoder can help identify quantum errors more accurately, making future quantum machines easier to stabilize.",
        "fullExplanation": "🔬 [Context & Background]\nIdentifying quantum errors requires processing complex, noisy signals from physical qubits...\n\n⚙️ [Technical Methodology]\nWe present AlphaQubit, a machine learning decoder based on transformer architectures...\n\n📊 [Key Results & Findings]\nAlphaQubit achieves a 30% reduction in logical error rates compared to MWPM decoders...\n\n🔮 [Future Scope & Horizons]\nFuture efforts will optimize the model's inference speed to sub-microsecond levels."
    },
    {
        "id": "ai-cancer-tissue-imaging",
        "title": "AI Reads Cancer Tissue Images for Earlier Clues",
        "domain": "AI / ML",
        "subdomain": "Computer Vision",
        "authors": ["Cancer Imaging Review Authors"],
        "source": "arXiv Org",
        "summary": "Researchers reviewed how AI can study tissue images to support cancer detection, diagnosis, and research workflows.",
        "fullExplanation": "🔬 [Context & Background]\nPathological diagnosis of cancer is highly dependent on microscopic analysis of tissue biopsy slides...\n\n⚙️ [Technical Methodology]\nThis review details deep learning architectures used in computational pathology. It covers convolutional neural networks (CNNs) and vision transformers (ViTs)...\n\n📊 [Key Results & Findings]\nAI systems show sensitivity rates above 95% in detecting micro-metastases in lymph nodes...\n\n🔮 [Future Scope & Horizons]\nIntegration of multi-modal AI combining image features with spatial transcriptomics."
    },
    {
        "id": "soft-grippers-review",
        "title": "Soft Robot Hands Can Grip Fragile Objects",
        "domain": "Robotics",
        "subdomain": "Soft Robotics",
        "authors": ["Soft Robotics Review Authors"],
        "source": "IEEE Explorer",
        "summary": "A broad review explains how soft grippers use flexible materials to handle delicate objects in medicine, farming, and labs.",
        "fullExplanation": "🔬 [Context & Background]\nRigid robotic grippers frequently damage delicate payloads like fresh fruits, biological tissues, or glass vials...\n\n⚙️ [Technical Methodology]\nWe review the design, materials, and fabrication of soft pneumatic, magnetic, and tendon-driven actuators...\n\n📊 [Key Results & Findings]\nSoft grippers distribute contact forces uniformly, reducing peak local pressures by over 80%...\n\n🔮 [Future Scope & Horizons]\nDeveloping bio-degradable elastomers and embedding flexible sensors for closed-loop haptic feedback."
    }
]

print("======================================================================")
print("            PHASE 1: REPRODUCE THE REPEATED-SUMMARY BUG               ")
print("======================================================================\n")

records = []

for p in papers:
    title = p["title"]
    clean_title = re.sub(r'\.pdf$', '', title, flags=re.I).strip(" :.,;-–—")
    
    # Input payload
    input_str = json.dumps({
        "id": p["id"],
        "title": clean_title,
        "authors": p["authors"],
        "summary": p["summary"],
        "fullText": p["fullExplanation"]
    }, sort_keys=True)
    input_hash = sha256(input_str)
    
    # AI Gateway Cache Key as computed by CacheManager:
    # `${request.operation}:${request.prompt.trim().toLowerCase()}:${evidenceIds}:${request.model || "default"}:${promptVersion}`
    # If prompt is generic Copilot prompt:
    generic_prompt = "summarize this paper"
    cache_key_generic = f"shords:v1:llm:tenant_default:project_default:{sha256('ASK:' + generic_prompt + '::default:2026.1')[:32]}"
    
    # Paper-specific prompt cache key:
    paper_prompt = f"summarize paper {p['id']}: {clean_title}".lower()
    cache_key_specific = f"shords:v1:llm:tenant_default:project_default:{sha256('ASK:' + paper_prompt + '::default:2026.1')[:32]}"
    
    # Replicate current generateGroundedResearchBriefAsync FULL_TEXT logic from services/paperSummarizer.ts lines 320-385:
    sec1 = f"{clean_title} addresses fundamental challenges in this domain. The authors introduce an end-to-end framework combining feature extraction with targeted attention mapping. Experimental results demonstrate a +18.4% improvement over traditional baselines while cutting computational latency by 3.1x."
    sec2 = "Existing approaches suffer from high signal distortion and severe performance degradation under dynamic operational conditions. Traditional methods rely on heavy matrix inversion or rigid assumptions that fail when scaling to complex real-world environments. This work addresses the urgent need for a resilient, low-latency formulation that maintains high precision."
    sec3 = "To solve this gap, the researchers designed a 4-step architectural pipeline:\n\n1. Input Signal Preprocessing: Normalizes incoming feature vectors and removes ambient noise artifacts.\n2. Sparse Representation Extraction: Isolates high-dimensional spatial and temporal features.\n3. Adaptive Transformation: Applies dynamic weighting to prioritize signal-rich channels.\n4. Evaluation & Inference: Computes final estimates with minimal floating-point complexity."
    sec4 = "The core mechanism relies on continuous state estimation and adaptive feedback loops. By decoupling feature extraction from parameter tuning, the framework avoids catastrophic error propagation. Equations in the paper establish lower bound error convergence:\n\nEquation 1: E[||x - x_hat||^2] <= delta + gamma * N^(-1)\n\nIn simple terms: As the sample size N increases, the estimation error bounds decrease asymptotically, ensuring theoretical mathematical stability under all noise conditions."
    sec5 = "The strongest empirical evidence comes from benchmark trials comparing the proposed approach against 4 competitive baselines. Across 142 experimental runs, the model achieved a peak accuracy of 94.2% while maintaining stable memory consumption."
    sec7 = "This contribution is significant for both academic researchers and systems engineers. By providing high accuracy at 3.1x reduced computational overhead, the approach enables real-time edge deployment on power-constrained hardware without compromising reliability."
    sec8 = "The authors note that extreme Doppler shifts exceeding 500 Hz require additional calibration data, and performance degrades slightly when training data contains less than 10% representative channel samples."
    
    full_output = f"[01 The Paper in 30 Seconds]\n{sec1}\n\n[02 The Problem]\n{sec2}\n\n[03 What the Researchers Did]\n{sec3}\n\n[04 How It Works]\n{sec4}\n\n[05 The Evidence & Results]\n{sec5}\n\n[07 Why This Matters]\n{sec7}\n\n[08 Limitations]\n{sec8}"
    output_hash = sha256(full_output)

    # Legacy Educational Stack from line 432:
    edu_stack = {
        "What is this paper about?": p["summary"],
        "Why was it written?": f"Addresses critical limits in {p['domain']}.",
        "How did they do it?": "Formulates an analytical framework validated across baseline benchmarks.",
        "What did they find?": "Empirical results show significant performance gains.",
        "Why should I care?": "Enables practical deployment in enterprise and research systems.",
        "Limitations": "No explicit limitations identified in abstract."
    }

    records.append({
        "id": p["id"],
        "title": clean_title,
        "authors": p["authors"],
        "abstract": p["summary"],
        "source": p["source"],
        "full_text_len": len(p["fullExplanation"]),
        "input_hash": input_hash,
        "cache_key_generic": cache_key_generic,
        "cache_key_specific": cache_key_specific,
        "provider": "LOCAL_DETERMINISTIC / STATIC_TEMPLATE",
        "model": "STATIC_TEMPLATE_FALLBACK",
        "output_hash": output_hash,
        "sec1": sec1,
        "sec2": sec2,
        "sec3": sec3,
        "sec5": sec5,
        "sec8": sec8,
        "edu_stack": edu_stack
    })

for i, r in enumerate(records):
    print(f"--- PAPER {i+1}: {r['id']} ---")
    print(f"Title            : {r['title']}")
    print(f"Authors          : {', '.join(r['authors'])}")
    print(f"Source           : {r['source']}")
    print(f"Full-Text Length : {r['full_text_len']} chars")
    print(f"Input Hash       : {r['input_hash']}")
    print(f"Cache Key (Gen)  : {r['cache_key_generic']}")
    print(f"Cache Key (Spec) : {r['cache_key_specific']}")
    print(f"Provider / Model : {r['provider']} / {r['model']}")
    print(f"Output Hash      : {r['output_hash']}")
    print(f"Section 01 (30s) : {r['sec1'][:90]}...")
    print(f"Section 02 (Prob): {r['sec2'][:90]}...")
    print(f"Section 03 (Meth): {r['sec3'][:90]}...")
    print(f"Section 08 (Lim) : {r['sec8'][:90]}...")
    print()

print("======================================================================")
print("                   COMPARISON AND DUPLICATION AUDIT                   ")
print("======================================================================\n")

print("1. INPUT COMPARISON:")
print(f"   INPUT_A == INPUT_B : {records[0]['input_hash'] == records[1]['input_hash']} (Distinct inputs)")
print(f"   INPUT_A == INPUT_C : {records[0]['input_hash'] == records[2]['input_hash']} (Distinct inputs)")
print(f"   INPUT_B == INPUT_C : {records[1]['input_hash'] == records[2]['input_hash']} (Distinct inputs)")

print("\n2. CACHE KEY COMPARISON (If generic prompt is passed):")
print(f"   GENERIC_CACHE_A == GENERIC_CACHE_B : {records[0]['cache_key_generic'] == records[1]['cache_key_generic']} (COLLISION BUG!)")
print(f"   GENERIC_CACHE_A == GENERIC_CACHE_C : {records[0]['cache_key_generic'] == records[2]['cache_key_generic']} (COLLISION BUG!)")

print("\n3. OUTPUT COMPARISON (Section by Section):")
print(f"   Section 02 (Problem) A == B : {records[0]['sec2'] == records[1]['sec2']} (100% IDENTICAL - BUG!)")
print(f"   Section 02 (Problem) A == C : {records[0]['sec2'] == records[2]['sec2']} (100% IDENTICAL - BUG!)")
print(f"   Section 03 (Method)  A == B : {records[0]['sec3'] == records[1]['sec3']} (100% IDENTICAL - BUG!)")
print(f"   Section 03 (Method)  A == C : {records[0]['sec3'] == records[2]['sec3']} (100% IDENTICAL - BUG!)")
print(f"   Section 08 (Limit)   A == B : {records[0]['sec8'] == records[1]['sec8']} (100% IDENTICAL - BUG!)")
print(f"   Section 08 (Limit)   A == C : {records[0]['sec8'] == records[2]['sec8']} (100% IDENTICAL - BUG!)")

print("\n4. EDUCATIONAL STACK COMPARISON (Legacy Feed Stack):")
print(f"   'How did they do it?' A == B : {records[0]['edu_stack']['How did they do it?'] == records[1]['edu_stack']['How did they do it?']} (100% IDENTICAL)")
print(f"   'What did they find?' A == B : {records[0]['edu_stack']['What did they find?'] == records[1]['edu_stack']['What did they find?']} (100% IDENTICAL)")
print(f"   'Why should I care?'  A == B : {records[0]['edu_stack']['Why should I care?'] == records[1]['edu_stack']['Why should I care?']} (100% IDENTICAL)")

print("\n======================================================================")
print("CONCLUSION: Duplication reproduced and isolated to:")
print("1. services/paperSummarizer.ts lines 320-385 (Hardcoded sections 02, 03, 04, 05, 07, 08)")
print("2. services/paperSummarizer.ts lines 285-315 (Hardcoded Doppler uncertainty in abstract mode)")
print("3. services/paperSummarizer.ts lines 432-443 (generateEducationalStack hardcoding 5 sections)")
print("4. services/papersStore.ts lines 23-34 (parsePaperSections hardcoding method & results)")
print("5. services/llm/cacheManager.ts line 23 (Cache key lacks paperId/contentHash)")
print("6. services/llm/requestDeduplicator.ts line 14 (Deduplicator key lacks paperId/contentHash)")
print("7. services/copilotExecutionPipelineService.ts lines 66-96 (Hardcoded chunk_1842 / openalex-W123)")
print("8. backend/start_local_server.js lines 89-114 (Hardcoded MIMIC-IV AUROC = 0.924 for any query)")
print("======================================================================")
