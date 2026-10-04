/**
 * Earlier builds let a user keep an AI provider key, a provider choice and a custom "self-hosted" server URL in browser
 * storage, and the chat screen used them to call the provider straight from the browser. That path is gone; these keys are
 * deleted from the device so a key that was stored there does not sit around in plain text. Pure (storage is injected).
 */
export const LEGACY_BROWSER_AI_KEYS = [
  "shords.geminiKey",
  "shords.openaiKey",
  "shords.anthropicKey",
  "shords.aiSource",
  "shords.serverUrl",
  "shords_user_subscription_state" // a self-declared subscription: never an entitlement
] as const;

export interface KeyValueStorage {
  removeItem(key: string): Promise<void>;
}

/** Best effort; returns how many removals were attempted without error. Never throws. */
export async function purgeLegacyBrowserAiKeys(storage: KeyValueStorage): Promise<number> {
  let done = 0;
  for (const key of LEGACY_BROWSER_AI_KEYS) {
    try {
      await storage.removeItem(key);
      done += 1;
    } catch {
      /* ignore: nothing to do if storage is unavailable */
    }
  }
  return done;
}
