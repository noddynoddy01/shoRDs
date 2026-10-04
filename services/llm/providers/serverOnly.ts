/**
 * AI provider adapters hold a provider API key and call Anthropic / OpenAI / Gemini directly. That is only legitimate on a
 * server. In the app (browser or React Native) every AI call must go through the authenticated shoRDs backend instead, so these
 * adapters refuse to run there even if a future change imports them by mistake.
 */
export function assertServerRuntime(name: string): void {
  const g = globalThis as any;
  const inBrowser = typeof g.window !== "undefined" && typeof g.document !== "undefined";
  const inReactNative = typeof g.navigator !== "undefined" && g.navigator.product === "ReactNative";
  if (inBrowser || inReactNative) {
    throw new Error(`${name} must not run inside the app. AI requests go through the shoRDs backend (POST /api/v1/copilot/query).`);
  }
}
