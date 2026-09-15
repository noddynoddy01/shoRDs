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
  const paperObj = typeof paperOrExplanation === "object" && paperOrExplanation !== null ? paperOrExplanation : null;
  const rawText = (paperObj ? (paperObj.fullExplanation || paperObj.summary || "") : (paperOrExplanation || summary || "")).trim();
  const paperTitle = (paperObj?.title || title || "manuscript").trim();
  const paperDomain = (paperObj?.domain || domain || "Research").trim();
  const insights: string[] = paperObj?.insights || [];

  let context = "";
  let methodology = "";
  let results = "";
  let futureScope = "";

  // 1. Check for bracketed emoji / label sections e.g. 🔬 [Context & Background]
  const contextMatch = rawText.match(/(?:🔬\s*)?\[(?:Context|Background|Abstract)[^\]]*\]\s*([\s\S]*?)(?=(?:⚙️|📊|🔮|\[|$))/i);
  const methodMatch = rawText.match(/(?:⚙️\s*)?\[(?:Technical Methodology|Methodology|Method|Approach)[^\]]*\]\s*([\s\S]*?)(?=(?:📊|🔮|\[|$))/i);
  const resultsMatch = rawText.match(/(?:📊\s*)?\[(?:Key Results|Results|Findings)[^\]]*\]\s*([\s\S]*?)(?=(?:🔮|\[|$))/i);
  const futureMatch = rawText.match(/(?:🔮\s*)?\[(?:Future Scope|Future|Horizons|Next Steps)[^\]]*\]\s*([\s\S]*?)(?=$)/i);

  if (contextMatch && contextMatch[1]?.trim()) context = contextMatch[1].trim();
  if (methodMatch && methodMatch[1]?.trim()) methodology = methodMatch[1].trim();
  if (resultsMatch && resultsMatch[1]?.trim()) results = resultsMatch[1].trim();
  if (futureMatch && futureMatch[1]?.trim()) futureScope = futureMatch[1].trim();

  // 2. If bracketed sections didn't match, attempt paragraph semantic clustering / markdown headings
  if (!context || !methodology || !results) {
    const paragraphs = rawText.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
    
    // Check markdown/numbered headers
    let currentSection = "context";
    const buckets: Record<string, string[]> = { context: [], methodology: [], results: [], futureScope: [] };
    
    for (const para of paragraphs) {
      const lower = para.toLowerCase();
      if (/^(#+|\d+\.|\*\*)\s*(method|approach|architecture|algorithm|technique|model)/i.test(para) || lower.startsWith("methodology:") || lower.startsWith("approach:")) {
        currentSection = "methodology";
      } else if (/^(#+|\d+\.|\*\*)\s*(result|finding|evaluation|performance|benchmark)/i.test(para) || lower.startsWith("results:") || lower.startsWith("findings:")) {
        currentSection = "results";
      } else if (/^(#+|\d+\.|\*\*)\s*(future|scope|horizon|limitation|outlook|conclusion)/i.test(para) || lower.startsWith("future:") || lower.startsWith("conclusion:")) {
        currentSection = "futureScope";
      } else if (/^(#+|\d+\.|\*\*)\s*(introduction|context|background|abstract)/i.test(para) || lower.startsWith("background:") || lower.startsWith("abstract:")) {
        currentSection = "context";
      }
      buckets[currentSection].push(para.replace(/^([#\d.*:—–\- ]+|\[[^\]]+\])\s*/i, "").trim());
    }

    if (!context && buckets.context.length > 0) context = buckets.context.join("\n\n");
    if (!methodology && buckets.methodology.length > 0) methodology = buckets.methodology.join("\n\n");
    if (!results && buckets.results.length > 0) results = buckets.results.join("\n\n");
    if (!futureScope && buckets.futureScope.length > 0) futureScope = buckets.futureScope.join("\n\n");
  }

  // 3. Fallback to extracting from paragraphs / summary / insights if still missing
  const cleanSummary = paperObj?.summary || summary || rawText.slice(0, 300);
  if (!context) {
    context = cleanSummary || `Research addressing critical challenges in ${paperDomain}.`;
  }

  if (!methodology) {
    const methodInsight = insights.find(i => /model|decoder|architecture|network|framework|method|algorithm|technique|design|pipeline/i.test(i));
    if (methodInsight) {
      methodology = methodInsight;
    } else {
      const actionSentences = (rawText || cleanSummary).match(/[^.!?]+(?:propose|introduce|develop|design|evaluate|leverage|utilize|apply)[^.!?]+[.!?]/gi);
      if (actionSentences && actionSentences.length > 0) {
        methodology = actionSentences[0].trim();
      } else {
        methodology = `Investigates ${paperTitle} using domain-specific empirical methodologies within ${paperDomain}.`;
      }
    }
  }

  if (!results) {
    const resultInsight = insights.find(i => /%|redu|improv|accurac|outperform|demonstrat|achiev|gain|save/i.test(i));
    if (resultInsight) {
      results = resultInsight;
    } else if (insights.length > 1) {
      results = insights[1];
    } else {
      const resultSentences = (rawText || cleanSummary).match(/[^.!?]+(?:\d+%|achieve|outperform|exceed|reduce|improve|result|show|demonstrate)[^.!?]+[.!?]/gi);
      if (resultSentences && resultSentences.length > 0) {
        results = resultSentences[0].trim();
      } else {
        results = `The investigation into ${paperTitle} demonstrates measurable empirical advancements in ${paperDomain}.`;
      }
    }
  }

  if (!futureScope) {
    const futureInsight = insights.find(i => /future|next|scale|deploy|hardware|extend|open/i.test(i));
    if (futureInsight) {
      futureScope = futureInsight;
    } else if (insights.length > 2) {
      futureScope = insights[2];
    } else {
      futureScope = `Further research involves extending this framework for broader application in ${paperDomain}.`;
    }
  }

  return {
    context,
    methodology,
    results,
    futureScope
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
