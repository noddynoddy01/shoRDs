import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";
import { executeLiveFederatedSearch, FederatedPaper } from "./federatedSearch";

const FEED_CACHE_KEY = "shords.liveFeedCache";

const FEED_TOPICS = [
  "Artificial Intelligence",
  "Quantum Computing",
  "Robotics",
  "Biotechnology",
  "Space Tech",
  "Cybersecurity",
  "Renewable Energy",
  "Neuroscience",
  "Machine Learning"
];

export async function fetchLiveFeedBatch(page: number = 1, domain?: string): Promise<Paper[]> {
  try {
    const topic = domain || FEED_TOPICS[(page - 1) % FEED_TOPICS.length];
    const res = await executeLiveFederatedSearch(topic, page, {
      sortBy: "recency",
      openAccessOnly: true
    });

    if (res.papers.length > 0) {
      await cacheFeedPapers(res.papers);
      return res.papers;
    }
    
    // If live API returned 0, load cached feed metadata
    return await getCachedFeedPapers();
  } catch (err) {
    console.warn("Live feed fetch error, falling back to cache:", err);
    return await getCachedFeedPapers();
  }
}

async function cacheFeedPapers(newPapers: Paper[]) {
  try {
    const raw = (await AsyncStorage.getItem(FEED_CACHE_KEY)) || "[]";
    const existing: Paper[] = JSON.parse(raw);
    const seenIds = new Set(existing.map(p => p.id));
    const merged = [...existing];

    for (const p of newPapers) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push(p);
      }
    }
    await AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify(merged.slice(0, 100)));
  } catch (e) {
    console.error("Feed cache error:", e);
  }
}

export async function getCachedFeedPapers(): Promise<Paper[]> {
  try {
    const raw = await AsyncStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
