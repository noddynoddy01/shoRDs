import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Share, StyleSheet, Text, View, ScrollView, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius, spacing, layout } from "../constants/theme";
import { Paper } from "@/types/models";
import { isPaperSaved, toggleSavedPaper } from "@/services/savedPapers";
import { ExpandableFigure } from "./ExpandableFigure";
import { VideoExplainerModal } from "./VideoExplainerModal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { isSubscribed, hasFreeViewsRemaining } from "@/services/subscriptionService";

type ReelCardProps = {
  paper: Paper;
  height: number;
  index: number;
  isActive: boolean;
  isMuted: boolean;
  onMuteToggle: () => void;
  onDelete?: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
};

export function ReelCard({ paper, height, index, isActive, isMuted, onMuteToggle, onDelete, isSelected, onToggleSelect }: ReelCardProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 768;

  const [saved, setSaved] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [expandedSummary, setExpandedSummary] = useState(false);
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [userLang, setUserLang] = useState<"en" | "hi" | "es">("en");

  const entrance = useRef(new Animated.Value(0)).current;
  const styles = getStyles(colors, fontSizeScale, theme, isDesktop);

  useEffect(() => {
    AsyncStorage.getItem("shords.currentUser").then((userVal) => {
      if (userVal) {
        const parsed = JSON.parse(userVal);
        const mappedLang: Record<string, "en" | "hi" | "es"> = {
          "English": "en",
          "Hindi": "hi",
          "Spanish": "es"
        };
        setUserLang(mappedLang[parsed.language] || "en");
      }
    });
  }, [paper.id]);

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true
    }).start();
  }, [entrance, paper.id]);

  useEffect(() => {
    isPaperSaved(paper.id).then(setSaved);
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        const parsed = JSON.parse(val);
        setCanDelete(parsed.role === "admin" || parsed.id === paper.authorId || paper.authorId === "local-uploader");
      } else {
        setCanDelete(paper.authorId === "local-uploader");
      }
    });

    async function checkLock() {
      const premium = await isSubscribed();
      if (!premium) {
        const remaining = await hasFreeViewsRemaining();
        const viewedPapersJson = await AsyncStorage.getItem("shords.viewedPapers") || "[]";
        const viewed = JSON.parse(viewedPapersJson) as string[];
        if (!remaining && !viewed.includes(paper.id) && index > 1) {
          setIsLocked(true);
        }
      }
    }
    checkLock();
  }, [paper.id, index]);

  useEffect(() => {
    if (isActive && !isLocked && !isMuted) {
      Speech.stop();
      Speech.speak(`${paper.title}. In summary: ${paper.summary}`, {
        rate: 0.88,
        pitch: 1.0
      });
    }
  }, [isActive, isMuted, paper.id, isLocked]);

  async function handleToggleSave() {
    const next = await toggleSavedPaper(paper.id);
    setSaved(next);
  }

  async function handleShare() {
    await Share.share({
      title: paper.title,
      message: `${paper.title}\nRead on shoRDs Research OS: ${paper.originalLink}`
    });
  }

  const openWorkspace = () => {
    router.push(`/paper/${paper.id}` as never);
  };

  return (
    <Animated.View style={[styles.cardContainer, { height }, { opacity: entrance }]}>
      <ScrollView
        contentContainerStyle={styles.magazineScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentWrapper}>
          {/* 1. Hero Cover Header */}
          <Pressable style={styles.heroCover} onPress={openWorkspace}>
            <LinearGradient
              colors={["rgba(6, 182, 212, 0.16)", "rgba(139, 92, 246, 0.05)", "transparent"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.headerTopRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {onToggleSelect && (
                  <Pressable onPress={onToggleSelect} style={{ padding: 2 }}>
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={20}
                      color={isSelected ? colors.primary : colors.subdued}
                    />
                  </Pressable>
                )}
                <View style={styles.domainPill}>
                  <Text style={styles.domainText}>{paper.domain.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.tapToOpenBadge}>
                <Text style={styles.tapToOpenText}>Tap to Open Brief ↗</Text>
              </View>
            </View>

            {/* 2. Large Magazine Title */}
            <Text style={styles.heroTitle}>{paper.title}</Text>

            {/* 3. One Sentence Hook */}
            <Text style={styles.hookText}>"{paper.summary}"</Text>

            {/* Author Meta */}
            <View style={styles.authorMetaRow}>
              <View style={styles.authorAvatar}>
                <Text style={styles.avatarText}>
                  {paper.authorName.split(" ").map(n => n[0]).slice(0, 2).join("")}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.authorName}>{paper.authorName}</Text>
                <Text style={styles.authorAffiliation}>{paper.authorRole} · {paper.organization || "Researcher"}</Text>
              </View>
            </View>
          </Pressable>

          {/* 4. Key Insight Chips */}
          {paper.insights && paper.insights.length > 0 && (
            <View style={styles.insightsSection}>
              <Text style={styles.sectionHeaderTitle}>Key Insights</Text>
              <View style={styles.insightsList}>
                {paper.insights.map((insight, idx) => (
                  <Pressable key={idx} style={styles.insightChip} onPress={openWorkspace}>
                    <Ionicons name="sparkles" size={14} color={colors.primary} />
                    <Text style={styles.insightText}>{insight}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* 5. Swipeable Interactive Figures */}
          {paper.illustrations && paper.illustrations.length > 0 && (
            <View style={styles.figuresSection}>
              <Text style={styles.sectionHeaderTitle}>Interactive Figures</Text>
              <ExpandableFigure dataString={paper.illustrations[0]} caption="Figure 1: Benchmark Latency Distribution" />
            </View>
          )}

          {/* 6. Expandable Brief & Discussion */}
          <View style={styles.expandableSection}>
            <Pressable
              style={styles.expandTriggerBtn}
              onPress={() => setExpandedSummary(!expandedSummary)}
            >
              <Text style={styles.expandTriggerText}>
                {expandedSummary ? "Hide Detailed Brief" : "Expand Full Abstract & Methodology"}
              </Text>
              <Ionicons name={expandedSummary ? "chevron-up" : "chevron-down"} size={16} color={colors.primary} />
            </Pressable>

            {expandedSummary && (
              <View style={styles.expandedContent}>
                <Text style={styles.fullExplanationText}>{paper.fullExplanation}</Text>
              </View>
            )}
          </View>

          {/* Open Stack Button */}
          <Pressable style={styles.readFullPaperBtn} onPress={openWorkspace}>
            <Text style={styles.readFullPaperText}>Open Research Workspace Stack</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
          </Pressable>

          <View style={{ height: 80 }} />
        </View>
      </ScrollView>

      {/* Floating Action Rail */}
      <View style={styles.floatingActionRail}>
        <Pressable style={styles.railBtn} onPress={openWorkspace}>
          <Ionicons name="open-outline" size={18} color={colors.primary} />
        </Pressable>
        <Pressable style={styles.railBtn} onPress={() => setIsVideoVisible(true)}>
          <Ionicons name="film-outline" size={18} color={colors.primary} />
        </Pressable>
        <Pressable style={styles.railBtn} onPress={handleToggleSave}>
          <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={18} color={saved ? colors.primary : colors.text} />
        </Pressable>
        <Pressable style={styles.railBtn} onPress={onMuteToggle}>
          <Ionicons name={isMuted ? "volume-mute-outline" : "volume-high-outline"} size={18} color={colors.text} />
        </Pressable>
        <Pressable style={styles.railBtn} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={18} color={colors.text} />
        </Pressable>
        {canDelete && (
          <Pressable style={styles.railBtn} onPress={onDelete}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </Pressable>
        )}
      </View>

      {/* AI Video Explainer Modal */}
      <VideoExplainerModal
        visible={isVideoVisible}
        onClose={() => setIsVideoVisible(false)}
        paper={paper}
        selectedLang={userLang}
      />
    </Animated.View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string, isDesktop: boolean) {
  const baseScale = isDesktop ? scale * 1.06 : scale;

  return StyleSheet.create({
    cardContainer: {
      width: "100%",
      backgroundColor: colors.background,
      position: "relative"
    },
    magazineScroll: {
      padding: isDesktop ? spacing.lg : spacing.md,
      alignItems: "center"
    },
    contentWrapper: {
      width: "100%",
      maxWidth: isDesktop ? 780 : "100%",
      gap: spacing.md
    },
    heroCover: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: isDesktop ? spacing.lg : spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    domainPill: {
      backgroundColor: colors.primary + "12",
      borderColor: colors.primary + "2C",
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill
    },
    domainText: {
      fontSize: 10 * baseScale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 1.2
    },
    tapToOpenBadge: {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
      borderColor: colors.border,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill
    },
    tapToOpenText: {
      fontSize: 10 * baseScale,
      fontWeight: "700",
      color: colors.subdued
    },
    heroTitle: {
      fontSize: (isDesktop ? 26 : 22) * baseScale,
      fontWeight: "800",
      color: colors.text,
      lineHeight: (isDesktop ? 34 : 30) * baseScale,
      letterSpacing: -0.3
    },
    hookText: {
      fontSize: (isDesktop ? 15 : 13) * baseScale,
      lineHeight: (isDesktop ? 23 : 20) * baseScale,
      color: colors.muted,
      fontStyle: "italic"
    },
    authorMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: spacing.xs
    },
    authorAvatar: {
      width: isDesktop ? 40 : 34,
      height: isDesktop ? 40 : 34,
      borderRadius: isDesktop ? 20 : 17,
      backgroundColor: "rgba(255, 255, 255, 0.04)",
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    avatarText: {
      fontSize: 12 * baseScale,
      fontWeight: "800",
      color: colors.muted
    },
    authorName: {
      fontSize: 13 * baseScale,
      fontWeight: "800",
      color: colors.text
    },
    authorAffiliation: {
      fontSize: 11 * baseScale,
      color: colors.subdued
    },
    insightsSection: {
      gap: spacing.xs
    },
    sectionHeaderTitle: {
      fontSize: (isDesktop ? 15 : 13) * baseScale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5
    },
    insightsList: {
      gap: 8
    },
    insightChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      paddingHorizontal: isDesktop ? 16 : 12,
      paddingVertical: isDesktop ? 12 : 8,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    insightText: {
      fontSize: (isDesktop ? 14 : 12) * baseScale,
      color: colors.muted,
      fontWeight: "600",
      flex: 1,
      lineHeight: (isDesktop ? 20 : 18) * baseScale
    },
    figuresSection: {
      gap: spacing.xs
    },
    expandableSection: {
      gap: spacing.xs
    },
    expandTriggerBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      padding: isDesktop ? spacing.md : spacing.sm + 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    expandTriggerText: {
      fontSize: 13 * baseScale,
      fontWeight: "800",
      color: colors.primary
    },
    expandedContent: {
      backgroundColor: colors.surface,
      padding: isDesktop ? spacing.lg : spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    fullExplanationText: {
      fontSize: (isDesktop ? 15 : 13) * baseScale,
      lineHeight: (isDesktop ? 25 : 22) * baseScale,
      color: colors.muted
    },
    readFullPaperBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      height: isDesktop ? 52 : 48,
      borderRadius: radius.md
    },
    readFullPaperText: {
      color: "#FFFFFF",
      fontSize: 14 * baseScale,
      fontWeight: "800"
    },
    floatingActionRail: {
      position: "absolute",
      right: isDesktop ? 24 : 16,
      top: isDesktop ? 24 : 16,
      gap: 10
    },
    railBtn: {
      width: isDesktop ? 40 : 36,
      height: isDesktop ? 40 : 36,
      borderRadius: isDesktop ? 20 : 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4
    }
  });
}
