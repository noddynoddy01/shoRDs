"""
Live HTTP smoke checks for a RUNNING shoRDs backend (Phase 36, rewritten in Phase 6).

Usage:
    SHORDS_BASE_URL=http://127.0.0.1:4000  python backend/tests/verification/test_live_tcp_endpoints.py
    SHORDS_ID_TOKEN=<a real Firebase ID token>  ...   (optional; enables the authenticated checks)

What changed in Phase 6: the previous version printed "[PASS]" without checking anything, sent the fake token
"Bearer test_token_usr_A", relied on a hardcoded 'unauthorized_project_B' server hook, and printed a fixed
"0.0% error rate". The server now verifies real Firebase ID tokens, so none of that can work or be claimed.
This script asserts every check, measures real latencies and real error counts, never prints a result it did not
observe, and exits non-zero if any check fails. Checks that need credentials are reported SKIPPED, not passed.

The token is read from the environment only and is never printed or stored.
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("SHORDS_BASE_URL", "http://127.0.0.1:4000").rstrip("/")
TOKEN = os.environ.get("SHORDS_ID_TOKEN", "").strip()

results = []  # (name, status, detail)


def record(name, ok, detail=""):
    results.append((name, "PASS" if ok else "FAIL", detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" | {detail}" if detail else ""))


def skip(name, why):
    results.append((name, "SKIPPED", why))
    print(f"  [SKIPPED] {name} | {why}")


def request(method, path, body=None, token=None, headers=None):
    h = {"Content-Type": "application/json"}
    if token is not None:
        h["Authorization"] = token
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        status = e.code
    ms = (time.perf_counter() - t0) * 1000.0
    try:
        parsed = json.loads(raw) if raw else None
    except ValueError:
        parsed = None
    return status, parsed, ms


def percentile(sorted_values, q):
    return sorted_values[min(len(sorted_values) - 1, math.floor(len(sorted_values) * q))]


def main():
    print("=" * 70)
    print(f" shoRDs live HTTP verification against {BASE}")
    print(f" authenticated checks: {'ENABLED (SHORDS_ID_TOKEN set)' if TOKEN else 'DISABLED (no SHORDS_ID_TOKEN)'}")
    print("=" * 70)

    status, body, ms = request("GET", "/health")
    record("GET /health is 200 and liveness-only", status == 200 and body and body.get("status") == "UP", f"HTTP {status} {ms:.1f}ms")

    status, body, ms = request("GET", "/ready")
    ready_detail = f"HTTP {status} status={body.get('status') if body else None} {ms:.1f}ms"
    record("GET /ready answers with a real readiness document", status in (200, 503) and body is not None and "checks" in body, ready_detail)
    if body and "checks" in body:
        for name, check in body["checks"].items():
            print(f"        - {name}: {check.get('status')}")

    for label, token in (("no Authorization header", None), ("random string", "something"), ("bearer garbage", "Bearer not.a.token"), ("legacy fixture token", "Bearer test_token_usr_A")):
        status, body, ms = request("POST", "/api/v1/copilot/query", {"query": "q", "paperId": "p"}, token=token)
        record(f"POST /api/v1/copilot/query rejects {label}", status in (401, 503) and status != 200, f"HTTP {status}")

    status, body, ms = request("GET", "/", headers={"Origin": "https://evil.invalid"})
    record("a disallowed Origin is rejected", status == 403, f"HTTP {status}")

    if not TOKEN:
        skip("authenticated copilot query", "set SHORDS_ID_TOKEN to a real Firebase ID token")
        skip("project authorization (non-member gets 403)", "set SHORDS_ID_TOKEN")
        skip("latency benchmark", "set SHORDS_ID_TOKEN")
    else:
        bearer = f"Bearer {TOKEN}"
        status, body, ms = request("GET", "/api/v1/projects", token=bearer)
        record("valid token authenticates (GET /api/v1/projects)", status == 200, f"HTTP {status}")

        status, body, ms = request("POST", "/api/v1/copilot/query", {"query": "q", "paperId": "p", "projectId": "prj_does_not_exist_000"}, token=bearer)
        record("a project the caller is not a member of is refused", status == 403, f"HTTP {status}")

        status, body, ms = request("POST", "/api/v1/copilot/query", {"query": "What was measured?", "paperId": "p1"}, token=bearer)
        ok = status == 200 and body is not None and body.get("verificationStatus") in ("CONTENT_UNAVAILABLE", "FALLBACK", "UNVERIFIED")
        record("copilot with no paper text is honest (no fabricated answer, never VERIFIED)", ok, f"HTTP {status} verificationStatus={body.get('verificationStatus') if body else None}")

        latencies, errors = [], 0
        for _ in range(20):
            status, _, ms = request("GET", "/api/v1/projects", token=bearer)
            latencies.append(ms)
            if status != 200:
                errors += 1
        latencies.sort()
        print(f"  Benchmark (20 real GET /api/v1/projects): p50={percentile(latencies, .5):.1f}ms p95={percentile(latencies, .95):.1f}ms errors={errors}/20")
        record("benchmark had no errors", errors == 0, f"{errors}/20 errors")

    failed = [r for r in results if r[1] == "FAIL"]
    skipped = [r for r in results if r[1] == "SKIPPED"]
    print("-" * 70)
    print(f" {len(results) - len(failed) - len(skipped)} passed, {len(failed)} failed, {len(skipped)} skipped")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"Could not reach {BASE}: {e.reason}")
        sys.exit(2)
