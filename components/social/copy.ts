import { Clipboard, Platform } from "react-native";

/** Copy text to the clipboard. Returns false when this platform has no clipboard we can reach, so the UI can say so instead of pretending. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
      if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; }
      return false;
    }
    const c = Clipboard as unknown as { setString?: (t: string) => void } | undefined;
    if (c && typeof c.setString === "function") { c.setString(text); return true; }
    return false;
  } catch (_) { return false; }
}
