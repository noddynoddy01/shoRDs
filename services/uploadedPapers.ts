import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";

const STORAGE_KEY = "shords.uploadedPapers";

function revivePaper(raw: Paper): Paper {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt)
  };
}

export async function getUploadedPapers(): Promise<Paper[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Paper[];
    return Array.isArray(parsed) ? parsed.map(revivePaper) : [];
  } catch {
    return [];
  }
}

export async function addUploadedPaper(paper: Paper) {
  const current = await getUploadedPapers();
  const next = [paper, ...current.filter((item) => item.id !== paper.id)];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function getUploadedPaperCount() {
  const papers = await getUploadedPapers();
  return papers.length;
}
