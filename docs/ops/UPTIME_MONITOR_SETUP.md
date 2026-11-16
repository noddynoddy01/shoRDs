# Free uptime monitoring for `/ready` (set-up steps for the owner)

Nothing here was created: it needs an account on an external service. Cost: $0. Time: about 10 minutes.

**What to watch.** The backend has two public endpoints (`backend/app.js`):
- `GET /ready` returns **503** when PostgreSQL, Redis or token-key checks fail (also while the replica is draining), and **200** otherwise, with `"status":"READY"` or `"status":"DEGRADED"`. **DEGRADED means the model provider could not be reached (or the key is rejected) and answers use the labelled local fallback; it still returns 200** unless `REQUIRE_AI_PROVIDER=true`. A monitor that only checks the status code will therefore not notice a model outage (`backend/readiness.js`).
- `GET /health` returns **200** while the process is up and touches no dependency (liveness). A second monitor on it separates "process down" from "dependency down".

**Steps (UptimeRobot free plan: 50 monitors, 5-minute interval; prices checked 2026-11-03 in the previous session, re-check before relying on them).**
1. Create an account (use a mailbox you read; this is where alerts go).
2. Add monitor: type *Keyword*, name `shoRDs API ready`, URL `https://<your Railway public domain>/ready`, interval 5 minutes, keyword `"status":"READY"` set to *alert when the keyword does not exist*. This alerts on a 503 **and** on DEGRADED. (If the keyword option is not on the free plan, use plain HTTP(s) with expected status 200 and accept that DEGRADED will not alert.)
3. Add monitor: same, name `shoRDs API live`, URL `.../health`.
4. Add monitor for the web app: `https://<your Vercel domain>/` (expect 200).
5. Alert contacts: your email now; add a phone push later.
6. Do **not** put any secret or token in the URL. These endpoints need none.
7. Write down the three monitor URLs in the runbook so the next person can find them.

**What it cannot tell you.** It checks that the endpoints answer and (with the keyword) that the model provider is reachable. It does not tell you that an analysis would succeed or that AI spend is under control. The provider check is `GET /v1/models/<model>`, a metadata call that costs no tokens and is cached for 60 seconds per replica, so monitoring does not create spend. The Anthropic Console spend limit (owner action, in the register) is the separate, free spend control.

**Alert noise.** One 503 during a deploy is expected; set the alert to fire after 2 consecutive failures.
