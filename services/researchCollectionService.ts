/**
 * Research Collections & Workflow Service for shoRDs Research Intelligence OS
 * Manages private user collections, custom research notes, and batch bibliographic export.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CitationExportService, CitationMetadata } from "./citationExportService";

export interface CollectionItem {
  canonicalId: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  domain?: string;
  userNotes?: string;
  addedAt: string;
}

export interface ResearchCollection {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  items: CollectionItem[];
}

const COLLECTIONS_STORAGE_KEY = "shords_user_research_collections";

export class ResearchCollectionService {
  private static collections: Map<string, ResearchCollection> = new Map([
    [
      "col_default",
      {
        id: "col_default",
        name: "Literature Review",
        description: "Primary reading list for research synthesis.",
        createdAt: new Date().toISOString(),
        items: []
      }
    ]
  ]);

  static async initAsync(): Promise<ResearchCollection[]> {
    try {
      const stored = await AsyncStorage.getItem(COLLECTIONS_STORAGE_KEY);
      if (stored) {
        const list: ResearchCollection[] = JSON.parse(stored);
        this.collections.clear();
        for (const col of list) {
          this.collections.set(col.id, col);
        }
      }
    } catch {}
    return Array.from(this.collections.values());
  }

  static async createCollectionAsync(name: string, description?: string): Promise<ResearchCollection> {
    const newCol: ResearchCollection = {
      id: `col_${Date.now()}`,
      name,
      description,
      createdAt: new Date().toISOString(),
      items: []
    };
    this.collections.set(newCol.id, newCol);
    await AsyncStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(Array.from(this.collections.values())));
    return newCol;
  }

  static async addPaperToCollectionAsync(collectionId: string, item: Omit<CollectionItem, "addedAt">): Promise<boolean> {
    const col = this.collections.get(collectionId);
    if (!col) return false;

    if (!col.items.some(i => i.canonicalId === item.canonicalId)) {
      col.items.push({
        ...item,
        addedAt: new Date().toISOString()
      });
      await AsyncStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(Array.from(this.collections.values())));
    }
    return true;
  }

  static async removePaperFromCollectionAsync(collectionId: string, canonicalId: string): Promise<boolean> {
    const col = this.collections.get(collectionId);
    if (!col) return false;

    col.items = col.items.filter(i => i.canonicalId !== canonicalId);
    await AsyncStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(Array.from(this.collections.values())));
    return true;
  }

  static async exportCollectionBibTeXAsync(collectionId: string): Promise<string> {
    const col = this.collections.get(collectionId);
    if (!col || col.items.length === 0) return "";

    const entries = col.items.map(item => {
      const meta: CitationMetadata = {
        id: item.canonicalId,
        title: item.title,
        authors: item.authors,
        year: item.year,
        venue: item.venue,
        canonicalId: item.canonicalId
      };
      return CitationExportService.generateBibTeX(meta);
    });

    return entries.join("\n\n");
  }

  static getCollections(): ResearchCollection[] {
    return Array.from(this.collections.values());
  }
}
