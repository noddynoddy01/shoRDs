import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChatSession, Message } from "@/types/models";

const SESSIONS_KEY = "shords.chatSessions";
const MESSAGES_PREFIX = "shords.chatMessages.";

export async function getChatSessions(userId: string): Promise<ChatSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const allSessions = JSON.parse(raw) as ChatSession[];
    return allSessions.filter((s) => s.participants.includes(userId));
  } catch {
    return [];
  }
}

export async function createChatSession(
  user1Id: string,
  user1Name: string,
  user2Id: string,
  user2Name: string
): Promise<ChatSession> {
  const sessionId = [user1Id, user2Id].sort().join("-");
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  let sessions: ChatSession[] = [];
  
  if (raw) {
    try {
      sessions = JSON.parse(raw) as ChatSession[];
    } catch {
      sessions = [];
    }
  }

  const existing = sessions.find((s) => s.id === sessionId);
  if (existing) return existing;

  const newSession: ChatSession = {
    id: sessionId,
    participants: [user1Id, user2Id],
    participantNames: [user1Name, user2Name],
    lastMessageText: "Conversation started",
    lastMessageTimestamp: Date.now(),
    unreadCount: 0
  };

  sessions.unshift(newSession);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  return newSession;
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const raw = await AsyncStorage.getItem(MESSAGES_PREFIX + sessionId);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

export async function sendMessage(
  sessionId: string,
  senderId: string,
  text: string
): Promise<Message> {
  const newMessage: Message = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    senderId,
    text,
    timestamp: Date.now()
  };

  // 1. Save message to list
  const currentMessages = await getMessages(sessionId);
  const nextMessages = [...currentMessages, newMessage];
  await AsyncStorage.setItem(MESSAGES_PREFIX + sessionId, JSON.stringify(nextMessages));

  // 2. Update session last message info
  const rawSessions = await AsyncStorage.getItem(SESSIONS_KEY);
  if (rawSessions) {
    try {
      const sessions = JSON.parse(rawSessions) as ChatSession[];
      const nextSessions = sessions.map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            lastMessageText: text,
            lastMessageTimestamp: Date.now()
          };
        }
        return s;
      });
      // Move active session to top
      const targetSession = nextSessions.find((s) => s.id === sessionId);
      const remainingSessions = nextSessions.filter((s) => s.id !== sessionId);
      if (targetSession) {
        await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify([targetSession, ...remainingSessions]));
      }
    } catch (err) {
      console.warn("Failed to update chat session meta:", err);
    }
  }

  return newMessage;
}
