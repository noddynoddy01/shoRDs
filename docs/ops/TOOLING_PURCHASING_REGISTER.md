# shoRDs tooling and infrastructure audit, with purchasing register

Prepared 2026-11-03. **Nothing was purchased, started, upgraded or signed up for.** Prices were read from the vendors' own pages on 2026-11-03 (sources per row). A page text can be extracted imperfectly; before paying, re-read the live page. Prices exclude tax. "Not shown" means the page did not state it.

## 1. What shoRDs actually uses (from the project's own records)

| Service | Evidence | Plan today |
|---|---|---|
| Railway (backend, Postgres, Redis) | deploy handoff and production verification docs, `railway.json` | **Unknown.** On 2026-10-04 the project recorded a trial credit of about $4.85 with 25 days left. That runway has probably ended; the owner must read the Railway dashboard |
| Vercel (web frontend) | same docs; three sibling projects (`sho-r-ds*`) exist, one failed, one pending | Unknown (Hobby is the likely free plan) |
| Firebase Authentication | `services/firebase.ts`, `FIREBASE_PROJECT_ID` | Unknown (no-cost plan is likely) |
| Anthropic API (`claude-sonnet-5-5`) | `backend/llm/anthropicClient.js`, `ANTHROPIC_API_KEY` | Pay per token |
| GitHub (`noddynoddy01/shoRDs`) | handoff doc | Unknown; whether the repo is private matters for Actions minutes |

Not used: Sentry, PostHog, Figma, any uptime monitor, any LLM evaluation platform, any database monitoring beyond what Railway shows. (The app has a local `analyticsService.ts`; whether it sends events anywhere was not examined here.)

## 2. Current bottlenecks, in order

1. **Railway runway.** If the trial credit is spent, the production API and databases stop. This is the one item that may need money soon. Smallest tier: Hobby.
2. **No external alert when production is down** (restart policy gives up after 3 failures; `/ready` is honest but nobody watches it). A free monitor solves this.
3. **No error tracking.** The backend logs to stdout only; browser errors in the Vercel app are invisible.
4. **No measured quality signal** for summaries: addressed by the offline evaluation tooling and the human benchmark protocol, at no cost.
5. **Anthropic spend**: controlled in code (spend gate) once `p0-fixes` is merged; the Console-side spend limit is a free setting that only the owner can set.

## 3. Purchasing register

Priority: P0 do now if the condition holds; P1 soon, free; P2 when a trigger occurs; P3 not recommended yet.

