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
  Clipboard,
  Alert,
  ScrollView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius } from "@/constants/theme";
import { getMessages, sendMessage } from "@/services/chatService";
import { getCurrentUser } from "@/services/subscriptionService";
import { Message, UserProfile, Mentor } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // Chat session ID
  const { colors, fontSizeScale, theme } = useTheme();
  
  // Core states
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [mentorProfile, setMentorProfile] = useState<Mentor | null>(null);
  const [chatPartnerName, setChatPartnerName] = useState("Research Mentor");

  // Advanced Interactive features
  const [isTyping, setIsTyping] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimer = useRef<any>(null);

  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const styles = getStyles(colors, fontSizeScale, theme);

  // Suggestions for rapid academic chats
  const chatSuggestions = [
    "What dataset was used?",
    "Explain the math formulas",
    "How to frame a good hypothesis?",
    "Suggest future directions"
  ];

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        setCurrentUser(user);
        
        // Load messages
        getMessages(id).then(setMessages);

        // Fetch details of active mentor
        AsyncStorage.getItem("shords.chatSessions").then((raw) => {
          if (raw) {
            try {
              const sessions = JSON.parse(raw);
              const session = sessions.find((s: any) => s.id === id);
              if (session) {
                const partnerName = session.participantNames.find((name: string) => name !== user.name);
                if (partnerName) setChatPartnerName(partnerName);

                // Fetch mentor profile matching name to extract research focus
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

    // Poll for new messages every 3 seconds for mock real-time updates
    const interval = setInterval(() => {
      getMessages(id).then((msgs) => {
        if (msgs.length !== messages.length) {
          setMessages(msgs);
        }
      });
    }, 3000);

    return () => {
      clearInterval(interval);
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [id, messages.length]);

  // Handle pulsing typing indicator
  useEffect(() => {
    if (isTyping) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isTyping]);

  // Main sendMessage trigger + AI response router
  async function handleSend(textToSend?: string) {
    const text = textToSend || inputText.trim();
    if (!text || !currentUser) return;

    if (!textToSend) setInputText("");

    // 1. Save user's message
    const userMsg = await sendMessage(id, currentUser.id, text);
    setMessages((current) => [...current, userMsg]);
    scrollToBottom();

    // 2. Trigger AI Mentor response after small typing delay
    setIsTyping(true);
    setTimeout(async () => {
      try {
        const responseText = await queryAIMentor(text);
        // Save mentor's reply (mentor's ID is derived from chat partner name)
        const mentorId = mentorProfile?.id || "mentor-ai";
        const mentorMsg = await sendMessage(id, mentorId, responseText);
        
        setMessages((current) => [...current, mentorMsg]);
        scrollToBottom();
      } catch (err) {
        console.warn("AI response generation failed:", err);
      } finally {
        setIsTyping(false);
      }
    }, 2000);
  }

  // Core AI Mentor response generation
  async function queryAIMentor(userText: string): Promise<string> {
    const aiSource = await AsyncStorage.getItem("shords.aiSource") || "heuristic";
    const mentorName = chatPartnerName;
    const mentorFocus = mentorProfile?.focus || "advanced engineering research";

    if (aiSource === "self-hosted") {
      const serverUrl = await AsyncStorage.getItem("shords.serverUrl") || "http://192.168.1.100:8000";
      const endpoint = `${serverUrl.replace(/\/$/, "")}/chat`;
      try {
        const payload = {
          messages: [{ role: "user", content: userText }],
          persona: `You are Dr. ${mentorName}, an academic mentor specializing in ${mentorFocus}.`
        };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const data = await response.json();
          return data.text;
        }
      } catch (e) {
        console.warn("Self-hosted chat failed, fallback to local:", e);
      }
    } else if (aiSource === "gemini") {
      const geminiKey = await AsyncStorage.getItem("shords.geminiKey");
      if (geminiKey) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        try {
          const prompt = `You are Dr. ${mentorName}, a scholarly research mentor specializing in ${mentorFocus}. Tonal guidelines: encouraging, brief, technical. Respond to the student's question: "${userText}". Keep it under 3 sentences.`;
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          });
          if (response.ok) {
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "Let's investigate the paper parameters.";
          }
        } catch (e) {
          console.warn("Gemini chat failed, fallback to local:", e);
        }
      }
    }

    // Heuristic Fallback summaries
    const query = userText.toLowerCase();
    if (query.includes("dataset") || query.includes("data") || query.includes("test")) {
      return `For research in ${mentorFocus}, datasets are usually gathered from reference IEEE standard files or open-source repositories. Let's make sure our training split is robust.`;
    }
    if (query.includes("math") || query.includes("formula") || query.includes("equation")) {
      return "The core math formulation isolates sparse attention blocks, projecting them in linear vector grids. Try sketching the coordinate offsets first.";
    }
    if (query.includes("hypothesis") || query.includes("how to") || query.includes("frame")) {
      return "A strong hypothesis isolates one dependent variable. Focus on comparing execution speeds or accuracy levels under constrained device parameters.";
    }
    return `That's an interesting question regarding our ${mentorFocus} projects. I recommend analyzing the results tab of our stack to trace the exact performance changes.`;
  }

  // Simulated recording voice message
  function toggleVoiceRecord() {
    if (recordingVoice) {
      // Stop recording and send mock voice message
      setRecordingVoice(false);
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      
      const durationStr = `0:${recordingDuration < 10 ? "0" : ""}${recordingDuration}`;
      handleSend(`🎤 Sent Voice Summary (${durationStr})`);
      setRecordingDuration(0);
    } else {
      // Start recording
      setRecordingVoice(true);
      setRecordingDuration(0);
      recordingTimer.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    }
  }

  // Mock Paper attachments
  function handleAttachDocument() {
    Alert.alert(
      "Attach Research Element",
      "Attach documents or figures to your scholarly conversation:",
      [
        { text: "Attach Paper Draft.pdf", onPress: () => handleSend("📄 Attached document: research_draft_v1.pdf") },
        { text: "Attach Figure Graph.png", onPress: () => handleSend("🖼️ Attached figure: results_chart_1.png") },
        { text: "Cancel", style: "cancel" }
      ]
    );
  }

  function scrollToBottom() {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }

  function formatTime(timestamp: number) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Helper: Copy code snippet to clipboard
  const copyCode = (codeText: string) => {
    Clipboard.setString(codeText);
    Alert.alert("Code Copied", "Technical snippet copied to clipboard.");
  };

  // Custom Message Bubble Renderer (supports code block highlights)
  const renderMessageContent = (msgText: string, isMe: boolean) => {
    const isCode = msgText.includes("```");
    if (isCode) {
      const parts = msgText.split("```");
      const codeSnippet = parts[1] || "";
      return (
        <View style={styles.codeMessageContainer}>
          <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {parts[0]}
          </Text>
          <View style={styles.codeBlock}>
            <View style={styles.codeHeader}>
              <Text style={styles.codeHeaderText}>Code Snippet</Text>
              <Pressable onPress={() => copyCode(codeSnippet)}>
                <Ionicons name="copy-outline" size={14} color="#94A3B8" />
              </Pressable>
            </View>
            <Text style={styles.codeText}>{codeSnippet.trim()}</Text>
          </View>
          <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {parts[2]}
          </Text>
        </View>
      );
    }

    // Attachment text
    const isAttachment = msgText.startsWith("📄") || msgText.startsWith("🖼️");
    if (isAttachment) {
      return (
        <View style={styles.attachmentBubble}>
          <Ionicons
            name={msgText.startsWith("📄") ? "document-text" : "image"}
            size={24}
            color={isMe ? "#FFFFFF" : colors.accentSoft}
          />
          <Text style={[styles.attachmentText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {msgText}
          </Text>
        </View>
      );
    }

    return (
      <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
        {msgText}
      </Text>
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Modern Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.avatar}>
            <Ionicons name="school" size={20} color={colors.accentSoft} />
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{chatPartnerName}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={[styles.onlineDot, isTyping && styles.typingDot]} />
              <Text style={styles.headerStatus}>{isTyping ? "typing..." : "online"}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={styles.actionHeaderBtn} onPress={() => Alert.alert("Mentor Call", "Simulating secure voice call...")}>
              <Ionicons name="call-outline" size={18} color={colors.text} />
            </Pressable>
            <Pressable style={styles.actionHeaderBtn} onPress={() => Alert.alert("Mentor Class", "Simulating video blackboard class...")}>
              <Ionicons name="videocam-outline" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Message Feed */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isMe = item.senderId === currentUser?.id;
            return (
              <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowOther]}>
                {!isMe && (
                  <View style={styles.avatarMini}>
                    <Ionicons name="person" size={12} color={colors.accentSoft} />
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  {renderMessageContent(item.text, isMe)}
                  <Text style={[styles.messageTime, isMe ? styles.messageTimeMe : styles.messageTimeOther]}>
                    {formatTime(item.timestamp)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* Typing Bubble */}
        {isTyping && (
          <View style={styles.typingIndicatorRow}>
            <View style={styles.avatarMini}>
              <Ionicons name="person" size={12} color={colors.accentSoft} />
            </View>
            <Animated.View style={[styles.typingBubble, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.typingDotItem} />
              <View style={[styles.typingDotItem, { opacity: 0.6 }]} />
              <View style={[styles.typingDotItem, { opacity: 0.3 }]} />
            </Animated.View>
          </View>
        )}

        {/* Quick Suggestion Chips */}
        <View style={styles.suggestionsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
            {chatSuggestions.map((item) => (
              <Pressable key={item} style={styles.suggestionChip} onPress={() => handleSend(item)}>
                <Text style={styles.suggestionText}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Input area */}
        <View style={styles.inputArea}>
          <Pressable style={styles.attachBtn} onPress={handleAttachDocument}>
            <Ionicons name="add" size={20} color={colors.text} />
          </Pressable>
          
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={recordingVoice ? "Recording Audio readout..." : "Type technical question..."}
            placeholderTextColor={colors.subdued}
            style={[styles.input, recordingVoice && styles.inputRecording]}
            multiline
            editable={!recordingVoice}
          />

          <Pressable
            style={[styles.voiceBtn, recordingVoice && styles.voiceBtnActive]}
            onPress={toggleVoiceRecord}
          >
            <Ionicons name={recordingVoice ? "stop" : "mic"} size={20} color={recordingVoice ? "#EF4444" : colors.text} />
          </Pressable>

          <Pressable
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.background
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      borderColor: "rgba(6, 182, 212, 0.15)",
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    headerInfo: {
      flex: 1
    },
    headerTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    headerStatus: {
      color: colors.success,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    onlineDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success
    },
    typingDot: {
      backgroundColor: colors.accentSoft
    },
    actionHeaderBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    messagesList: {
      padding: 14,
      gap: 12,
      flexGrow: 1
    },
    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      maxWidth: "85%"
    },
    messageRowMe: {
      alignSelf: "flex-end",
      flexDirection: "row-reverse"
    },
    messageRowOther: {
      alignSelf: "flex-start"
    },
    avatarMini: {
      width: 24,
      height: 24,
      borderRadius: 8,
      backgroundColor: "rgba(6, 182, 212, 0.05)",
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    bubble: {
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 4
    },
    bubbleMe: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 2
    },
    bubbleOther: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomLeftRadius: 2
    },
    messageText: {
      fontSize: 13 * scale,
      lineHeight: 18 * scale
    },
    messageTextMe: {
      color: "#FFFFFF"
    },
    messageTextOther: {
      color: colors.text
    },
    messageTime: {
      fontSize: 9 * scale,
      alignSelf: "flex-end",
      marginTop: 2
    },
    messageTimeMe: {
      color: "rgba(255,255,255,0.7)"
    },
    messageTimeOther: {
      color: colors.subdued
    },
    // Typing indicator
    typingIndicatorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 14,
      paddingBottom: 6
    },
    typingBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.pill
    },
    typingDotItem: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.accentSoft
    },
    // Suggestions
    suggestionsContainer: {
      paddingVertical: 6,
      backgroundColor: colors.background
    },
    suggestionsScroll: {
      paddingHorizontal: 14,
      gap: 8
    },
    suggestionChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1
    },
    suggestionText: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    // Code blocks formatting
    codeMessageContainer: {
      gap: 6,
      width: "100%"
    },
    codeBlock: {
      backgroundColor: "#0F172A",
      borderRadius: radius.sm,
      padding: 10,
      marginVertical: 4
    },
    codeHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: "#1E293B",
      paddingBottom: 6,
      marginBottom: 6
    },
    codeHeaderText: {
      color: "#94A3B8",
      fontSize: 10 * scale,
      fontFamily: "monospace"
    },
    codeText: {
      color: "#38BDF8",
      fontFamily: "monospace",
      fontSize: 11 * scale,
      lineHeight: 16
    },
    // Attachments
    attachmentBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4
    },
    attachmentText: {
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    // Input Area
    inputArea: {
      flexDirection: "row",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
      alignItems: "center",
      gap: 8
    },
    attachBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 80,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.text,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 13 * scale,
      fontWeight: "600"
    },
    inputRecording: {
      backgroundColor: "rgba(239, 68, 68, 0.05)",
      borderColor: "rgba(239, 68, 68, 0.2)",
      color: "#EF4444"
    },
    voiceBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    voiceBtnActive: {
      borderColor: "#EF4444",
      backgroundColor: "rgba(239, 68, 68, 0.08)"
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.primary,
      shadowOpacity: 0.2,
      shadowRadius: 5,
      elevation: 2
    },
    sendBtnDisabled: {
      backgroundColor: colors.subdued,
      opacity: 0.5,
      shadowOpacity: 0,
      elevation: 0
    }
  });
}
