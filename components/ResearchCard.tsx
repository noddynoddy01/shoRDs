import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "@/constants/theme";
import { Paper } from "@/types/models";
import { isPaperSaved, toggleSavedPaper } from "@/services/savedPapers";
import { Chip } from "./Chip";
import { GlassButton } from "./GlassButton";

type ResearchCardProps = {
  paper: Paper;
  compact?: boolean;
};

export function ResearchCard({ paper, compact }: ResearchCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;
  const [saved, setSaved] = useState(false);

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
  }, [paper.id]);

  async function sharePaper() {
    await Share.share({
      title: paper.title,
      message: `${paper.title}\n\n${paper.summary}`
    });
  }

  async function toggleSave() {
    const next = await toggleSavedPaper(paper.id);
    setSaved(next);
  }

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
      <Pressable
        style={({ pressed }) => [styles.card, compact && styles.compact, pressed && styles.pressed]}
        onPress={() => router.push(`/paper/${paper.id}`)}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.topRow}>
          <Text style={styles.domain}>{paper.domain}</Text>
          <Text style={styles.readingTime}>{paper.readingTime}</Text>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{paper.title}</Text>
          <Text style={styles.summary}>{paper.summary}</Text>
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
          {paper.tags.slice(0, 3).map((tag) => (
            <Chip key={tag} label={`#${tag}`} />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable style={[styles.iconButton, saved && styles.iconButtonActive]} onPress={toggleSave}>
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              color={saved ? colors.accentSoft : colors.text}
              size={20}
            />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={sharePaper}>
            <Ionicons name="share-social-outline" color={colors.text} size={20} />
          </Pressable>
          <GlassButton
            title="Read More"
            icon="arrow-forward"
            onPress={() => router.push(`/paper/${paper.id}`)}
            style={styles.readMore}
          />
        </View>

        <LinearGradient
          colors={["rgba(6,182,212,0.28)", "rgba(124,58,237,0.12)", "transparent"]}
          style={styles.glow}
        />
        <View style={styles.orbitLine} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 520,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    overflow: "hidden",
    justifyContent: "space-between",
    shadowColor: colors.accent,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 18 }
  },
  compact: {
    minHeight: 0,
    gap: 14
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
  domain: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  readingTime: {
    color: colors.subdued,
    fontSize: 12,
    fontWeight: "600"
  },
  titleBlock: {
    gap: 14
  },
  title: {
    color: colors.ink,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: 0
  },
  summary: {
    color: colors.muted,
    fontSize: 17,
    lineHeight: 27
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12
  },
  author: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  role: {
    color: colors.subdued,
    fontSize: 12,
    marginTop: 3
  },
  saved: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700"
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)"
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
    opacity: 0.9
  },
  orbitLine: {
    position: "absolute",
    right: -18,
    top: 94,
    width: 150,
    height: 1,
    backgroundColor: "rgba(103, 232, 249, 0.38)",
    transform: [{ rotate: "-14deg" }]
  }
});
