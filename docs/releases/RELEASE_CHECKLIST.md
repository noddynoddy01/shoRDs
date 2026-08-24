# shoRDs Release Candidate Checklist

- [x] Phase 1 Canonical Identity & Eligibility Gating tests pass (15/15)
- [x] Phase 2 Production Feed Engine & Cursor tests pass (11/11)
- [x] Phase 3 Grounded Intelligence & Claim Verification tests pass (25/25)
- [x] Phase 6 Security & Hardening tests pass (15/15)
- [x] Phase 6 Reliability & Circuit Breaker tests pass (12/12)
- [x] Full unified 78-test regression suite passes (78/78 OK)
- [x] TypeScript compilation `npx tsc --noEmit` passes with 0 errors
- [x] Secret audit passes (0 client-side credential exposures)
- [x] Unpaywall email (`UNPAYWALL_EMAIL`) server-side isolated
- [x] Fake AI verification badges (`AI VERIFIED ★★★★★`) completely removed
- [x] Zero unsupported claims or generic fallback phrases reach UI
- [x] 30-Second Understanding Top Card & Collapsible Source Metadata drawer verified
- [x] Interactive Evidence Inspector drawer verified
- [x] SSRF URL protection & input validation active
- [x] Health (`GET /health`) and Readiness (`GET /ready`) endpoints operational
- [x] Provider fallback and circuit breaker active
- [x] Memory & telemetry audit verified
- [x] **APK Build Status: SKIPPED (Per explicit directive)**