| Tool or subscription | Purpose | Recommended plan | Current verified price | Monthly / annual cost | Why shoRDs needs it | Free alternative | Expected benefit | Priority | Purchase required now? |
|---|---|---|---|---|---|---|---|---|---|
| **Railway** | Hosts backend, Postgres, Redis | **Hobby** (smallest paid tier) | Hobby $5/month with $5 of usage included; Pro $20/month; usage above credit: $20 per vCPU-month, $10 per GB RAM-month, $0.05 per GB egress, $0.15 per GB-month volume. Trial: one-time $5 grant. Free: $1 credit/month, 0.5 GB RAM, 0.5 GB volume | $5 / $60 plus any usage over $5 (not estimated: real usage not visible to me) | The production API, job worker and databases run here | Free plan ($1/month) is too small for API + Postgres + Redis; self-hosting elsewhere is more work, not less | Production stays up; Postgres volume allows more than 0.5 GB | **P0 conditional** | **Only if the trial/credit is exhausted or expires.** Owner checks the dashboard first. Source: docs.railway.com/pricing/plans |
| **Anthropic API** (`claude-sonnet-5-5`) | The model behind analysis and copilot | Pay-as-you-go; no subscription | Sonnet 5.5 $2 / $10 per million input / output tokens (matches the code's price table: **check closed**). Haiku 4.5 $1 / $5. Opus 5.5 $4 / $20. Batch API 50% off. Cache reads $0.10 per million for Sonnet 5.5 | Metered. Gate defaults cap global spend at the configured daily and monthly limits | Core feature | None for this task; Haiku 4.5 is cheaper where quality allows (not measured) | Use Batch for offline evaluation runs (half price); caching for repeated prompts | **P1: set the Console spend limit (free)** | No new purchase. Source: platform.claude.com/docs/en/about-claude/pricing |
| **Vercel** | Hosts the web frontend | Stay on **Hobby** until revenue or a team | Hobby free, **non-commercial personal use only**; Pro $20/month platform fee (one deploying seat, $20 usage credit), extra seats $20/month, viewers free | $0 now; Pro $20 / $240 | Frontend hosting. Hobby's terms exclude commercial use, so charging users (the app has a paywall screen) requires Pro | GitHub Pages / Cloudflare Pages (migration effort; not assessed here) | Commercial-use compliance, 6,000 deploys/day, longer logs | **P2**, trigger: first paying user or a second deployer | No. Source: vercel.com/docs/plans/hobby, /pro-plan |
| **GitHub Actions** | CI for tests (`ci.yml`, drafted, not active) | Free plan | Free: 2,000 Actions minutes/month, 500 MB packages; Team $4/user/month: 3,000 minutes, 2 GB. Standard runners are free for public repositories | $0 / $0 | Would have caught the pipe-masking and skipped-test issues | None needed | Merge gate for the spend and idempotency tests | **P1, free** | No. The workflow's real minute use is unmeasured because it has never run; two backend jobs plus one frontend job per push is the shape to watch. Sources: github.com/pricing; docs.github.com |
| **Firebase Authentication** | Sign-in | No-cost plan | Free up to 50,000 monthly active users (Spark and Blaze); beyond that $0.0055 per MAU (50k to 100k band) under Identity Platform pricing; phone/MFA billed per SMS (first 10 SMS/day unbilled) | $0 | Already integrated | None needed | Nothing to buy until 50k users | P3 | No. Sources: firebase.google.com/pricing; cloud.google.com/identity-platform/pricing |
| **Uptime monitor** (UptimeRobot) | Alert when `/ready` fails | **Free** | Free: 50 monitors, 5-minute interval; paid from about €10/month (10 monitors, EUR geo price). Commercial-use limits were not shown on the page | $0 / $0 | Restart policy gives up after 3 crashes; nobody is told | Sentry's free plan includes 1 uptime monitor; a GitHub Actions cron hitting `/ready` | Notice an outage in minutes instead of when a user complains | **P1, free** (owner creates the account; I may not) | No. Source: uptimerobot.com/pricing.md |
| **Sentry** | Error tracking (browser and server) | **Developer (free)** first; Team only if the 5k errors/month limit is hit | Developer free: 1 user, 5k errors, 50 replays, 1 uptime monitor, 5M spans. Team $29/month ($26/month annual): 50k errors, unlimited users. Education: free for students, teachers and university researchers (50k errors, unlimited members, 1 year) | $0 now; Team $26-29 / $312-348 | Production errors are currently invisible | Structured JSON logs plus Railway's log view; GlitchTip (self-hosted) | Stack traces from real devices | **P2**, trigger: first external users. Check Education eligibility (free) | No. Sources: sentry.io/pricing, sentry.io/for/education |
| **PostHog** | Product analytics and feature flags | Free | Free every month: 1M analytics events, 5K session recordings, 1M feature-flag requests, 100K exceptions; no card; rates above free not shown | $0 | Feed engagement and retention are unmeasured | The app's own `analyticsService.ts`; privacy-friendly counters in Postgres | Evidence for feed and recommendation changes | **P2**, trigger: enough users for events to mean something; needs a consent/privacy decision first | No. Source: posthog.com/pricing |
| **Figma** | UI design | Starter (free) | Starter free; Professional Full seat $16/month, Dev seat $12, Collab seat $3 (the page did not label monthly vs annual) | $0 | The UI is built directly in code; no design handoff is blocking | Design in code; Starter | Faster visual iteration, only if a designer joins | P3 | No. Source: figma.com/pricing |
| **LLM evaluation platform** (Langfuse) | Trace and score model outputs | Hobby (free) when needed | Hobby free: 50k units/month, 30 days retention, 2 users; Core $29/month: 100k units, 90 days. Self-hosting terms not read | $0 | Offline checks and the human benchmark already cover evaluation | The in-repo `backend/eval` tooling | Dashboards over recorded outputs | **P3** until the human benchmark exists | No. Source: langfuse.com/pricing |
| **Database monitoring** | Slow queries, size | None | Not priced. Railway's own metrics and Postgres's `pg_stat_statements` extension cost nothing; no dedicated vendor was evaluated | $0 | One real issue found by measurement (section 4) was fixed by an index, not a tool | `EXPLAIN ANALYZE`, `pg_stat_statements` | - | P3 | No |

### Totals

- **Needed now: $0, or $5/month (Railway Hobby) if the trial is over**, plus metered Anthropic usage governed by the spend gate.
- **Free actions that give the most:** Anthropic Console spend limit, a free uptime monitor on `/ready`, enabling the CI workflow (when the owner decides), Firebase rules check.
- **Triggers for the next spend:** first paying user → Vercel Pro ($20/month); first external users → Sentry free then Team ($26-29/month) if limits are hit; analytics when there are users → PostHog free.
- Everything listed together, at the smallest paid tiers where free is not enough (Railway Hobby, Vercel Pro, Sentry Team): about $51-54/month ($5 + $20 + $26-29), $612-648/year, before metered Railway and Anthropic usage. No enterprise plan is recommended anywhere.

### Integration effort and lock-in

- **Sentry:** the backend has no runtime dependencies by design; the SDK would add one. Alternative: post to Sentry's HTTP API from the existing logger. Low lock-in (standard stack traces).
- **PostHog:** SDK in the Expo app; events are exportable; privacy and consent copy needed.
- **Uptime monitor:** no code; low lock-in.
- **Vercel / Railway:** both are standard containers and static builds; moving later costs days, not weeks.
- **Langfuse:** optional SDK; open source, so lock-in is low.

### Student or research discounts (not verified for this owner)

Sentry Education (above) is stated on Sentry's page for students, teachers and university researchers. Whether the owner qualifies, and whether a GitHub Student Developer Pack would apply, was not checked.

## 4. Findings from measurement made for this audit

Not a purchase, but a spend-adjacent result. The AI spend gate seeds a project's or user's day counter from Postgres. On a synthetic table of 2,000,000 `ai_usage` rows (100,000 per day), PostgreSQL 16.15:

| Query scope | Before (as shipped) | After (new indexes) |
|---|---|---|
| project | about 220-260 ms, whole day scanned (about 30,000 buffer reads) | about 0.1-0.2 ms |
| user | about 210-270 ms | about 0.1-0.2 ms |
| tenant | about 0.1 ms (already indexed) | unchanged |
| global | about 270-300 ms (reads the day; inherent) | unchanged |

Fix: migration 3 `ai_usage_project_and_user_indexes` (local, uncommitted). Runs only when a counter is missing, so the cost is a first-request delay per scope per day, growing with daily volume. Synthetic data, one machine; absolute times will differ on Railway.

## 5. Addendum 2026-11-04 (phase 2)

Nothing was bought, started as a trial, or signed up for. Prices below were read from vendor pages on 2026-11-03/04 where marked; otherwise they carry over from section 3.

| Tool | Why it would help | Smallest suitable plan | Cost | Needs your approval? | Decision / trigger |
|---|---|---|---|---|---|
| **OpenAlex API key** | Moves search off per-user IP limits onto one visible, server-side allowance (keyless: about 10 requests/s; free key: about $1/day of credits per OpenAlex docs, 2026-11-03) | **Free key**, stored only in Railway variables, used only by a backend proxy | $0 | Yes: account creation in your name and a secret in production. I will not create or handle it | Do before building the proxy; paid tier only if the free credit is exhausted |
| **Uptime monitor** (UptimeRobot free or equivalent) | Phone alert when `/ready` fails (steps in `UPTIME_MONITOR_SETUP.md`) | Free | $0 | Yes: account | Do now |
| **Anthropic Console spend limit** | The only hard ceiling on model spend outside the app's own gate | Setting on existing account | $0 | Yes: billing setting | Do now |
| **Two paid raters or volunteers for the benchmark** | The only way to learn real summary accuracy | Hourly, about 25 to 40 hours each for 50 papers x 2 summaries (estimate) | Your choice (volunteer to market rate) | Yes | Needed before public accuracy claims |
| **Anthropic API usage for the benchmark** | ~50 backend analyses | Existing key, spend cap first | Roughly the cost of 50 normal analyses (not measured) | Yes: spend | With the study |
| **Semantic Scholar API key** | Related-paper discovery | Free key | $0 | Yes (and licence clarification first) | Defer |
| **Windows build/test machine or a Linux CI runner with `node_modules`** | Production web build + Lighthouse could not run in my environment | Your own PC; GitHub Actions free minutes | $0 | No for your PC; Yes to enable Actions | Run `npm run build:web` locally |
| **Error tracking (Sentry Developer, free)** | Crash and error visibility | Free | $0 | Yes: account + dependency or HTTP integration | After first external users |
| **Product analytics (PostHog free)** | Discovery metrics (§5 of the discovery audit) | Free | $0 | Yes: account + privacy copy | After the privacy review |
| **Railway Hobby** | Production runtime | $5/month (carried from section 3; plan/usage not checked, no authorised access) | $5 | Yes | Confirm what you are on now |

Totals: needed now **$0**, plus rater time and the metered cost of the study. Everything else waits for a trigger.
