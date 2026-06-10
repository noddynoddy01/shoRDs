import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { Animated, Pressable, Share, StyleSheet, Text, View } from "react-native";
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

type ResearchCardProps = {
  paper: Paper;
  compact?: boolean;
};

export function ResearchCard({ paper, compact }: ResearchCardProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const [saved, setSaved] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const parsedTags = useMemo(() => {
    const list: string[] = [];
    if (paper.tags) {
      paper.tags.forEach(t => {
        if (!t) return;
        t.split(/[,\n;]+/).forEach(p => {
          const cleaned = p.replace(/^[•\-\*\s]+/, "").trim().toLowerCase();
          if (cleaned) list.push(cleaned);
        });
      });
    }
    return list;
  }, [paper.tags]);

  const styles = getStyles(colors, fontSizeScale, theme);

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true
    }).start();
  }, [entrance, paper.id]);

  useEffect(() => {
    isPaperSaved(paper.id).then(setSaved);

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
  }, [paper.id]);

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
      Animated.timing(pulse, { toValue: 1.16, duration: 110, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 110, useNativeDriver: true })
    ]).start();
  }

  const handleCardPress = () => {
    if (isLocked) {
      router.push("/paywall" as never);
    } else {
      router.push(`/paper/${paper.id}` as never);
    }
  };

  const cardColors = theme === "light" || theme === "sepia"
    ? [colors.card, colors.cardElevated]
    : ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.01)"];

  const glowColors = theme === "light"
    ? ["rgba(6,182,212,0.12)", "rgba(124,58,237,0.06)", "transparent"]
    : theme === "sepia"
    ? ["rgba(160,82,45,0.12)", "rgba(205,133,63,0.06)", "transparent"]
    : ["rgba(6,182,212,0.28)", "rgba(124,58,237,0.12)", "transparent"];

  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0]
            })
          }
        ]
      }}
    >
      <View style={[styles.card, compact && styles.compact]}>
        {/* Lock Overlay */}
        {isLocked && (
          <View style={styles.lockOverlay}>
            <Ionicons name="lock-closed-outline" size={40} color={colors.accentSoft} />
            <Text style={styles.lockTitle}>Premium Brief</Text>
            <Text style={styles.lockDesc}>
              Upgrade to premium to read full briefs, play audio summaries, and connect with academic mentors.
            </Text>
            <GlassButton
              title="Unlock Now"
              icon="sparkles"
              onPress={() => router.push("/paywall" as never)}
              style={styles.lockBtn}
            />
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
          onPress={handleCardPress}
        >
          <LinearGradient
            colors={cardColors as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.topRow}>
            <Text style={styles.stackLabel}>JOURNAL ARCHIVE</Text>
            <Text style={styles.readingTime}>{paper.readingTime}</Text>
          </View>

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
            <Text style={styles.cutoutTitle} numberOfLines={compact ? 2 : 3}>{paper.title}</Text>
          </View>

          {!compact && (
            <>
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
            </>
          )}

          {/* Media Indicators */}
          <View style={styles.mediaIndicators}>
            {paper.audioUrl && (
              <View style={styles.mediaPill}>
                <Ionicons name="volume-high" size={12} color={colors.accentSoft} />
                <Text style={styles.mediaPillText}>AUDIO</Text>
              </View>
            )}
            {paper.videoUrl && (
              <View style={styles.mediaPill}>
                <Ionicons name="play-circle" size={12} color={colors.accentSoft} />
                <Text style={styles.mediaPillText}>VIDEO</Text>
              </View>
            )}
          </View>

          <View style={styles.metaRow}>
            <View>
              <Text style={styles.author}>{paper.authorName}</Text>
              <Text style={styles.role}>{paper.authorRole}</Text>
            </View>
            <Text style={styles.saved}>
              {(paper.savedCount + (saved ? 1 : 0)).toLocaleString()} saves
            </Text>
          </View>

          <View style={styles.tags}>
            {parsedTags.slice(0, 2).map((tag) => (
              <Chip key={tag} label={`#${tag}`} />
            ))}
            <Chip key="domain" label={paper.domain} selected={true} />
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Pressable style={[styles.iconButton, saved && styles.iconButtonActive]} onPress={toggleSave}>
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                color={saved ? colors.accentSoft : colors.text}
                size={20}
              />
            </Pressable>
          </Animated.View>
          <Pressable style={styles.iconButton} onPress={sharePaper}>
            <Ionicons name="share-social-outline" color={colors.text} size={20} />
          </Pressable>
          <GlassButton
            title={isLocked ? "Unlock Premium" : "Read Summary"}
            icon={isLocked ? "lock-closed-outline" : "arrow-forward"}
            onPress={handleCardPress}
            style={styles.readMore}
          />
        </View>

        {!compact && (
          <>
            <LinearGradient
              colors={glowColors as any}
              style={styles.glow}
            />
            <View style={styles.orbitLine} />
          </>
        )}
      </View>
    </Animated.View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    card: {
      minHeight: 460,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      overflow: "hidden",
      justifyContent: "space-between",
      shadowColor: colors.accent,
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      gap: 12
    },
    cardBody: {
      flex: 1,
      gap: 10
    },
    compact: {
      minHeight: 0,
      gap: 10
    },
    pressed: {
      transform: [{ scale: 0.992 }]
    },
    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12
    },
    stackLabel: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "800",
      letterSpacing: 1.5
    },
    readingTime: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    summary: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginTop: 4
    },
    author: {
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    role: {
      color: colors.subdued,
      fontSize: 11 * scale,
      marginTop: 1
    },
    saved: {
      color: colors.success,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      zIndex: 2,
      elevation: 2,
      marginTop: 6
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardElevated
    },
    iconButtonActive: {
      borderColor: "rgba(103, 232, 249, 0.42)",
      backgroundColor: "rgba(6, 182, 212, 0.12)"
    },
    readMore: {
      flex: 1
    },
    glow: {
      position: "absolute",
      width: 190,
      height: 190,
      borderRadius: 95,
      right: -72,
      top: -64,
      opacity: 0.8
    },
    orbitLine: {
      position: "absolute",
      right: -18,
      top: 94,
      width: 150,
      height: 1,
      backgroundColor: colors.border,
      transform: [{ rotate: "-14deg" }]
    },
    journalHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: 6,
      marginBottom: 2,
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
      marginVertical: 2,
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
      fontSize: 17 * scale,
      fontWeight: "800",
      marginTop: 8,
      marginBottom: 4,
      textAlign: "center",
    },
    lockDesc: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 18 * scale,
      textAlign: "center",
      marginBottom: 12,
    },
    lockBtn: {
      width: "100%",
    }
  });
}
