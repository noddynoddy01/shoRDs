import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { getAllMentors } from "@/services/mentorsStore";
import { getPaperEnquiries, sendPaperEnquiry, PaperEnquiry } from "@/services/enquiryService";
import { Mentor } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";

export default function MentorsScreen() {
  const { colors, fontSizeScale, theme } = useTheme();
  const [activeTab, setActiveTab] = useState<"mentors" | "enquiries" | "collaboration">("mentors");
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null);
  const [mentors, setMentors] = useState<Mentor[]>([]);

  // Enquiry modal state
  const [isEnquiryModalOpen, setIsEnquiryModalOpen] = useState(false);
  const [targetPaperTitle, setTargetPaperTitle] = useState("Attention Is All You Need");
  const [targetAuthor, setTargetAuthor] = useState("Ashish Vaswani et al.");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [enquiries, setEnquiries] = useState<PaperEnquiry[]>([]);

  const styles = getStyles(colors, fontSizeScale, theme);

  useEffect(() => {
    loadEnquiries();
    getAllMentors().then(setMentors);
  }, []);

  const loadEnquiries = async () => {
    const list = await getPaperEnquiries();
    setEnquiries(list);
  };

  const handleSendEnquiry = async () => {
    if (!senderName.trim() || !questionText.trim()) {
      Alert.alert("Required Fields", "Please enter your name and question.");
      return;
    }
    await sendPaperEnquiry(
      "paper-1",
      targetPaperTitle,
      targetAuthor,
      senderName,
      senderEmail || "scholar@shoRDs.app",
      questionText
    );
    Alert.alert("Enquiry Sent", `Your question has been sent to ${targetAuthor}. You will receive a direct notification when answered!`);
    setIsEnquiryModalOpen(false);
    setQuestionText("");
    loadEnquiries();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scholar & Collaboration Hub</Text>
        <Text style={styles.headerSub}>Connect with faculty mentors, send direct paper enquiries, & write joint research.</Text>
      </View>

      {/* Tabs Row */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabBtn, activeTab === "mentors" && styles.tabBtnActive]}
          onPress={() => setActiveTab("mentors")}
        >
          <Text style={[styles.tabBtnText, activeTab === "mentors" && styles.tabBtnTextActive]}>Faculty Mentors</Text>
        </Pressable>

        <Pressable
          style={[styles.tabBtn, activeTab === "enquiries" && styles.tabBtnActive]}
          onPress={() => setActiveTab("enquiries")}
        >
          <Text style={[styles.tabBtnText, activeTab === "enquiries" && styles.tabBtnTextActive]}>Direct Author Q&A</Text>
        </Pressable>

        <Pressable
          style={[styles.tabBtn, activeTab === "collaboration" && styles.tabBtnActive]}
          onPress={() => setActiveTab("collaboration")}
        >
          <Text style={[styles.tabBtnText, activeTab === "collaboration" && styles.tabBtnTextActive]}>Collaboration Hub</Text>
        </Pressable>
      </View>

      {activeTab === "mentors" && (
        <FlatList
          data={mentors}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <View style={styles.mentorCard}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{item.name.split(" ").map(n => n[0]).join("")}</Text>
              </View>

              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.mentorName}>{item.name}</Text>
                  <View style={styles.hindexPill}>
                    <Text style={styles.hindexText}>{item.availability}</Text>
                  </View>
                </View>
                <Text style={styles.mentorDept}>{item.title} · {item.affiliation}</Text>
                <Text style={styles.mentorBio}>{item.bio}</Text>

                <View style={styles.cardActions}>
                  <Pressable style={styles.actionBtnPrimary} onPress={() => setSelectedMentor(item)}>
                    <Ionicons name="calendar-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.actionBtnPrimaryText}>Book Slot</Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionBtnSecondary}
                    onPress={() => {
                      setTargetAuthor(item.name);
                      setTargetPaperTitle(`Research Inquiry for ${item.name}`);
                      setIsEnquiryModalOpen(true);
                    }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.primary} />
                    <Text style={styles.actionBtnSecondaryText}>Ask Author</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {activeTab === "enquiries" && (
        <ScrollView contentContainerStyle={styles.listContainer}>
          <Pressable style={styles.newEnquiryBanner} onPress={() => setIsEnquiryModalOpen(true)}>
            <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.newEnquiryText}>+ Ask Question to Any Research Paper Author</Text>
          </Pressable>

          {enquiries.map((eq) => (
            <View key={eq.id} style={styles.enquiryCard}>
              <View style={styles.enquiryHeader}>
                <Text style={styles.enquiryPaperTitle}>{eq.paperTitle}</Text>
                <View style={[styles.statusBadge, eq.status === "answered" && styles.statusBadgeAnswered]}>
                  <Text style={styles.statusText}>{eq.status.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.enquiryAuthor}>Author: {eq.authorName} · Question from: {eq.senderName}</Text>
              <Text style={styles.enquiryQuestion}>"{eq.questionText}"</Text>

              {eq.replyText && (
                <View style={styles.replyBox}>
                  <Text style={styles.replyTitle}>Author Answer:</Text>
                  <Text style={styles.replyText}>{eq.replyText}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === "collaboration" && (
        <ScrollView contentContainerStyle={styles.listContainer}>
          <View style={styles.collabCard}>
            <Ionicons name="people-outline" size={24} color={colors.primary} />
            <Text style={styles.collabTitle}>Open Literature Review Group</Text>
            <Text style={styles.collabSub}>Join 140+ researchers working on Quantum Surface Error Correction papers.</Text>
            <Pressable style={styles.collabBtn} onPress={() => Alert.alert("Joined Group", "You have joined the Quantum Surface Error Group!")}>
              <Text style={styles.collabBtnText}>Join Group</Text>
            </Pressable>
          </View>

          <View style={styles.collabCard}>
            <Ionicons name="document-text-outline" size={24} color={colors.primary} />
            <Text style={styles.collabTitle}>Joint Grant Writing Project</Text>
            <Text style={styles.collabSub}>Collaborate on Edge AI Optimization grant proposals for upcoming IEEE conferences.</Text>
            <Pressable style={styles.collabBtn} onPress={() => Alert.alert("Request Sent", "Collaboration request sent to lead author!")}>
              <Text style={styles.collabBtnText}>Request Collaboration</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* Direct Author Q&A Modal */}
      <Modal visible={isEnquiryModalOpen} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Ask Direct Question to Author</Text>
            <Text style={styles.modalSub}>Paper: {targetPaperTitle} ({targetAuthor})</Text>

            <TextInput
              value={senderName}
              onChangeText={setSenderName}
              placeholder="Your Full Name (e.g. Abhinav Prakash)"
              placeholderTextColor={colors.subdued}
              style={styles.inputField}
            />

            <TextInput
              value={senderEmail}
              onChangeText={setSenderEmail}
              placeholder="Your Email (e.g. scholar@iiitsurat.ac.in)"
              placeholderTextColor={colors.subdued}
              style={styles.inputField}
            />

            <TextInput
              value={questionText}
              onChangeText={setQuestionText}
              placeholder="Enter your technical question or enquiry..."
              placeholderTextColor={colors.subdued}
              multiline
              numberOfLines={4}
              style={[styles.inputField, { height: 90, textAlignVertical: "top" }]}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setIsEnquiryModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSendBtn} onPress={handleSendEnquiry}>
                <Text style={styles.modalSendText}>Send Enquiry</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    header: {
      padding: spacing.md,
      gap: spacing.xs,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    headerTitle: {
      fontSize: 18 * scale,
      fontWeight: "800",
      color: colors.text
    },
    headerSub: {
      fontSize: 11 * scale,
      color: colors.subdued,
      lineHeight: 16 * scale
    },
    tabRow: {
      flexDirection: "row",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: 8,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    tabBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255,255,255,0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    tabBtnActive: {
      backgroundColor: colors.primary + "1A",
      borderColor: colors.primary + "3D"
    },
    tabBtnText: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.subdued
    },
    tabBtnTextActive: {
      color: colors.primary,
      fontWeight: "800"
    },
    listContainer: {
      padding: spacing.md,
      gap: spacing.md
    },
    mentorCard: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border
    },
    avatarCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + "1A",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.primary + "3D"
    },
    avatarText: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    mentorName: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    hindexPill: {
      backgroundColor: colors.primary + "12",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill
    },
    hindexText: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    mentorDept: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontWeight: "600"
    },
    mentorBio: {
      fontSize: 11 * scale,
      color: colors.muted,
      lineHeight: 16 * scale
    },
    cardActions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 8
    },
    actionBtnPrimary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill
    },
    actionBtnPrimaryText: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: "#FFFFFF"
    },
    actionBtnSecondary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.primary + "12",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary + "2C"
    },
    actionBtnSecondaryText: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    newEnquiryBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary + "12",
      borderWidth: 1,
      borderColor: colors.primary + "2C",
      borderRadius: radius.md,
      padding: spacing.md
    },
    newEnquiryText: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    enquiryCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border
    },
    enquiryHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    enquiryPaperTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text,
      flex: 1
    },
    statusBadge: {
      backgroundColor: "rgba(255,255,255,0.05)",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill
    },
    statusBadgeAnswered: {
      backgroundColor: "rgba(16, 185, 129, 0.15)"
    },
    statusText: {
      fontSize: 8 * scale,
      fontWeight: "800",
      color: colors.muted
    },
    enquiryAuthor: {
      fontSize: 10 * scale,
      color: colors.subdued,
      fontWeight: "600"
    },
    enquiryQuestion: {
      fontSize: 12 * scale,
      color: colors.muted,
      fontStyle: "italic"
    },
    replyBox: {
      backgroundColor: colors.primary + "0A",
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      padding: spacing.sm,
      borderRadius: radius.sm,
      marginTop: 4,
      gap: 2
    },
    replyTitle: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    replyText: {
      fontSize: 11 * scale,
      color: colors.text,
      lineHeight: 16 * scale
    },
    collabCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center"
    },
    collabTitle: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    collabSub: {
      fontSize: 11 * scale,
      color: colors.subdued,
      textAlign: "center"
    },
    collabBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.pill,
      marginTop: 4
    },
    collabBtnText: {
      fontSize: 11 * scale,
      fontWeight: "800",
      color: "#FFFFFF"
    },
    modalBg: {
      flex: 1,
      backgroundColor: "rgba(2,4,10,0.8)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg
    },
    modalBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      gap: 12,
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border
    },
    modalTitle: {
      fontSize: 16 * scale,
      fontWeight: "800",
      color: colors.text
    },
    modalSub: {
      fontSize: 11 * scale,
      color: colors.primary,
      fontWeight: "700"
    },
    inputField: {
      backgroundColor: colors.background,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 12 * scale,
      borderWidth: 1,
      borderColor: colors.border
    },
    modalCancelBtn: {
      flex: 1,
      backgroundColor: "rgba(255,255,255,0.05)",
      paddingVertical: 10,
      borderRadius: radius.md,
      alignItems: "center"
    },
    modalCancelText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.muted
    },
    modalSendBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: 10,
      borderRadius: radius.md,
      alignItems: "center"
    },
    modalSendText: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: "#FFFFFF"
    }
  });
}
