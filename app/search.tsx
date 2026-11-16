import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState, useEffect, useRef } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator
} from "react-native";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { executeLiveFederatedSearch, FederatedPaper, SearchFilters } from "@/services/federatedSearch";
import { generateIndependentStacksBatch, DeepStackSynthesis } from "@/services/stackGenerator";
import { cacheDynamicPaper } from "@/services/papersStore";
import { useTheme } from "@/context/ThemeContext";
import { ComparePapersModal } from "@/components/ComparePapersModal";

export default function FederatedSearchScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SearchFilters["sortBy"]>("relevance");
  const [openAccessOnly, setOpenAccessOnly] = useState(false);

  const [results, setResults] = useState<FederatedPaper[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Multi-Selection Checkbox state
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [generatedStacks, setGeneratedStacks] = useState<DeepStackSynthesis[]>([]);
  const [isGeneratingStack, setIsGeneratingStack] = useState(false);
  const [compareModalVisible, setCompareModalVisible] = useState(false);

  const searchTimerRef = useRef<any>(null);

  // Debounced Search Execution (300ms)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimerRef.current = setTimeout(() => {
      triggerSearch(query, 1);
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, sortBy, openAccessOnly]);

  const triggerSearch = async (searchTerm: string, pageNum: number) => {
    try {
      const res = await executeLiveFederatedSearch(searchTerm, pageNum, { sortBy, openAccessOnly });

      const newPapers = res.papers;
      newPapers.forEach(p => cacheDynamicPaper(p as any));
      setResults(newPapers);
      setNotice(
        res.status === "rate_limited" ? "OpenAlex is limiting requests right now. Try again in a little while."
        : res.isOffline ? "Could not reach OpenAlex. Check your connection and try again."
        : res.status !== "ok" ? "OpenAlex returned an unexpected answer. Try again shortly."
        : null
      );
    } catch (err) {
      console.warn("Federated search error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const togglePaperSelection = (id: string) => {
    setSelectedPaperIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleGenerateIndependentStacks = async () => {
    if (selectedPaperIds.length === 0) return;

    const selectedPapers = results.filter(p => selectedPaperIds.includes(p.id));
    setIsGeneratingStack(true);

    try {
      // ISSUE 8: Generates independent stacks (Stack A, Stack B, Stack C)
      const stacks = await generateIndependentStacksBatch(selectedPapers as any);
      setGeneratedStacks(stacks);
      
      // Open primary stack details
      router.push(`/paper/${encodeURIComponent(selectedPapers[0].id)}`);
    } catch (err) {
      Alert.alert("Stack Generation Error", "Failed to generate independent stacks.");
    } finally {
      setIsGeneratingStack(false);
    }
  };

  const styles = getStyles(colors, fontSizeScale);
  const selectedPapersList = results.filter(p => selectedPaperIds.includes(p.id));

  return (
    <Screen style={styles.container}>
      {/* Search Bar Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={20} color={colors.muted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search OpenAlex, arXiv, Crossref, Europe PMC..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.pubFilterBar}>
        <Text style={styles.sourceNote}>Searching OpenAlex, which aggregates many publishers and repositories. Results are metadata and abstracts only.</Text>
      </View>

      {/* Additional Options Bar */}
      <View style={styles.optionsBar}>
        <Pressable
          style={[styles.filterChip, openAccessOnly && styles.filterChipActive]}
          onPress={() => setOpenAccessOnly(!openAccessOnly)}
        >
          <Ionicons name="lock-open-outline" size={14} color={openAccessOnly ? "#FFF" : colors.muted} />
          <Text style={[styles.filterChipText, openAccessOnly && styles.filterChipTextActive]}>
            Open Access
          </Text>
        </Pressable>

        <Pressable
          style={styles.filterChip}
          onPress={() => setSortBy(sortBy === "relevance" ? "recency" : "relevance")}
        >
          <Ionicons name="swap-vertical" size={14} color={colors.muted} />
          <Text style={styles.filterChipText}>
            Sort: {sortBy === "relevance" ? "Relevance" : "Newest"}
          </Text>
        </Pressable>
      </View>

      {/* Results List */}
      {isSearching ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Searching OpenAlex...</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>
            {notice ? notice : query.length > 0 ? `No papers found for "${query}"` : "Type a research query to search OpenAlex"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => {
            const isSelected = selectedPaperIds.includes(item.id);
            return (
              <Pressable
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => router.push(`/paper/${encodeURIComponent(item.id)}`)}
              >
                <View style={styles.cardHeader}>
                  <Pressable style={styles.checkbox} onPress={() => togglePaperSelection(item.id)}>
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={22}
                      color={isSelected ? colors.primary : colors.muted}
                    />
                  </Pressable>
                  <Text style={styles.sourceTag}>{item.sourceTag || "[OpenAlex]"}</Text>
                  {item.pubYear ? <Text style={styles.yearBadge}>{item.pubYear}</Text> : null}
                </View>

                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.authors}>{[item.authorName, item.organization].filter(Boolean).join(" • ") || "Authors not listed"}</Text>
                <Text style={styles.summary} numberOfLines={3}>{item.summary || "No abstract available from the source."}</Text>
              </Pressable>
            );
          }}
        />
      )}

      {/* Multi-Selection Batch & Compare Action Bar */}
      {selectedPaperIds.length > 0 && (
        <View style={styles.batchBar}>
          <Text style={styles.batchText}>{selectedPaperIds.length} Selected</Text>

          {/* ISSUE 9: Dedicated Compare Papers Button */}
          {selectedPaperIds.length > 1 && (
            <Pressable style={styles.compareBtn} onPress={() => setCompareModalVisible(true)}>
              <Ionicons name="git-compare-outline" size={16} color={colors.primary} />
              <Text style={styles.compareBtnText}>Compare</Text>
            </Pressable>
          )}

          <Pressable style={styles.createStackBtn} onPress={handleGenerateIndependentStacks} disabled={isGeneratingStack}>
            {isGeneratingStack ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.createStackBtnText}>Generate Stacks</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Compare Papers Modal */}
      <ComparePapersModal
        visible={compareModalVisible}
        onClose={() => setCompareModalVisible(false)}
        papers={selectedPapersList as any}
      />
    </Screen>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.md,
      gap: spacing.sm
    },
    backBtn: {
      padding: 4
    },
    searchInputWrapper: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      height: 44
    },
    searchInput: {
      flex: 1,
      fontSize: 14 * scale,
      color: colors.text
    },
    pubFilterBar: {
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    optionsBar: {
      flexDirection: "row",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      gap: spacing.sm
    },
    filterChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      gap: 4
    },
    filterChipActive: {
      backgroundColor: colors.primary
    },
    filterChipText: {
      fontSize: 12 * scale,
      color: colors.muted
    },
    filterChipTextActive: {
      color: "#FFFFFF",
      fontWeight: "700"
    },
    centerContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl
    },
    loadingText: {
      marginTop: spacing.md,
      fontSize: 13 * scale,
      color: colors.muted
    },
    emptyText: {
      marginTop: spacing.sm,
      fontSize: 14 * scale,
      color: colors.muted,
      textAlign: "center"
    },
    listContainer: {
      padding: spacing.md,
      paddingBottom: 100
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    cardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10"
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.xs,
      gap: spacing.xs
    },
    checkbox: {
      marginRight: 4
    },
    sourceNote: {
      color: colors.muted,
      fontSize: 12 * scale,
      paddingHorizontal: spacing.md,
      paddingVertical: 6
    },
    sourceTag: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.primary
    },
    yearBadge: {
      fontSize: 11 * scale,
      color: colors.muted,
      marginLeft: "auto"
    },
    title: {
      fontSize: 15 * scale,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 4
    },
    authors: {
      fontSize: 12 * scale,
      color: colors.muted,
      marginBottom: spacing.xs
    },
    summary: {
      fontSize: 13 * scale,
      color: colors.subdued,
      lineHeight: 18
    },
    batchBar: {
      position: "absolute",
      bottom: 20,
      left: 20,
      right: 20,
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      elevation: 5,
      borderWidth: 1,
      borderColor: colors.primary
    },
    batchText: {
      fontSize: 14 * scale,
      fontWeight: "700",
      color: colors.text
    },
    compareBtn: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primary + "20",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      gap: 4
    },
    compareBtnText: {
      color: colors.primary,
      fontWeight: "700",
      fontSize: 12 * scale
    },
    createStackBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 4,
      borderRadius: radius.sm
    },
    createStackBtnText: {
      color: "#FFF",
      fontWeight: "700",
      fontSize: 13 * scale
    }
  });
}
