# Browser end-to-end harness (test-only)

Drives the real Expo web build in Chromium against a real local backend (PostgreSQL 16 + Redis 7, throwaway `*_test` database).

**What is real:** the UI, the Firebase *web SDK* running in the browser, the backend, its RS256 Firebase-token verifier (same code as production), PostgreSQL, Redis, the AI budget gate and ledger.
**What is mocked (and nothing else):**
1. Google's identity servers (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`): Playwright answers them (`fakeFirebase.js`) and signs ID tokens with a throwaway test key; the backend verifies them with that key's public half, exactly as it verifies real ones with Google's.
2. The AI provider: an injected stub (`harness.js`). Answers carry a `[TEST STUB]` marker. No paid call can happen.
3. OpenAlex and the backend's paper providers: fictional, provider-shaped fixture papers (`openalexFixture.js`, `backend/tests/node/paperFixtures.js`). The paper titles and authors seen in screenshots are fictional.

Nothing here is imported by production code, there is no authentication bypass in the app, and no real Firebase project, account or credential is used. The build is made with fake `EXPO_PUBLIC_FIREBASE_*` values.

Run (needs Playwright Chromium; see `build-web.sh` first):
`source <infra env>; NODE_PATH=$(npm root -g) node scripts/e2e/journeys.js`
