import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/Chip";
import { DomainCard } from "@/components/DomainCard";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { SearchBar } from "@/components/SearchBar";
import { colors } from "@/constants/theme";
import { domains, samplePapers } from "@/data/samplePapers";
import { Domain } from "@/types/models";

const filters = ["Trending", "Newest", "Most Saved"];

export default function ExploreScreen() {
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<Domain | "All">("All");
  const [filter, setFilter] = useState("Trending");

  const results = useMemo(() => {
    const normalized = query.toLowerCase();
    return samplePapers
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
  }, [filter, query, selectedDomain]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={styles.kicker}>Explore</Text>
          <Text style={styles.title}>Discover research by domain</Text>
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Search papers, tags, domains" />

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
              count={samplePapers.filter((paper) => paper.domain === domain).length || 3}
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

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 96,
    gap: 18
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "700",
    marginTop: 5
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
    fontSize: 19,
    fontWeight: "700"
  },
  count: {
    color: colors.subdued,
    fontSize: 12,
    fontWeight: "600"
  },
  results: {
    gap: 14
  }
});
