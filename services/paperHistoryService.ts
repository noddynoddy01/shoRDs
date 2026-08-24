import AsyncStorage from "@react-native-async-storage/async-storage";

export type InteractionEventType =
  | "IMPRESSION"
  | "OPEN"
  | "READ_25"
  | "READ_50"
  | "READ_75"
  | "READ_COMPLETE"
  | "SAVE"
  | "LIKE"
  | "DISMISS"
  | "SHARE";

export interface PaperInteractionRecord {
  userId: string;
  canonicalPaperId: string;
  eventType: InteractionEventType;
  timestamp: string;
  feedSessionId: string;
  feedGenerationId: string;
  position?: number;
  source?: string;
}

const INTERACTIONS_KEY = "shords_user_paper_interactions";
const SESSION_KEY = "shords_current_feed_session_id";

let activeSessionId: string | null = null;

export function getOrCreateFeedSessionId(): string {
  if (!activeSessionId) {
    activeSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }
  return activeSessionId;
}

export function startNewFeedSession(): string {
  activeSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return activeSessionId;
}

export async function logPaperInteractionAsync(
  canonicalPaperId: string,
  eventType: InteractionEventType,
  feedGenerationId: string,
  position?: number,
  source?: string,
  userId: string = "user-1"
): Promise<void> {
  try {
    const record: PaperInteractionRecord = {
      userId,
      canonicalPaperId,
      eventType,
      timestamp: new Date().toISOString(),
      feedSessionId: getOrCreateFeedSessionId(),
      feedGenerationId,
      position,
      source
    };

    const raw = await AsyncStorage.getItem(INTERACTIONS_KEY);
    const existing: PaperInteractionRecord[] = raw ? JSON.parse(raw) : [];
    existing.push(record);

    await AsyncStorage.setItem(INTERACTIONS_KEY, JSON.stringify(existing.slice(-2000)));
  } catch (err) {
    console.warn("Error logging paper interaction:", err);
  }
}

export async function getRecentlySeenCanonicalIdsAsync(limit: number = 200, userId: string = "user-1"): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(INTERACTIONS_KEY);
    if (!raw) return new Set();
    const records: PaperInteractionRecord[] = JSON.parse(raw);
    const seen = new Set<string>();

    const userRecords = records.filter(r => r.userId === userId && (r.eventType === "IMPRESSION" || r.eventType === "OPEN" || r.eventType === "READ_COMPLETE"));
    for (const r of userRecords.slice(-limit)) {
      seen.add(r.canonicalPaperId);
    }
    return seen;
  } catch {
    return new Set();
  }
}

export async function getDismissedCanonicalIdsAsync(userId: string = "user-1"): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(INTERACTIONS_KEY);
    if (!raw) return new Set();
    const records: PaperInteractionRecord[] = JSON.parse(raw);
    const dismissed = new Set<string>();

    for (const r of records.filter(r => r.userId === userId && r.eventType === "DISMISS")) {
      dismissed.add(r.canonicalPaperId);
    }
    return dismissed;
  } catch {
    return new Set();
  }
}
