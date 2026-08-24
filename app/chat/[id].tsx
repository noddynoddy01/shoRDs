import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  ScrollView,
  Dimensions,
  ActivityIndicator
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { getMessages, sendMessage } from "@/services/chatService";
import { getCurrentUser } from "@/services/subscriptionService";
import { Message, UserProfile, Mentor } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, fontSizeScale, theme } = useTheme();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [mentorProfile, setMentorProfile] = useState<Mentor | null>(null);
  const [chatPartnerName, setChatPartnerName] = useState("Research Mentor");

  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const styles = getStyles(colors, fontSizeScale, theme);

  const chatSuggestions = [
    "Explain key results of my paper",
    "How to frame research methodology?",
    "Suggest related datasets",
    "Simplify scientific terms used here",
    "Onboard new peer researchers"
  ];

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setCurrentUser(user);
        getMessages(id).then(setMessages);

        AsyncStorage.getItem("shords.chatSessions").then((raw) => {
          if (raw) {
            try {
              const sessions = JSON.parse(raw);
              const session = sessions.find((s: any) => s.id === id);
              if (session) {
                const rawPartnerName = session.participantNames.find((name: string) => name !== user.name);
                const isAiSession =
                  session.participants?.includes("abhinav-ai") ||
                  rawPartnerName?.toLowerCase().includes("abhinav") ||
                  rawPartnerName === "AI Bot";
                const partnerName = isAiSession ? "AI Bot" : rawPartnerName;
                if (partnerName) setChatPartnerName(partnerName);

                import("@/services/mentorsStore").then(({ getAllMentors }) => {
                  getAllMentors().then((mentors) => {
                    const match = mentors.find((m) => m.name === partnerName);
                    if (match) setMentorProfile(match);
                  });
                });
              }
            } catch (err) {
              console.warn("Chat setup error:", err);
            }
          }
        });
      }
    });

    const interval = setInterval(() => {
      getMessages(id).then((msgs) => {
        if (msgs.length !== messages.length) {
          setMessages(msgs);
        }
      });
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [id, messages.length]);

  async function handleSend(textToSend?: string) {
    const text = textToSend || inputText.trim();
    if (!text || !currentUser) return;

    if (!textToSend) setInputText("");

    const userMsg = await sendMessage(id, currentUser.id, text);
    setMessages((current) => [...current, userMsg]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    setIsTyping(true);
    setTimeout(async () => {
      try {
        const responseText = await queryAIMentor(text);
        const mentorId = mentorProfile?.id || "mentor-ai";
        const mentorMsg = await sendMessage(id, mentorId, responseText);
        
        setMessages((current) => [...current, mentorMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (err) {
        console.warn("AI response generation failed:", err);
      } finally {
        setIsTyping(false);
      }
    }, 1800);
  }

  async function queryAIMentor(userText: string): Promise<string> {
    const aiSource = await AsyncStorage.getItem("shords.aiSource") || "heuristic";
    if (aiSource === "self-hosted") {
      const serverUrl = await AsyncStorage.getItem("shords.serverUrl") || "http://192.168.1.100:8000";
      const endpoint = `${serverUrl.replace(/\/$/, "")}/chat`;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: userText }]
          })
        });
        if (response.ok) {
          const data = await response.json();
          return data.text;
        }
      } catch (e) {
        console.warn("Self-hosted connection fail:", e);
      }
    } else if (aiSource === "gemini") {
      const geminiKey = await AsyncStorage.getItem("shords.geminiKey");
      if (geminiKey) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        try {
          const context = `You are the AI Bot inside shoRDs. User query: "${userText}". Speak in 2 concise sentences.`;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: context }] }] })
          });
          if (response.ok) {
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || getHeuristicResponse(userText);
          }
        } catch (e) {
          console.warn("Gemini connection fail:", e);
        }
      }
    }
    return getHeuristicResponse(userText);
  }

  function getHeuristicResponse(userText: string): string {
    const query = userText.toLowerCase();
    if (query.match(/^(hi|hey|hello|hii)\b/)) {
      return "Hello! I am your research advisor. Feel free to ask details about mathematical equations, methodologies, or publication rules.";
    }
    if (query.includes("methodology") || query.includes("methods")) {
      return "A standard research methodology outlines parameters, verification plans, and controls. Focus on reproducibility of results.";
    }
    if (query.includes("dataset") || query.includes("data")) {
      return "I suggest searching repository structures on Hugging Face, Kaggle Academic, or Google Dataset Search.";
    }
    return "Understood. Let's draft your next section or review paper abstracts. What specifically should we analyze?";
  }

  const formatMsgTime = (timestamp: string | number) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return "";
    }
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isMe = item.senderId === currentUser?.id;
    const senderName = isMe ? "You" : chatPartnerName;
    const time = formatMsgTime(item.timestamp);

    // Render code blocks if double backticks are detected
    const containsCode = item.text.includes("```");
    
    return (
      <View style={styles.threadItem}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarInitials}>
            {senderName.split(" ").map(n => n[0]).slice(0, 2).join("")}
          </Text>
        </View>

        <View style={styles.threadMessageBody}>
          <View style={styles.threadMetaRow}>
            <Text style={[styles.senderNameText, isMe && { color: colors.primary }]}>{senderName}</Text>
            <Text style={styles.timeText}>{time}</Text>
          </View>

          {containsCode ? (
            <View style={styles.codeContainer}>
              <Text style={styles.codeMessageText}>{item.text.replace(/```/g, "")}</Text>
            </View>
          ) : (
            <Text style={styles.messageText}>{item.text}</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" color={colors.text} size={20} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{chatPartnerName}</Text>
          <View style={styles.statusRow}>
            <View style={styles.activeIndicator} />
            <Text style={styles.statusText}>Active Advisor</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.scrollList}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            isTyping ? (
              <View style={styles.typingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.typingText}>Drafting thesis analysis...</Text>
              </View>
            ) : null
          }
        />

        {/* Suggestions */}
        <View style={styles.suggestionsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
            {chatSuggestions.map((s, idx) => (
              <Pressable key={idx} style={styles.suggestionChip} onPress={() => handleSend(s)}>
                <Text style={styles.suggestionChipText}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Discuss methodology..."
            placeholderTextColor={colors.subdued}
            style={styles.chatInput}
            multiline
          />
          <Pressable
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    header: {
      height: 56,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    backBtn: {
      padding: 4,
      marginRight: 10
    },
    headerInfo: {
      flex: 1
    },
    headerTitle: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4
    },
    activeIndicator: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success
    },
    statusText: {
      fontSize: 9 * scale,
      color: colors.success,
      fontWeight: "700"
    },
    scrollList: {
      padding: spacing.md,
      gap: 16,
      flexGrow: 1
    },
    threadItem: {
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start"
    },
    avatarCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.02)",
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    avatarInitials: {
      fontSize: 11 * scale,
      fontWeight: "800",
      color: colors.muted
    },
    threadMessageBody: {
      flex: 1,
      gap: 4
    },
    threadMetaRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8
    },
    senderNameText: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.text
    },
    timeText: {
      fontSize: 9 * scale,
      color: colors.subdued
    },
    messageText: {
      fontSize: 13 * scale,
      lineHeight: 18 * scale,
      color: colors.muted
    },
    codeContainer: {
      backgroundColor: "#030712",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: 10,
      marginVertical: 4
    },
    codeMessageText: {
      fontSize: 11 * scale,
      fontFamily: "monospace",
      color: colors.accentSoft,
      lineHeight: 16
    },
    typingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8
    },
    typingText: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontWeight: "700"
    },
    suggestionsContainer: {
      paddingVertical: spacing.xs,
      borderTopWidth: 1,
      borderColor: colors.border
    },
    suggestionsScroll: {
      paddingHorizontal: spacing.md,
      gap: 8
    },
    suggestionChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255,255,255,0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    suggestionChipText: {
      fontSize: 10 * scale,
      color: colors.muted,
      fontWeight: "700"
    },
    inputBar: {
      flexDirection: "row",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderTopWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.surface
    },
    chatInput: {
      flex: 1,
      minHeight: 38,
      maxHeight: 80,
      borderRadius: radius.md,
      backgroundColor: "rgba(255,255,255,0.015)",
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 8,
      fontSize: 13 * scale,
      fontWeight: "600"
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center"
    },
    sendBtnDisabled: {
      opacity: 0.4
    }
  });
}
