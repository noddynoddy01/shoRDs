import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Animated, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";
import { Paper } from "@/types/models";
import { isPaperSaved, toggleSavedPaper } from "@/services/savedPapers";
import { Chip } from "./Chip";
import { GlassButton } from "./GlassButton";
import { ResearchIllustration } from "./ResearchIllustration";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isSubscribed, hasFreeViewsRemaining } from "@/services/subscriptionService";

type ReelCardProps = {
  paper: Paper;
  height: number;
  index: number;
  onDelete?: () => void;
};

export function ReelCard({ paper, height, index, onDelete }: ReelCardProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const [saved, setSaved] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const entrance = useRef(new Animated.Value(0)).current;

  const styles = getStyles(colors, fontSizeScale, theme);

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 480,
      useNativeDriver: true
    }).start();
  }, [entrance, paper.id]);

  useEffect(() => {
    isPaperSaved(paper.id).then(setSaved);
    
    // Check if user has permission to delete this paper
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        const parsed = JSON.parse(val);
        setCanDelete(parsed.role === "admin" || parsed.id === paper.authorId || paper.authorId === "local-uploader");
      } else {
        setCanDelete(paper.authorId === "local-uploader");
      }
    });

    // Check lock status
    async function checkLock() {
      const premium = await isSubscribed();
      if (premium) {
        setIsLocked(false);
      } else {
        const remaining = await hasFreeViewsRemaining();
        const viewedPapersJson = await AsyncStorage.getItem("shords.viewedPapers") || "[]";
        const viewedPapers = JSON.parse(viewedPapersJson) as string[];
        const alreadyViewed = viewedPapers.includes(paper.id);
        setIsLocked(!remaining && !alreadyViewed);
      }
    }
    checkLock();
  }, [paper.id, paper.authorId]);

  async function sharePaper() {
    const shareMessage = `📚 Discover Research on shoRDs!
 
🔍 Title: ${paper.title}
🔬 Domain: ${paper.domain}
✍️ Author: ${paper.authorName} (${paper.authorRole})
⏱️ Reading Time: ${paper.readingTime}
 
📖 Brief Summary:
"${paper.summary}"
 
💡 Read the full interactive technical brief on shoRDs!
🔗 Link: ${paper.originalLink}
 
Download shoRDs for quick, simplified, and technical research updates! 🚀`;

    await Share.share({
      title: paper.title,
      message: shareMessage
    });
  }

  async function toggleSave() {
    const next = await toggleSavedPaper(paper.id);
    setSaved(next);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.18, duration: 120, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 120, useNativeDriver: true })
    ]).start();
  }

  async function handleDelete() {
    Alert.alert(
      "Delete Paper",
      "Are you sure you want to delete this research brief from the feed? This action is permanent.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { deletePaper } = await import("@/services/papersStore");
            await deletePaper(paper.id);
            Alert.alert("Success", "Research brief removed successfully.");
            if (onDelete) onDelete();
          }
        }
      ]
    );
  }

  const handleCardPress = () => {
    if (isLocked) {
      router.push("/paywall" as never);
    } else {
      router.push(`/paper/${paper.id}` as never);
    }
  };

  return (
    <Animated.View
      style={[
        styles.frame,
        {
          height,
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }]
        }
      ]}
    >
      <View style={styles.card}>
        <LinearGradient
          colors={colors.cardGradient as any}
          style={StyleSheet.absoluteFill}
        />

        {/* Lock Overlay */}
        {isLocked && (
          <View style={styles.lockOverlay}>
            <Ionicons name="lock-closed-outline" size={48} color={colors.accentSoft} />
            <Text style={styles.lockTitle}>Premium Research Journal</Text>
            <Text style={styles.lockDesc}>
              You have viewed your limit of 5 free research papers. Upgrade to Premium for unlimited access, expert chats, and translations.
            </Text>
            <GlassButton
              title="Unlock Premium"
              icon="sparkles"
              onPress={() => router.push("/paywall" as never)}
              style={styles.lockBtn}
            />
          </View>
        )}

        <View style={styles.topMeta}>
          <Text style={styles.stackLabel}>STACK {String(index + 1).padStart(2, "0")}</Text>
          <Text style={styles.readingTime}>{paper.readingTime}</Text>
        </View>

        <Pressable style={styles.body} onPress={handleCardPress} disabled={false}>
          {/* Authentic Journal Header */}
          <View style={styles.journalHeader}>
            <Text style={styles.journalName}>{paper.organization || "ACADEMIC PUBLICATION"}</Text>
            <View style={styles.journalSubHeader}>
              {paper.pubYear && (
                <>
                  <Text style={styles.journalYear}>{paper.pubYear}</Text>
                  <Text style={styles.journalDot}>•</Text>
                </>
              )}
              {paper.doi && (
                <Text style={styles.journalDoi} numberOfLines={1}>DOI: {paper.doi}</Text>
              )}
            </View>
          </View>

          {/* Authentic Heading Cutout */}
          <View style={styles.cutoutBlock}>
            <Text style={styles.cutoutTitle} numberOfLines={3}>{paper.title}</Text>
          </View>

          <Text style={styles.summary} numberOfLines={2}>{paper.summary}</Text>

          {/* Dynamic Vector Illustration */}
          {paper.illustrations && paper.illustrations.length > 0 && (
            <ResearchIllustration dataString={paper.illustrations[0]} />
          )}

          {/* Highlights / Bullet Insights */}
          {paper.insights && paper.insights.length > 0 && (
            <View style={styles.insightsContainer}>
              <Text style={styles.insightsLabel}>KEY HIGHLIGHTS</Text>
              {paper.insights.slice(0, 2).map((insight, idx) => (
                <View key={idx} style={styles.insightRow}>
                  <Text style={styles.insightBullet}>✦</Text>
                  <Text style={styles.insightText} numberOfLines={1}>{insight}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Media Indicators */}
          <View style={styles.mediaIndicators}>
            {paper.audioUrl && (
              <View style={styles.mediaPill}>
                <Ionicons name="volume-high" size={12} color={colors.accentSoft} />
                <Text style={styles.mediaPillText}>AUDIO BRIEF</Text>
              </View>
            )}
            {paper.videoUrl && (
              <View style={styles.mediaPill}>
                <Ionicons name="play-circle" size={12} color={colors.accentSoft} />
                <Text style={styles.mediaPillText}>VIDEO OVERVIEW</Text>
              </View>
            )}
          </View>

          <View style={styles.authorBlock}>
            <Text style={styles.author}>{paper.authorName}</Text>
            <Text style={styles.role}>{paper.authorRole}</Text>
          </View>

          <View style={styles.tags}>
            {paper.tags.slice(0, 2).map((tag) => (
              <Chip key={tag} label={`#${tag}`} />
            ))}
            <Chip key="domain" label={paper.domain} selected={true} />
          </View>
        </Pressable>

        <View style={styles.rail}>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Pressable style={[styles.railButton, saved && styles.railButtonActive]} onPress={toggleSave}>
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                color={saved ? colors.accentSoft : colors.text}
                size={22}
              />
              <Text style={[styles.railLabel, saved && { color: colors.accentSoft }]}>{saved ? "Saved" : "Save"}</Text>
            </Pressable>
          </Animated.View>
          <Pressable style={styles.railButton} onPress={sharePaper}>
            <Ionicons name="share-social-outline" color={colors.text} size={22} />
            <Text style={styles.railLabel}>Share</Text>
          </Pressable>
          <Pressable style={styles.railButton} onPress={handleCardPress}>
            <Ionicons name={isLocked ? "lock-closed-outline" : "book-outline"} color={isLocked ? colors.accentSoft : colors.text} size={22} />
            <Text style={[styles.railLabel, isLocked && { color: colors.accentSoft }]}>{isLocked ? "Unlock" : "Read"}</Text>
          </Pressable>
          {canDelete && (
            <Pressable style={styles.railButton} onPress={handleDelete}>
              <Ionicons name="trash-outline" color="#EF4444" size={22} />
              <Text style={[styles.railLabel, { color: "#EF4444" }]}>Delete</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    frame: {
      paddingHorizontal: 14,
      paddingVertical: 6
    },
    card: {
      flex: 1,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      padding: 18,
      justifyContent: "space-between"
    },
    topMeta: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      zIndex: 10,
      elevation: 2
    },
    stackLabel: {
      color: colors.accentSoft,
      fontSize: 12 * scale,
      fontWeight: "800",
      letterSpacing: 1
    },
    readingTime: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    body: {
      flex: 1,
      justifyContent: "center",
      gap: 8,
      paddingRight: 58,
      marginTop: 6,
      marginBottom: 6
    },
    summary: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 19 * scale
    },
    authorBlock: {
      gap: 1,
      marginTop: 2
    },
    author: {
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    role: {
      color: colors.subdued,
      fontSize: 11 * scale
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 2
    },
    rail: {
      position: "absolute",
      right: 14,
      bottom: 18,
      gap: 12,
      alignItems: "center"
    },
    railButton: {
      width: 52,
      alignItems: "center",
      gap: 3
    },
    railButtonActive: {
      opacity: 1
    },
    railLabel: {
      color: colors.subdued,
      fontSize: 10 * scale,
      fontWeight: "700",
      textAlign: "center"
    },
    journalHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: 6,
      marginBottom: 4,
    },
    journalName: {
      fontFamily: "serif",
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 1.5,
      textTransform: "uppercase",
    },
    journalSubHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 2,
      gap: 6,
    },
    journalYear: {
      fontSize: 10 * scale,
      fontWeight: "700",
      color: colors.accentSoft,
    },
    journalDot: {
      fontSize: 10 * scale,
      color: colors.subdued,
    },
    journalDoi: {
      fontSize: 10 * scale,
      fontFamily: "monospace",
      color: colors.subdued,
      flex: 1,
    },
    cutoutBlock: {
      backgroundColor: theme === "light" || theme === "sepia" ? "#FDFBF7" : "rgba(253, 251, 247, 0.04)",
      borderColor: theme === "light" || theme === "sepia" ? "#DCD1B4" : "rgba(220, 209, 180, 0.2)",
      borderWidth: 1.5,
      borderStyle: "dashed",
      padding: 10,
      borderRadius: radius.sm,
      marginVertical: 4,
    },
    cutoutTitle: {
      fontFamily: "serif",
      fontSize: 18 * scale,
      lineHeight: 23 * scale,
      fontWeight: "800",
      color: theme === "light" || theme === "sepia" ? "#3E2723" : colors.text,
    },
    insightsContainer: {
      marginVertical: 4,
      gap: 4,
    },
    insightsLabel: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.accent,
      letterSpacing: 1,
    },
    insightRow: {
      flexDirection: "row",
      gap: 6,
      alignItems: "flex-start",
    },
    insightBullet: {
      fontSize: 10 * scale,
      color: colors.accentSoft,
      marginTop: 1,
    },
    insightText: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 16 * scale,
      flex: 1,
    },
    mediaIndicators: {
      flexDirection: "row",
      gap: 6,
      marginVertical: 2,
    },
    mediaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "rgba(6, 182, 212, 0.06)",
      borderColor: "rgba(6, 182, 212, 0.12)",
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    mediaPillText: {
      fontSize: 8 * scale,
      fontWeight: "800",
      color: colors.accentSoft,
      letterSpacing: 0.5,
    },
    lockOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme === "light" || theme === "sepia" ? "rgba(253, 251, 247, 0.96)" : "rgba(11, 16, 32, 0.97)",
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
      zIndex: 100,
      elevation: 10,
    },
    lockTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800",
      marginTop: 10,
      marginBottom: 4,
      textAlign: "center",
    },
    lockDesc: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 18 * scale,
      textAlign: "center",
      marginBottom: 16,
    },
    lockBtn: {
      width: "100%",
    }
  });
}
