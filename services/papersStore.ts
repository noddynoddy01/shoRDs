import AsyncStorage from "@react-native-async-storage/async-storage";
import { samplePapers } from "@/data/samplePapers";
import { Paper } from "@/types/models";
import { getUploadedPapers } from "./uploadedPapers";

const DELETED_PAPERS_KEY = "shords.deletedPaperIds";
const UPLOADED_STORAGE_KEY = "shords.uploadedPapers";

export type PaperSections = {
  context: string;
  methodology: string;
  results: string;
  futureScope: string;
};

export function parsePaperSections(
  fullExplanation: string,
  title: string,
  summary: string,
  domain: string
): PaperSections {
  const sections = {
    context: "",
    methodology: "",
    results: "",
    futureScope: ""
  };

  const paragraphs = fullExplanation.split("\n\n").filter(Boolean);
  let currentKey: keyof PaperSections | null = null;

  for (const para of paragraphs) {
    const cleanPara = para.trim();
    if (cleanPara.includes("[Context") || cleanPara.includes("[Abstract")) {
      sections.context = cleanPara.replace(/^.*\[(Context|Abstract)[^\]]*\]\s*/i, "").trim();
      currentKey = "context";
    } else if (cleanPara.includes("[Methodology") || cleanPara.includes("[Technical") || cleanPara.includes("[Methods")) {
      sections.methodology = cleanPara.replace(/^.*\[(Methodology|Technical|Methods)[^\]]*\]\s*/i, "").trim();
      currentKey = "methodology";
    } else if (cleanPara.includes("[Results") || cleanPara.includes("[Key") || cleanPara.includes("[Findings")) {
      sections.results = cleanPara.replace(/^.*\[(Results|Key|Findings)[^\]]*\]\s*/i, "").trim();
      currentKey = "results";
    } else if (cleanPara.includes("[Future") || cleanPara.includes("[Scope") || cleanPara.includes("[Horizons") || cleanPara.includes("[Impact")) {
      sections.futureScope = cleanPara.replace(/^.*\[(Future|Scope|Horizons|Impact)[^\]]*\]\s*/i, "").trim();
      currentKey = "futureScope";
    } else {
      if (currentKey) {
        sections[currentKey] += "\n\n" + cleanPara;
      } else {
        if (!sections.context) {
          sections.context = cleanPara;
          currentKey = "context";
        } else if (!sections.methodology) {
          sections.methodology = cleanPara;
          currentKey = "methodology";
        } else if (!sections.results) {
          sections.results = cleanPara;
          currentKey = "results";
        } else {
          sections.futureScope = cleanPara;
          currentKey = "futureScope";
        }
      }
    }
  }

  // Fallbacks if any section is empty
  if (!sections.context) {
    sections.context = `This research paper explores advanced developments in the field of ${domain}. It focuses on solving key challenges related to scalability and performance.`;
  }
  if (!sections.methodology) {
    sections.methodology = `The methodology involves setting up controlled experiments to evaluate performance under load. System latency, throughput, and error rates were monitored closely to optimize the underlying algorithm.`;
  }
  if (!sections.results) {
    sections.results = `Key findings show a significant improvement in efficiency. Under standard benchmarks, the system demonstrated reliable performance matching the target goals: "${summary}"`;
  }
  if (!sections.futureScope) {
    sections.futureScope = `Future work aims to deploy this methodology in production environments and test it with larger datasets. Researchers plan to investigate cross-platform integrations to expand usability.`;
  }

  return sections;
}

export async function getDeletedPaperIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DELETED_PAPERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getAllPapers(): Promise<Paper[]> {
  const uploaded = await getUploadedPapers();
  const deletedIds = await getDeletedPaperIds();
  const deletedSet = new Set(deletedIds);

  const uploadedIds = new Set(uploaded.map((paper) => paper.id));
  const base = samplePapers.filter((paper) => !uploadedIds.has(paper.id));
  
  let all = [...uploaded, ...base];

  try {
    const { db, fetchPapers } = await import("./firebase");
    if (db) {
      const remote = await fetchPapers();
      const localIds = new Set(all.map((p) => p.id));
      const filteredRemote = remote.filter((p) => !localIds.has(p.id));
      all = [...all, ...filteredRemote];
    }
  } catch (err) {
    console.warn("Failed to fetch remote papers from Firebase:", err);
  }

  return all.filter((paper) => !deletedSet.has(paper.id));
}

export async function getPaperById(id: string): Promise<Paper | undefined> {
  const papers = await getAllPapers();
  return papers.find((paper) => paper.id === id);
}

export async function deletePaper(id: string): Promise<Paper[]> {
  const uploaded = await getUploadedPapers();
  const isUploaded = uploaded.some((p) => p.id === id);
  if (isUploaded) {
    const nextUploaded = uploaded.filter((p) => p.id !== id);
    await AsyncStorage.setItem(UPLOADED_STORAGE_KEY, JSON.stringify(nextUploaded));
  }

  const deleted = await getDeletedPaperIds();
  if (!deleted.includes(id)) {
    const nextDeleted = [...deleted, id];
    await AsyncStorage.setItem(DELETED_PAPERS_KEY, JSON.stringify(nextDeleted));
  }

  return getAllPapers();
}
