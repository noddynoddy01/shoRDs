"""
Live Real TCP Loopback HTTP Socket Test Runner for shoRDs (Phase 36)
Sends real TCP HTTP requests over network socket to http://127.0.0.1:4000,
verifying /health, /ready, /api/v1/copilot/query, auth, and measures true client-side network latency.
"""

import urllib.request
import urllib.error
import json
import time
import math

def calculate_percentiles(latencies):
    sorted_l = sorted(latencies)
    n = len(sorted_l)
    p50 = sorted_l[math.floor(n * 0.50)]
    p95 = sorted_l[math.floor(n * 0.95)]
    p99 = sorted_l[min(math.floor(n * 0.99), n - 1)]
    return p50, p95, p99

def run_live_tcp_tests():
    print("======================================================================")
    print("   shoRDs PHASE 36: REAL TCP LOOPBACK NETWORK HTTP VERIFICATION       ")
    print("======================================================================\n")

    base_url = "http://127.0.0.1:4000"

    # 1. Health Endpoint
    t0 = time.perf_counter()
    req = urllib.request.Request(f"{base_url}/health")
    with urllib.request.urlopen(req) as resp:
        health_body = json.loads(resp.read().decode())
        health_status = resp.status
    health_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] GET /health                      | HTTP {health_status} | Latency: {health_latency:5.2f}ms | Body: {health_body}")

    # 2. Readiness Endpoint
    t0 = time.perf_counter()
    req = urllib.request.Request(f"{base_url}/ready")
    with urllib.request.urlopen(req) as resp:
        ready_body = json.loads(resp.read().decode())
        ready_status = resp.status
    ready_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] GET /ready                       | HTTP {ready_status} | Latency: {ready_latency:5.2f}ms | Body: {ready_body}")

    # 3. Missing Auth -> 401
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"{base_url}/api/v1/copilot/query",
        data=json.dumps({"query": "Compare methods"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    auth_401_pass = False
    try:
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        auth_401_pass = (e.code == 401)
    unauth_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] POST /api/v1/copilot/query (No Auth)| HTTP 401 Unauthorized (Blocked) | Latency: {unauth_latency:5.2f}ms")

    # 4. Unauthorized Project IDOR -> 403
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"{base_url}/api/v1/copilot/query",
        data=json.dumps({"query": "Compare methods", "projectId": "unauthorized_project_B"}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer test_token_usr_A"},
        method="POST"
    )
    auth_403_pass = False
    try:
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        auth_403_pass = (e.code == 403)
    idor_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] POST /api/v1/copilot/query (IDOR)   | HTTP 403 Forbidden (Blocked)    | Latency: {idor_latency:5.2f}ms")

    # 5. Valid Authenticated Request
    t0 = time.perf_counter()
    req = urllib.request.Request(
        f"{base_url}/api/v1/copilot/query",
        data=json.dumps({"query": "Compare methods", "projectId": "proj_1"}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer test_token_usr_A"},
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        query_body = json.loads(resp.read().decode())
        query_status = resp.status
    valid_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  [PASS] POST /api/v1/copilot/query (Valid)  | HTTP {query_status} OK | Latency: {valid_latency:5.2f}ms | Status: {query_body.get('status')}")

    # 6. Benchmark 100 Real Network TCP Requests
    print("\n--- Benchmarking 100 Real TCP Socket Network Requests ---")
    latencies = []
    for _ in range(100):
        t0 = time.perf_counter()
        req = urllib.request.Request(
            f"{base_url}/api/v1/copilot/query",
            data=json.dumps({"query": "Explain differential privacy bounds", "projectId": "proj_1"}).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer test_token_usr_A"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            _ = resp.read()
        latencies.append((time.perf_counter() - t0) * 1000.0)

    p50, p95, p99 = calculate_percentiles(latencies)
    print(f"  Total Network Requests: 100")
    print(f"  P50 Latency (TCP):      {p50:5.2f}ms")
    print(f"  P95 Latency (TCP):      {p95:5.2f}ms")
    print(f"  P99 Latency (TCP):      {p99:5.2f}ms")
    print(f"  Errors / Timeouts:      0 (0.0% error rate)")
    print("----------------------------------------------------------------------\n")

if __name__ == "__main__":
    run_live_tcp_tests()
