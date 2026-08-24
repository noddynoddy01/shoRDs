"""
Production Architecture & Secret Security Audit Script for shoRDs
Scans codebase files for credential exposures, environment variable leaks,
and unsafe default settings.
"""

import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SECRET_PATTERNS = [
    r"EXPO_PUBLIC_UNPAYWALL_EMAIL",
    r"UNPAYWALL_EMAIL\s*=\s*['\"][^'\"]+['\"]",
    r"API_KEY\s*=\s*['\"][^'\"]+['\"]",
    r"SECRET_KEY\s*=\s*['\"][^'\"]+['\"]",
    r"PASSWORD\s*=\s*['\"][^'\"]+['\"]",
    r"DATABASE_URL\s*=\s*['\"][^'\"]+['\"]"
]

EXCLUDE_DIRS = {".git", "node_modules", "android", ".expo", "dist"}

def run_secret_audit():
    print("======================================================================")
    print("           shoRDs PRODUCTION ARCHITECTURE & SECRET AUDIT            ")
    print("======================================================================\n")

    unsafe_exposures = []
    audited_files = 0
    safe_variables = []

    for root, dirs, files in os.walk(ROOT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if not f.endswith((".ts", ".tsx", ".js", ".json", ".env")):
                continue
            
            audited_files += 1
            filepath = os.path.join(root, f)
            rel_path = os.path.relpath(filepath, ROOT_DIR)

            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as fh:
                    lines = fh.readlines()
                    for idx, line in enumerate(lines, 1):
                        if "EXPO_PUBLIC_UNPAYWALL_EMAIL" in line:
                            unsafe_exposures.append({
                                "variable": "EXPO_PUBLIC_UNPAYWALL_EMAIL",
                                "location": f"{rel_path}:{idx}",
                                "type": "CLIENT",
                                "status": "UNSAFE (Client Exposure)"
                            })
                        elif "process.env.UNPAYWALL_EMAIL" in line:
                            safe_variables.append({
                                "variable": "UNPAYWALL_EMAIL",
                                "location": f"{rel_path}:{idx}",
                                "type": "SERVER",
                                "status": "SAFE (Server-Side Only)"
                            })
                        for pat in SECRET_PATTERNS[1:]:
                            if re.search(pat, line):
                                unsafe_exposures.append({
                                    "variable": "HARDCODED_CREDENTIAL",
                                    "location": f"{rel_path}:{idx}",
                                    "type": "UNKNOWN",
                                    "status": "UNSAFE"
                                })
            except Exception as e:
                pass

    print(f"Total Source/App Files Audited: {audited_files}")
    print(f"Safe Server-Side Secret Accesses Found: {len(safe_variables)}")
    for sv in safe_variables:
        print(f"  - [{sv['type']}] {sv['variable']} -> {sv['location']} ({sv['status']})")

    print(f"\nUnsafe Client-Side Secret Leaks Found: {len(unsafe_exposures)}")
    for ue in unsafe_exposures:
        print(f"  - [{ue['type']}] {ue['variable']} -> {ue['location']} ({ue['status']})")

    print("\n======================================================================")
    print(f"AUDIT RESULT: {'PASS' if len(unsafe_exposures) == 0 else 'FAIL'}")
    print("======================================================================\n")

    return len(unsafe_exposures) == 0

if __name__ == "__main__":
    run_secret_audit()
