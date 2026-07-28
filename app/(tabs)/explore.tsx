import { useFocusEffect, router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Chip } from "@/components/Chip";
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

const iconByDomain: Record<Domain, keyof typeof Ionicons.glyphMap> = {
  "AI / ML": "sparkles-outline",
  Robotics: "hardware-chip-outline",
  Electronics: "flash-outline",
  Biotechnology: "leaf-outline",
  "Quantum Computing": "cube-outline",
  "Space Tech": "planet-outline",
  Cybersecurity: "shield-checkmark-outline",
  "Renewable Energy": "sunny-outline",
  Nanotechnology: "aperture-outline",
  Genetics: "git-network-outline",
  "Material Science": "layers-outline",
  "Climate Tech": "globe-outline",
  "Blockchain & Web3": "link-outline",
  Neuroscience: "bulb-outline",
  "Nuclear Fusion": "nuclear-outline",
  "Medical Devices": "medkit-outline",
  "IoT & Edge Computing": "share-outline"
};

const colorsByDomain: Record<Domain, string> = {
  "AI / ML": "#06B6D4",
  Robotics: "#6366F1",
  Electronics: "#F59E0B",
  Biotechnology: "#10B981",
  "Quantum Computing": "#D946EF",
  "Space Tech": "#F43F5E",
  Cybersecurity: "#059669",
  "Renewable Energy": "#D97706",
  Nanotechnology: "#0D9488",
  Genetics: "#C084FC",
  "Material Science": "#64748B",
  "Climate Tech": "#38BDF8",
  "Blockchain & Web3": "#EA580C",
  Neuroscience: "#EC4899",
  "Nuclear Fusion": "#84CC16",
  "Medical Devices": "#E11D48",
  "IoT & Edge Computing": "#4F46E5"
};

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

        {/* Accordion Domain Rows */}
        <View style={styles.domainList}>
          {domains.map((domain) => {
            const isExpanded = expandedDomain === domain;
            const domainCount = papers.filter((paper) => paper.domain === domain).length;
            const subtopics = domainSubtopics[domain] || [];
            const domainColor = colorsByDomain[domain] || colors.accentSoft;

            return (
              <View key={domain} style={[styles.accordionItem, isExpanded && styles.accordionItemActive]}>
                <Pressable
                  style={styles.accordionHeader}
                  onPress={() => {
                    setExpandedDomain(isExpanded ? null : domain);
                    setSelectedDomain(isExpanded ? "All" : domain);
                  }}
                >
                  <View style={styles.accordionLeft}>
                    <View style={[styles.iconWrap, { backgroundColor: isExpanded ? `${domainColor}20` : "rgba(255, 255, 255, 0.04)", borderColor: isExpanded ? domainColor : "transparent", borderWidth: 1 }]}>
                      <Ionicons name={iconByDomain[domain] || "book-outline"} color={isExpanded ? domainColor : colors.text} size={20} />
                    </View>
                    <View>
                      <Text style={[styles.domainName, isExpanded && { color: domainColor }]}>{domain}</Text>
                      <Text style={styles.domainCount}>{domainCount} discoveries</Text>
                    </View>
                  </View>
                  <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} color={isExpanded ? domainColor : colors.subdued} size={18} />
                </Pressable>

                {isExpanded && subtopics.length > 0 && (
                  <View style={styles.accordionContent}>
                    <LinearGradient
                      colors={["rgba(255,255,255,0.01)", "rgba(255,255,255,0.02)"]}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.subtopicsContainer}>
                      <Pressable
                        style={[styles.subtopicChip, { borderLeftWidth: 3, borderLeftColor: domainColor }]}
                        onPress={() => {
                          router.push({
                            pathname: "/(tabs)",
                            params: { filterDomain: domain }
                          });
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.subtopicChipText}>All Stacks</Text>
                          <Text style={styles.subtopicChipCount}>{domainCount} briefs</Text>
                        </View>
                        <Ionicons name="arrow-forward" size={12} color={domainColor} />
                      </Pressable>

                      {subtopics.map((sub) => {
                        const count = papers.filter((p) => p.domain === domain && p.subdomain === sub).length;
                        return (
                          <Pressable
                            key={sub}
                            style={[styles.subtopicChip, { borderLeftWidth: 3, borderLeftColor: domainColor }]}
                            onPress={() => {
                              router.push({
                                pathname: "/(tabs)",
                                params: { filterDomain: domain, selectedSubdomain: sub }
                              });
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.subtopicChipText} numberOfLines={1}>{sub}</Text>
                              <Text style={styles.subtopicChipCount}>{count} briefs</Text>
                            </View>
                            <Ionicons name="arrow-forward" size={12} color={domainColor} />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

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
    domainList: {
      gap: 10,
      width: "100%"
    },
    accordionItem: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: "hidden"
    },
    accordionItemActive: {
      borderColor: "rgba(255, 255, 255, 0.12)"
    },
    accordionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 14
    },
    accordionLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    domainName: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "800"
    },
    domainCount: {
      color: colors.subdued,
      fontSize: 11 * scale,
      fontWeight: "600",
      marginTop: 2
    },
    accordionContent: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      position: "relative"
    },
    subtopicsContainer: {
      padding: 12,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 8
    },
    subtopicChip: {
      width: "48%",
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.cardElevated,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 6
    },
    subtopicChipText: {
      color: colors.text,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    subtopicChipCount: {
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
