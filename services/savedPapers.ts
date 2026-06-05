import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "shords.savedPaperIds";

export async function getSavedPaperIds() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function isPaperSaved(id: string) {
  const ids = await getSavedPaperIds();
  return ids.includes(id);
}

export async function toggleSavedPaper(id: string) {
  const ids = await getSavedPaperIds();
  const next = ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next.includes(id);
}
