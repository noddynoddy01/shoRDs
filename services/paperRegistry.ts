import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";
import { normalizeAndValidatePaper, NormalizedPaper } from "./paperNormalizer";

const PAPER_REGISTRY_KEY = "shords.paperRegistry.v3";
const memoryRegistry = new Map<string, NormalizedPaper>();

export async function registerPaper(paper: Paper): Promise<void> {
  if (!paper) return;

  const normalized = normalizeAndValidatePaper(paper);
  const cleanId = normalized.id.toLowerCase().trim();

  memoryRegistry.set(cleanId, normalized);
  if (normalized.doi) memoryRegistry.set(normalized.doi.toLowerCase().trim(), normalized);

  try {
    const raw = (await AsyncStorage.getItem(PAPER_REGISTRY_KEY)) || "{}";
    const cache = JSON.parse(raw);
    cache[cleanId] = normalized;
    if (normalized.doi) cache[normalized.doi.toLowerCase().trim()] = normalized;
    await AsyncStorage.setItem(PAPER_REGISTRY_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("Paper registry save error:", e);
  }
}

export async function registerPaperBatch(papers: Paper[]): Promise<void> {
  if (!Array.isArray(papers)) return;
  for (const p of papers) {
    await registerPaper(p);
  }
}

export async function getRegisteredPaper(idOrDoi: string): Promise<NormalizedPaper | undefined> {
  if (!idOrDoi) return undefined;
  const key = idOrDoi.toLowerCase().trim();
  const cleanKey = key.replace(/^openalex-|^arxiv-|^crossref-|^europepmc-/, "");

  if (memoryRegistry.has(key)) return memoryRegistry.get(key);
  if (memoryRegistry.has(cleanKey)) return memoryRegistry.get(cleanKey);

  try {
    const raw = await AsyncStorage.getItem(PAPER_REGISTRY_KEY);
    if (raw) {
      const cache = JSON.parse(raw);
      if (cache[key]) {
        const norm = normalizeAndValidatePaper(cache[key]);
        memoryRegistry.set(key, norm);
        return norm;
      }
      if (cache[cleanKey]) {
        const norm = normalizeAndValidatePaper(cache[cleanKey]);
        memoryRegistry.set(cleanKey, norm);
        return norm;
      }
      for (const k of Object.keys(cache)) {
        if (k.includes(cleanKey) || cleanKey.includes(k)) {
          const norm = normalizeAndValidatePaper(cache[k]);
          return norm;
        }
      }
    }
  } catch (e) {
    console.error("Paper registry lookup error:", e);
  }

  return undefined;
}
