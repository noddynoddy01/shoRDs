import { useFocusEffect, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Chip } from "@/components/Chip";
import { DomainCard } from "@/components/DomainCard";
import { PageHeader } from "@/components/PageHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { SearchBar } from "@/components/SearchBar";
import { colors as defaultColors, radius } from "@/constants/theme";
import { domains, domainSubtopics } from "@/data/samplePapers";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getAllPapers } from "@/services/papersStore";
import { Domain, Paper } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";
import { FloatingChatButton } from "@/components/FloatingChatButton";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

const filters = ["Trending", "Newest", "Most Saved"];

export default function ExploreScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<Domain | "All">("All");
  const [expandedDomain, setExpandedDomain] = useState<Domain | null>(null);
  const [filter, setFilter] = useState("Trending");
  const [papers, setPapers] = useState<Paper[]>([]);
  const { contentBottomPadding } = useFeedMetrics();

  const styles = getStyles(colors, fontSizeScale);

  useFocusEffect(
    useCallback(() => {
      getAllPapers().then(setPapers);
    }, [])
  );

  const results = useMemo(() => {
    const normalized = query.toLowerCase();
    return papers
      .filter((paper) => selectedDomain === "All" || paper.domain === selectedDomain)
      .filter((paper) =>
        [paper.title, paper.summary, paper.domain, paper.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      )
      .sort((a, b) => {
        if (filter === "Newest") return b.createdAt.getTime() - a.createdAt.getTime();
        if (filter === "Most Saved") return b.savedCount - a.savedCount;
        return b.savedCount - a.savedCount;
      });
  }, [filter, papers, query, selectedDomain]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          kicker="Explore"
          title="Discover research by domain"
          subtitle="Browse simplified papers from Nature, arXiv, IEEE, NIH, NASA, and NIST."
        />

        <SearchBar value={query} onChangeText={setQuery} placeholder="Search papers, tags, domains..." />

        <View style={styles.filters}>
          {filters.map((item) => (
            <Chip key={item} label={item} selected={filter === item} onPress={() => setFilter(item)} />
          ))}
        </View>

        <View style={styles.domainGrid}>
          {domains.map((domain) => {
            const isExpanded = expandedDomain === domain;
            return (
              <View key={domain} style={{ width: "48%" }}>
                <DomainCard
                  domain={domain}
                  count={papers.filter((paper) => paper.domain === domain).length}
                  selected={isExpanded}
                  onPress={() => {
                    setExpandedDomain(isExpanded ? null : domain);
                    setSelectedDomain(isExpanded ? "All" : domain);
                  }}
                />
              </View>
            );
          })}
        </View>

        {expandedDomain && (
          <View style={styles.disclosurePanel}>
            <LinearGradient
              colors={["rgba(6, 182, 212, 0.08)", "rgba(124, 58, 237, 0.04)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.disclosureHeader}>
              <Ionicons name="git-branch-outline" size={16} color={colors.accentSoft} />
              <Text style={styles.disclosureTitle}>Explore {expandedDomain} Subtopics</Text>
            </View>
            <View style={styles.subtopicsGrid}>
              <Pressable
                style={styles.subtopicItem}
                onPress={() => {
                  router.push({
                    pathname: "/(tabs)",
                    params: { filterDomain: expandedDomain }
                  });
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.subtopicItemText}>All Stacks</Text>
                  <Text style={styles.subtopicItemCount}>
                    {papers.filter((p) => p.domain === expandedDomain).length} briefs
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={12} color={colors.accentSoft} />
              </Pressable>

              {(domainSubtopics[expandedDomain] || []).map((sub) => {
                const count = papers.filter((p) => p.domain === expandedDomain && p.subdomain === sub).length;
                return (
                  <Pressable
                    key={sub}
                    style={styles.subtopicItem}
                    onPress={() => {
                      router.push({
                        pathname: "/(tabs)",
                        params: { filterDomain: expandedDomain, selectedSubdomain: sub }
                      });
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subtopicItemText} numberOfLines={1}>{sub}</Text>
                      <Text style={styles.subtopicItemCount}>{count} briefs</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={12} color={colors.accentSoft} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recommended</Text>
          <Text style={styles.count}>{results.length} papers</Text>
        </View>

        <View style={styles.results}>
          {results.map((paper) => (
            <ResearchCard key={paper.id} paper={paper} compact />
          ))}
        </View>
      </ScrollView>
      <FloatingChatButton />
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    content: {
      padding: 18,
      gap: 18
    },
    filters: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    domainGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 12
    },
    disclosurePanel: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      overflow: "hidden",
      position: "relative"
    },
    disclosureHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 12
    },
    disclosureTitle: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "800"
    },
    subtopicsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 10
    },
    subtopicItem: {
      width: "48%",
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 6
    },
    subtopicItemText: {
      color: colors.text,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    subtopicItemCount: {
      color: colors.subdued,
      fontSize: 9 * scale,
      fontWeight: "600",
      marginTop: 2
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800"
    },
    count: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    results: {
      gap: 14
    }
  });
}
