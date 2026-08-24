import AsyncStorage from "@react-native-async-storage/async-storage";
import { Domain, Paper } from "@/types/models";
import { samplePapers } from "@/data/samplePapers";
import { fetchLiveFeedCandidatesAsync, markPaperAsSeenAsync } from "./feedEngine";
import { deduplicatePaperList } from "./deduplication";

const STORAGE_KEY = "shords_saved_papers";
let cachedPapersList: Paper[] = [];

export function getAllPapers(): Paper[] {
  return cachedPapersList.length > 0 ? cachedPapersList : samplePapers;
}

export function cacheDynamicPaper(paper: Paper) {
  const existing = cachedPapersList.findIndex(p => p.id === paper.id);
  if (existing >= 0) {
    cachedPapersList[existing] = paper;
  } else {
    cachedPapersList.unshift(paper);
  }
}

export function parsePaperSections(paperOrExplanation?: any, title?: string, summary?: string, domain?: string): Record<string, string> {
  const explanation = typeof paperOrExplanation === "object" && paperOrExplanation !== null 
    ? (paperOrExplanation.fullExplanation || paperOrExplanation.summary || "") 
    : (paperOrExplanation || summary || "");

  return {
    context: `Background context for ${title || 'manuscript'}: ${explanation.slice(0, 160)}...`,
    methodology: `Algorithmic execution pipeline designed for hardware efficiency.`,
    results: `Empirical evaluations confirm target precision and latency baselines.`,
    futureScope: `Extending multi-domain adaptation across heterogeneous datasets.`
  };
}

export async function fetchLivePapersFromOpenAlexAsync(query: string = "artificial intelligence", page: number = 1): Promise<Paper[]> {
  return fetchLiveFeedCandidatesAsync(query, true);
}

export async function getPapersAsync(domain?: Domain | string): Promise<Paper[]> {
  if (cachedPapersList.length === 0) {
    const liveItems = await fetchLiveFeedCandidatesAsync(domain ? String(domain) : undefined, false);
    if (liveItems.length > 0) {
      cachedPapersList = deduplicatePaperList([...liveItems, ...samplePapers]);
    } else {
      cachedPapersList = deduplicatePaperList([...samplePapers]);
    }
  }

  if (domain && String(domain) !== "All Discoveries") {
    return cachedPapersList.filter(p => p.domain === domain || (p.tags && p.tags.includes(String(domain).toLowerCase())));
  }

  return cachedPapersList;
}

export async function fetchNextDiscoveryPageAsync(domain?: Domain | string): Promise<Paper[]> {
  const freshItems = await fetchLiveFeedCandidatesAsync(domain ? String(domain) : undefined, true);
  if (freshItems.length > 0) {
    const combined = deduplicatePaperList([...freshItems, ...cachedPapersList]);
    cachedPapersList = combined;
    return combined;
  }
  return cachedPapersList;
}

export async function getPaperById(id: string): Promise<Paper | undefined> {
  const allPapers = await getPapersAsync();
  const found = allPapers.find(p => p.id === id);
  if (found) {
    markPaperAsSeenAsync(found);
  }
  return found;
}

export async function getSavedPapersAsync(): Promise<Paper[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const savedIds: string[] = JSON.parse(stored);
    const allPapers = await getPapersAsync();
    return allPapers.filter(p => savedIds.includes(p.id));
  } catch {
    return [];
  }
}

export async function isPaperSavedAsync(paperId: string): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    const savedIds: string[] = JSON.parse(stored);
    return savedIds.includes(paperId);
  } catch {
    return false;
  }
}

export async function toggleSavePaperAsync(paperId: string): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    let savedIds: string[] = stored ? JSON.parse(stored) : [];

    let isSavedNow = false;
    if (savedIds.includes(paperId)) {
      savedIds = savedIds.filter(id => id !== paperId);
      isSavedNow = false;
    } else {
      savedIds.push(paperId);
      isSavedNow = true;
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedIds));
    return isSavedNow;
  } catch {
    return false;
  }
}

export function usePaperStore() {
  return {
    papers: getAllPapers(),
    savePaper: (id: string) => toggleSavePaperAsync(id),
    isPaperSaved: (id: string) => false
  };
}
