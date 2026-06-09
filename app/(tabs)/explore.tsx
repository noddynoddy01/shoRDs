import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/Chip";
import { DomainCard } from "@/components/DomainCard";
import { PageHeader } from "@/components/PageHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { SearchBar } from "@/components/SearchBar";
import { colors as defaultColors } from "@/constants/theme";
import { domains } from "@/data/samplePapers";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getAllPapers } from "@/services/papersStore";
import { Domain, Paper } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";

const filters = ["Trending", "Newest", "Most Saved"];

export default function ExploreScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<Domain | "All">("All");
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
          {domains.map((domain) => (
            <DomainCard
              key={domain}
              domain={domain}
              count={papers.filter((paper) => paper.domain === domain).length}
              selected={selectedDomain === domain}
              onPress={() => setSelectedDomain(selectedDomain === domain ? "All" : domain)}
            />
          ))}
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
