import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { GlassButton } from "@/components/GlassButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius } from "@/constants/theme";
import { getAllMentors, deleteMentor, addMentor } from "@/services/mentorsStore";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { useTheme } from "@/context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Mentor, UserProfile, ChatSession } from "@/types/models";
import { getChatSessions } from "@/services/chatService";

export default function MentorsScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [mentorsList, setMentorsList] = useState<Mentor[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"network" | "chats">("network");
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const { contentBottomPadding } = useFeedMetrics();

  // Form state for new mentor
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [bio, setBio] = useState("");
  const [availability, setAvailability] = useState("");

  const styles = getStyles(colors, fontSizeScale);

  const fetchMentors = useCallback(() => {
    getAllMentors().then(setMentorsList);
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        const parsed = JSON.parse(val) as UserProfile;
        setCurrentUser(parsed);
        setIsAdmin(parsed.role === "admin");
        getChatSessions(parsed.id).then(setChatSessions);
      } else {
        setIsAdmin(false);
        setCurrentUser(null);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchMentors();
    }, [fetchMentors])
  );

  async function connect(mentor: Mentor) {
    if (!currentUser) {
      Alert.alert("Login Required", "Please log in to connect with mentors.");
      router.push("/auth");
      return;
    }

    // Subscription check: Mentors can chat with anyone, normal users need premium
    const { isSubscribed } = await import("@/services/subscriptionService");
    const hasAccess = await isSubscribed();

    if (!hasAccess && currentUser.role === "user") {
      Alert.alert(
        "Subscription Required",
        "Connecting with mentors is a Premium feature. Opt for a subscription to unlock direct guidance.",
        [
          { text: "View Subscriptions", onPress: () => router.push("/paywall" as never) },
          { text: "Cancel", style: "cancel" }
        ]
      );
      return;
    }

    // Create session and go to chat
    const { createChatSession } = await import("@/services/chatService");
    const session = await createChatSession(currentUser.id, currentUser.name, mentor.id, mentor.name);
    router.push(`/chat/${session.id}` as never);
  }

  async function handleDelete(id: string, mentorName: string) {
    Alert.alert(
      "Remove Mentor",
      `Are you sure you want to remove ${mentorName} from the network?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteMentor(id);
            Alert.alert("Removed", `${mentorName} has been removed.`);
            fetchMentors();
          }
        }
      ]
    );
  }

  async function handleAddMentor() {
    if (!name || !title || !focus || !affiliation) {
      Alert.alert("Error", "Please fill in Name, Title, Focus, and Affiliation.");
      return;
    }

    const newMentor: Mentor = {
      id: `mentor-${Date.now()}`,
      name,
      title,
      focus,
      affiliation,
      bio: bio || "Professional researcher ready to guide student publications.",
      availability: availability || "Available upon request"
    };

    await addMentor(newMentor);
    Alert.alert("Success", "New mentor added to the network.");
    setAddModalVisible(false);
    
    // Clear form
    setName("");
    setTitle("");
    setFocus("");
    setAffiliation("");
    setBio("");
    setAvailability("");
    
    fetchMentors();
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          kicker="Mentors"
          title="Learn with researchers who can guide your next paper"
          subtitle="Connect for paper framing, readable summaries, experiments, and publication direction."
        />

        {/* Sub-tab Toggle */}
        <View style={styles.segment}>
          <Pressable
            onPress={() => setActiveSubTab("network")}
            style={[styles.segmentButton, activeSubTab === "network" && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, activeSubTab === "network" && styles.segmentTextActive]}>
              Explore Mentors
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setActiveSubTab("chats");
              if (currentUser) {
                getChatSessions(currentUser.id).then(setChatSessions);
              }
            }}
            style={[styles.segmentButton, activeSubTab === "chats" && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, activeSubTab === "chats" && styles.segmentTextActive]}>
              Chats ({chatSessions.length})
            </Text>
          </Pressable>
        </View>

        {activeSubTab === "chats" ? (
          <View style={styles.chatsList}>
            {chatSessions.length ? (
              chatSessions.map((session) => {
                const partnerName = session.participantNames.find((n) => n !== currentUser?.name) || "Chat Room";
                return (
                  <Pressable
                    key={session.id}
                    style={styles.chatCard}
                    onPress={() => router.push(`/chat/${session.id}` as never)}
                  >
                    <View style={styles.chatAvatar}>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accentSoft} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.chatPartner}>{partnerName}</Text>
                      <Text style={styles.chatLastMsg} numberOfLines={1}>
                        {session.lastMessageText}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.subdued} />
                  </Pressable>
                );
              })
            ) : (
              <Text style={styles.emptyChats}>
                No conversations yet. Connect with a mentor under Explore Mentors to start a scholarly discussion.
              </Text>
            )}
          </View>
        ) : (
          <>
            {isAdmin && (
              <GlassButton
                title="Onboard New Mentor"
                icon="person-add-outline"
                onPress={() => setAddModalVisible(true)}
                style={styles.onboardBtn}
              />
            )}

            <View style={styles.cards}>
              {mentorsList.map((mentor) => {
                // If current user is a mentor, don't display themselves in the lists
                if (currentUser && currentUser.id === mentor.id) return null;
                
                return (
                  <View key={mentor.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.avatar}>
                        <Ionicons name="person" color={colors.accentSoft} size={24} />
                      </View>
                      {isAdmin && (
                        <Pressable style={styles.deleteBtn} onPress={() => handleDelete(mentor.id, mentor.name)}>
                          <Ionicons name="trash-outline" color="#EF4444" size={20} />
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.name}>{mentor.name}</Text>
                    <Text style={styles.title}>{mentor.title}</Text>
                    <Text style={styles.focus}>{mentor.focus}</Text>
                    <Text style={styles.bio}>{mentor.bio}</Text>
                    <View style={styles.meta}>
                      <Ionicons name="time-outline" color={colors.subdued} size={15} />
                      <Text style={styles.availability}>{mentor.availability}</Text>
                    </View>
                    <GlassButton
                      title="Connect"
                      icon="chatbubble-ellipses-outline"
                      onPress={() => connect(mentor)}
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={styles.contactPanel}>
          <Text style={styles.contactTitle}>Need the shoRDs team?</Text>
          <Text style={styles.contactText}>Reach out for mentor onboarding or research upload support.</Text>
          <GlassButton
            title="Open Contact Page"
            icon="call-outline"
            variant="quiet"
            onPress={() => router.push("/(tabs)/contact" as never)}
          />
        </View>
      </ScrollView>

      {/* Add Mentor Modal */}
      <Modal visible={addModalVisible} animationType="slide" transparent={true} onRequestClose={() => setAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Onboard Mentor</Text>
              <Pressable style={styles.closeBtn} onPress={() => setAddModalVisible(false)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false}>
              <TextInput value={name} onChangeText={setName} placeholder="Mentor Full Name" placeholderTextColor={colors.subdued} style={styles.input} />
              <TextInput value={title} onChangeText={setTitle} placeholder="Title (e.g. Associate Professor)" placeholderTextColor={colors.subdued} style={styles.input} />
              <TextInput value={affiliation} onChangeText={setAffiliation} placeholder="Affiliation (e.g. IIIT Surat)" placeholderTextColor={colors.subdued} style={styles.input} />
              <TextInput value={focus} onChangeText={setFocus} placeholder="Research Focus (Guidance fields)" placeholderTextColor={colors.subdued} style={styles.input} />
              <TextInput value={bio} onChangeText={setBio} placeholder="Short Bio" placeholderTextColor={colors.subdued} multiline numberOfLines={3} style={[styles.input, styles.textArea]} />
              <TextInput value={availability} onChangeText={setAvailability} placeholder="Availability (e.g. Mon/Wed evenings)" placeholderTextColor={colors.subdued} style={styles.input} />

              <GlassButton title="Submit Onboarding" icon="checkmark-circle-outline" onPress={handleAddMentor} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// Global sharing import fix
import { Share } from "react-native";

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    content: {
      padding: 18,
      gap: 18
    },
    onboardBtn: {
      marginBottom: 6
    },
    cards: {
      gap: 14
    },
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 18,
      gap: 10,
      shadowColor: colors.accent,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 }
    },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardElevated,
      alignItems: "center",
      justifyContent: "center"
    },
    deleteBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: "rgba(239, 68, 68, 0.08)",
      borderColor: "rgba(239, 68, 68, 0.2)",
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    name: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800",
      textTransform: "uppercase"
    },
    title: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "700",
      textTransform: "uppercase"
    },
    focus: {
      color: colors.text,
      fontSize: 14 * scale,
      lineHeight: 20 * scale,
      fontWeight: "700"
    },
    bio: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    },
    meta: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center"
    },
    availability: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "600",
      flex: 1
    },
    contactPanel: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      padding: 18,
      gap: 10
    },
    contactTitle: {
      color: colors.text,
      fontSize: 17 * scale,
      fontWeight: "800"
    },
    contactText: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(11, 16, 32, 0.45)",
      justifyContent: "flex-end"
    },
    modalSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 20,
      paddingBottom: 28,
      paddingTop: 10,
      maxHeight: "85%"
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800"
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    formScroll: {
      gap: 12
    },
    input: {
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.text,
      paddingHorizontal: 14,
      fontSize: 14 * scale,
      fontWeight: "600"
    },
    textArea: {
      height: 90,
      paddingTop: 12,
      textAlignVertical: "top"
    },
    segment: {
      flexDirection: "row",
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      padding: 4,
      marginBottom: 14
    },
    segmentButton: {
      flex: 1,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm
    },
    segmentActive: {
      backgroundColor: colors.cardElevated,
      shadowColor: colors.accent,
      shadowOpacity: 0.1,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 }
    },
    segmentText: {
      color: colors.muted,
      fontSize: 14 * scale,
      fontWeight: "700"
    },
    segmentTextActive: {
      color: colors.accentSoft
    },
    chatsList: {
      gap: 12
    },
    chatCard: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      gap: 12
    },
    chatAvatar: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      borderColor: "rgba(6, 182, 212, 0.15)",
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    chatPartner: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "700"
    },
    chatLastMsg: {
      color: colors.muted,
      fontSize: 13 * scale
    },
    emptyChats: {
      color: colors.subdued,
      fontSize: 14 * scale,
      textAlign: "center",
      paddingVertical: 32,
      lineHeight: 20 * scale
    }
  });
}
