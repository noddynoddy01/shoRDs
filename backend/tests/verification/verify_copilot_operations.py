"""
Copilot Operation Verification Suite for shoRDs Phase 42
Tests complete pipeline across ASK, EXPLAIN, COMPARE, FIND_GAP, FIND_CONTRADICTION, SYNTHESIS.
"""

import urllib.request
import json

operations = ["ASK", "EXPLAIN", "COMPARE", "FIND_GAP", "FIND_CONTRADICTION", "SYNTHESIS"]

def run_test():
    print("=== COPILOT PIPELINE OPERATION AUDIT ===")
    url = "http://127.0.0.1:4000/api/v1/copilot/query"
    headers = {
        "Authorization": "Bearer session_verified_token",
        "Content-Type": "application/json"
    }

    for op in operations:
        payload = json.dumps({
            "operation": op,
            "query": f"Analyze research methodologies for operation {op}",
            "projectId": "project_alpha"
        }).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") != "VERIFIED":
                raise AssertionError(f"Operation {op} failed status: {data.get('status')}")
            if not data.get("claims") or len(data["claims"]) == 0:
                raise AssertionError(f"Operation {op} returned 0 claims")
            print(f"  [PASS] Operation {op:<20} : HTTP {resp.status} | Claims: {len(data['claims'])} | Status: {data.get('status')}")

    print("======================================================")
    print("  FINAL: LOCAL_AI_PIPELINE=VERIFIED")
    print("======================================================")

if __name__ == "__main__":
    run_test()
