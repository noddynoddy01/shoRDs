import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Chip } from "@/components/Chip";
import { GlassButton } from "@/components/GlassButton";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";
import { samplePapers } from "@/data/samplePapers";
import { isPaperSaved, toggleSavedPaper } from "@/services/savedPapers";

export default function ResearchDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paper = samplePapers.find((item) => item.id === id) ?? samplePapers[0];
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    isPaperSaved(paper.id).then(setSaved);
  }, [paper.id]);

  async function sharePaper() {
    await Share.share({
      title: paper.title,
      message: `${paper.title}\n\n${paper.summary}\n${paper.originalLink}`
    });
  }

  async function toggleSave() {
    const next = await toggleSavedPaper(paper.id);
    setSaved(next);
  }

  async function openOriginal() {
    await Linking.openURL(paper.originalLink);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" color={colors.text} size={22} />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable style={[styles.iconButton, saved && styles.iconButtonActive]} onPress={toggleSave}>
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                color={saved ? colors.accentSoft : colors.text}
                size={21}
              />
            </Pressable>
            <Pressable style={styles.iconButton} onPress={sharePaper}>
              <Ionicons name="share-social-outline" color={colors.text} size={21} />
            </Pressable>
          </View>
        </View>

        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(6,182,212,0.16)", "rgba(124,58,237,0.08)", "transparent"]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.domain}>{paper.domain}</Text>
          <Text style={styles.title}>{paper.title}</Text>
          <Text style={styles.summary}>{paper.summary}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{paper.readingTime}</Text>
            <Text style={styles.dot}>.</Text>
            <Text style={styles.metaText}>{paper.authorName}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Simplified Explanation</Text>
          <Text style={styles.body}>{paper.fullExplanation}</Text>
        </View>

        <View style={styles.authorBox}>
          <Text style={styles.authorLabel}>Author</Text>
          <Text style={styles.authorName}>{paper.authorName}</Text>
          <Text style={styles.authorRole}>{paper.authorRole}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tags}>
            {paper.tags.map((tag) => (
              <Chip key={tag} label={`#${tag}`} />
            ))}
          </View>
        </View>

        <GlassButton
          title="Open Original Research Paper"
          icon="document-text-outline"
          variant="quiet"
          onPress={openOriginal}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 36,
    gap: 20
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  headerActions: {
    flexDirection: "row",
    gap: 10
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  iconButtonActive: {
    borderColor: "rgba(103, 232, 249, 0.42)",
    backgroundColor: "rgba(6, 182, 212, 0.12)"
  },
  hero: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 22,
    gap: 14,
    overflow: "hidden"
  },
  domain: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 37,
    fontWeight: "700"
  },
  summary: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25
  },
  meta: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center"
  },
  metaText: {
    color: colors.subdued,
    fontSize: 12,
    fontWeight: "600"
  },
  dot: {
    color: colors.subdued
  },
  section: {
    gap: 10
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "700"
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 27
  },
  authorBox: {
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4
  },
  authorLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  authorName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700"
  },
  authorRole: {
    color: colors.muted,
    fontSize: 13
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  originalLink: {}
});
