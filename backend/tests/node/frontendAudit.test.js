"use strict";
/**
 * Frontend audit guards (Phase 8): no browser-side AI path, no client-granted privilege.
 *  - The app bundle (everything reachable from app/) contains no call to an AI provider and no provider key handling.
 *  - The provider adapters refuse to run in a browser / React Native runtime.
 *  - Subscription state is always FREE on the client, whatever is in device storage, and no purchase can upgrade anyone.
 *  - Keys left in device storage by earlier builds are deleted.
 * TypeScript modules are loaded through Node's built-in type stripping; subscriptionService.ts is loaded with its single
 * native-module import replaced by an in-memory stub (the file on disk is not modified).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ------------------------------------------------------------------------------------------------ bundle reachability
const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of EXTS) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
function listSources(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) listSources(p, out);
    else if (/\.(tsx?|js)$/.test(d.name)) out.push(p);
  }
  return out;
}
/** Every file Metro could bundle from the route files (static and dynamic import / require). */
function bundleFiles() {
  const seen = new Set(listSources(path.join(root, "app")));
  const queue = [...seen];
  const re = /(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
  while (queue.length) {
    const f = queue.pop();
    for (const m of fs.readFileSync(f, "utf8").matchAll(re)) {
      const r = resolveImport(f, m[1] || m[2] || m[3] || m[4]);
      if (r && !seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  return [...seen].map((f) => path.relative(root, f));
}

const AI_HOSTS = ["api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com", "openrouter.ai", "api.groq.com", "api.mistral.ai", "api.cohere"];
const KEY_HANDLING = [/x-api-key/i, /anthropic-version/i, /dangerously-allow-browser/i, /shords\.(gemini|openai|anthropic)Key/, /shords\.aiSource/, /shords\.serverUrl/];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("bundle: nothing reachable from app/ calls an AI provider or handles a provider key", () => {
  const files = bundleFiles();
  assert.ok(files.length > 50, `walked ${files.length} files`);
  const offences = [];
  for (const f of files) {
    const code = stripComments(read(f));
    for (const h of AI_HOSTS) if (code.includes(h)) offences.push(`${f}: ${h}`);
    // The one file allowed to NAME the old key slots is the purge list, and it may only delete them.
    if (f === "services/auth/legacy.ts") {
      assert.doesNotMatch(code, /getItem|setItem|fetch\(/);
      continue;
    }
    for (const re of KEY_HANDLING) if (re.test(code)) offences.push(`${f}: ${re}`);
  }
  assert.deepEqual(offences, []);
});

test("bundle: the browser-capable TS gateway is not reachable from the app", () => {
  const bad = bundleFiles().filter((f) => f.startsWith("services/llm/") || /llmAdapterService|copilotExecutionPipelineService/.test(f));
  assert.deepEqual(bad, []);
});

test("every direct provider adapter refuses to run inside the app", () => {
  for (const f of ["anthropicProvider", "openaiProvider", "geminiProvider"]) {
    const code = read(`services/llm/providers/${f}.ts`);
    assert.match(code, /assertServerRuntime\("/, `${f} calls the guard`);
    assert.ok(code.indexOf("assertServerRuntime(\"") < code.indexOf("this.apiKey"), `${f}: guard runs before the key is read`);
  }
  const { assertServerRuntime } = require(path.join(root, "services/llm/providers/serverOnly.ts"));
  assert.doesNotThrow(() => assertServerRuntime("X"), "plain Node (the server) is allowed");
  const g = globalThis;
  const saved = { window: g.window, document: g.document };
  try {
    g.window = {};
    g.document = {};
    assert.throws(() => assertServerRuntime("X"), /must not run inside the app/);
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete g[k];
      else g[k] = saved[k];
    }
  }
  const nav = Object.getOwnPropertyDescriptor(g, "navigator");
  try {
    Object.defineProperty(g, "navigator", { value: { product: "ReactNative" }, configurable: true });
    assert.throws(() => assertServerRuntime("X"), /must not run inside the app/);
  } finally {
    if (nav) Object.defineProperty(g, "navigator", nav);
    else delete g.navigator;
  }
});

// ------------------------------------------------------------------------------------------------ research calls
test("research operations use the authenticated client; browser fetches are only public scholarly metadata discovery", () => {
  const files = bundleFiles();
  const fetchers = {};
  for (const f of files) {
    const code = stripComments(read(f));
    if (/\bfetch\(|XMLHttpRequest|axios/.test(code)) fetchers[f] = true;
  }
  // Allow-list of files that may call the network directly. Anything new must be reviewed (and, if it is research, go through `api`).
  assert.deepEqual(Object.keys(fetchers).sort(), [
    "services/auth/apiClient.ts",
    "services/federatedSearch.ts",
    "services/feedEngine.ts"
  ]);
  // The only direct hosts are the public OpenAlex metadata API; no key is attached.
  for (const f of ["services/federatedSearch.ts", "services/feedEngine.ts"]) {
    const code = stripComments(read(f));
    const hosts = new Set([...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/^(doi\.org|shords\.app|openalex\.org|localhost)$/.test(h)));
    assert.deepEqual([...hosts], ["api.openalex.org"], f);
    assert.doesNotMatch(code, /Authorization|Bearer|apiKey|api_key/i, f);
  }
  const svc = read("services/researchCopilotService.ts");
  assert.match(svc, /api\.post\("\/api\/v1\/copilot\/query"/);
});

// ------------------------------------------------------------------------------------------------ subscription
function loadSubscription(store) {
  const src = read("services/subscriptionService.ts").replace(
    /import AsyncStorage from "@react-native-async-storage\/async-storage";/,
    "const AsyncStorage = globalThis.__TEST_STORAGE__;"
  );
  assert.doesNotMatch(src, /^import /m, "no other import: the stub is the only dependency");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sub-"));
  const file = path.join(dir, "subscriptionService.ts");
  fs.writeFileSync(file, src);
  globalThis.__TEST_STORAGE__ = {
    async getItem(k) { return k in store ? store[k] : null; },
    async setItem(k, v) { store[k] = String(v); },
    async removeItem(k) { delete store[k]; }
  };
  return require(file);
}

test("subscription: the client can only ever be FREE, whatever device storage claims", async () => {
  const forged = {
    userId: "u", state: "ACTIVE", isServerVerified: true, planId: "shords_scholar_annual", expiresAt: "2099-01-01T00:00:00Z", isPro: true, plan: "pro"
  };
  const store = {
    shords_user_subscription_state: JSON.stringify(forged),
    "shords.currentUser": JSON.stringify({ id: "uid-1", name: "Ada", role: "admin", isPro: true, subscription: { isPro: true, status: "ACTIVE" } })
  };
  const S = loadSubscription(store);
  const sub = await S.getUserSubscriptionAsync();
  assert.deepEqual(sub, { isPro: false, status: "FREE" });
  assert.equal(S.isSubscribed(), false);
  assert.equal("shords_user_subscription_state" in store, false, "the legacy self-declared state is deleted, not honoured");
  const user = await S.getCurrentUser();
  assert.equal(user.id, "uid-1");
  assert.equal(user.subscription.isPro, false, "a subscription stored in the profile cache is overridden");
});

test("subscription: no purchase path upgrades anyone and nothing is fabricated", async () => {
  const store = {};
  const S = loadSubscription(store);
  for (const r of [await S.purchaseSubscription("monthly"), await S.purchaseSubscription("shords_scholar_annual"), await S.upgradeToProAsync()]) {
    assert.deepEqual([r.ok, r.reason], [false, "PAYMENTS_UNAVAILABLE"]);
    assert.match(r.message, /No payment was taken/);
  }
  assert.equal(S.PURCHASES_AVAILABLE, false);
  assert.equal((await S.getUserSubscriptionAsync()).isPro, false);
  assert.deepEqual(store, {}, "nothing was written to device storage");
  assert.equal(await S.getCurrentUser(), null, "signed out: no invented 'Scholar User'");
  const src = stripComments(read("services/subscriptionService.ts"));
  for (const bad of [/txn_/, /startsWith\(/, /isServerVerified:\s*true/, /state:\s*"ACTIVE"/, /usageCount/, /monthlyLimit/, /\+15550199/, /user@shords\.app/]) assert.doesNotMatch(src, bad, String(bad));
});

test("the paywall and the modal never present a purchase as completed", () => {
  const paywall = stripComments(read("app/paywall.tsx"));
  assert.doesNotMatch(paywall, /Subscription Activated|You are now a shoRDs Premium member|Verifying Transaction/);
  const modal = stripComments(read("components/SubscriptionModal.tsx"));
  assert.doesNotMatch(modal, /setSub\(updated\)|usageCount|monthlyLimit|plan === "pro"/);
  const home = stripComments(read("app/(tabs)/index.tsx"));
  assert.doesNotMatch(home, /plan === "pro"/);
});

// ------------------------------------------------------------------------------------------------ legacy keys
test("legacy browser-side AI keys and self-declared subscription are deleted from device storage", async () => {
  const { purgeLegacyBrowserAiKeys, LEGACY_BROWSER_AI_KEYS } = require(path.join(root, "services/auth/legacy.ts"));
  const store = { "shords.geminiKey": "AIza-fake", "shords.aiSource": "gemini", "shords.serverUrl": "http://x", shords_user_subscription_state: "{}", "shords.theme": "dark" };
  const removed = [];
  const n = await purgeLegacyBrowserAiKeys({ async removeItem(k) { removed.push(k); delete store[k]; } });
  assert.equal(n, LEGACY_BROWSER_AI_KEYS.length);
  assert.deepEqual(Object.keys(store), ["shords.theme"], "unrelated preferences are untouched");
  // Storage failure never throws.
  assert.equal(await purgeLegacyBrowserAiKeys({ async removeItem() { throw new Error("quota"); } }), 0);
});

test("the mentor chat has no network path to an AI service", () => {
  const code = stripComments(read("app/chat/[id].tsx"));
  assert.doesNotMatch(code, /fetch\(/);
  assert.doesNotMatch(code, /geminiKey|aiSource|serverUrl|generativelanguage/);
  assert.match(read("app/chat/[id].tsx"), /not connected to an AI model/);
});
