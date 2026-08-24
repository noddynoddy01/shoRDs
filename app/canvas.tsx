import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export type CanvasNodeType =
  | "Paper"
  | "Concept"
  | "Dataset"
  | "Model"
  | "Author"
  | "Institution"
  | "Benchmark"
  | "Experiment"
  | "Research Question"
  | "Hypothesis"
  | "Implementation"
  | "Personal Note";

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  color: string;
};

export default function InteractiveCanvasScreen() {
  const { colors, fontSizeScale } = useTheme();

  const [nodes, setNodes] = useState<CanvasNode[]>([
    { id: "node-1", type: "Paper", title: "Attention Is All You Need", subtitle: "Vaswani et al. (2017)", x: 20, y: 20, color: "#3B82F6" },
    { id: "node-2", type: "Concept", title: "Sparse Attention Kernels", subtitle: "IO-Aware SRAM Partitioning", x: 180, y: 20, color: "#8B5CF6" },
    { id: "node-3", type: "Model", title: "FlashAttention-2", subtitle: "Dao et al. (2023)", x: 20, y: 120, color: "#10B981" },
    { id: "node-4", type: "Dataset", title: "ImageNet-1K Benchmark", subtitle: "1.2M Training Images", x: 180, y: 120, color: "#F59E0B" },
    { id: "node-5", type: "Hypothesis", title: "Hardware-AwareNAS Hypothesis", subtitle: "Reduces GPU bandwidth bottlenecks", x: 20, y: 220, color: "#EC4899" }
  ]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(["node-1", "node-3"]);
  const [globalAiQuery, setGlobalAiQuery] = useState("Across all selected papers, what are common limitations?");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isAskingAi, setIsAskingAi] = useState(false);

  const toggleNodeSelection = (id: string) => {
    if (selectedNodeIds.includes(id)) {
      setSelectedNodeIds(selectedNodeIds.filter(n => n !== id));
    } else {
      setSelectedNodeIds([...selectedNodeIds, id]);
    }
  };

  const handleAskCanvasAi = () => {
    if (!globalAiQuery.trim()) return;
    setIsAskingAi(true);
    setTimeout(() => {
      setAiAnswer(
        `[Canvas AI Global Analysis]: Across the ${selectedNodeIds.length} selected nodes ("Attention Is All You Need" & "FlashAttention-2"):\n\n` +
        `1. Common Limitations: High GPU memory consumption during large batch-size inference.\n` +
        `2. Shared Benchmark Dataset: Evaluated on WMT 14 English-German & ImageNet-1K.\n` +
        `3. Thesis Synthesis: FlashAttention optimizes Vaswani's initial self-attention kernel by making memory access IO-aware.`
      );
      setIsAskingAi(false);
    }, 1000);
  };

  const handleGenerateReviewFromCanvas = () => {
    router.push("/review-mode" as any);
  };

  const handleIterativeSearchLoop = () => {
    const newPaperNode: CanvasNode = {
      id: `node-${Date.now()}`,
      type: "Paper",
      title: "Mamba-Edge: Selective State Space Quantization",
      subtitle: "Gu et al. (2024) [Iterative Search Result]",
      x: 180,
      y: 220,
      color: "#3B82F6"
    };
    setNodes([...nodes, newPaperNode]);
    setSelectedNodeIds([...selectedNodeIds, newPaperNode.id]);
  };

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Screen style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>CLOSED-BETA WORKSPACE</Text>
          <Text style={styles.headerTitle}>Interactive Research Canvas</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable style={styles.searchLoopBtn} onPress={handleIterativeSearchLoop}>
            <Ionicons name="search-outline" size={14} color={colors.primary} />
            <Text style={styles.searchLoopText}>+ Search Loop</Text>
          </Pressable>
          <Pressable style={styles.reviewTriggerBtn} onPress={handleGenerateReviewFromCanvas}>
            <Ionicons name="sparkles" size={15} color="#FFF" />
            <Text style={styles.reviewTriggerText}>Review</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Node Type Selector Legend */}
        <Text style={styles.sectionTitle}>Knowledge Map Node Types (12 Node Types Supported)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.legendRow}>
          {[
            "Paper", "Concept", "Dataset", "Model", "Author", "Institution",
            "Benchmark", "Experiment", "Research Question", "Hypothesis", "Implementation", "Personal Note"
          ].map((type, idx) => (
            <View key={idx} style={styles.typeTag}>
              <Text style={styles.typeTagText}>{type}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Canvas Visual Grid */}
        <View style={styles.canvasGrid}>
          <Text style={styles.canvasGridHint}>Tap nodes to select & connect ideas for Canvas AI Analysis</Text>

          {nodes.map(node => {
            const isSelected = selectedNodeIds.includes(node.id);
            return (
              <Pressable
                key={node.id}
                style={[
                  styles.nodeCard,
                  { borderColor: node.color },
                  isSelected && styles.selectedNodeCard
                ]}
                onPress={() => toggleNodeSelection(node.id)}
              >
                <View style={styles.nodeHeader}>
                  <Text style={[styles.nodeTypeTag, { color: node.color }]}>[{node.type.toUpperCase()}]</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={16} color={node.color} />}
                </View>
                <Text style={styles.nodeTitle}>{node.title}</Text>
                <Text style={styles.nodeSubtitle}>{node.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Global Canvas AI Query Interface */}
        <View style={styles.aiQueryCard}>
          <Text style={styles.aiQueryTitle}>Global Canvas AI Analysis ({selectedNodeIds.length} Nodes Selected)</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={globalAiQuery}
              onChangeText={setGlobalAiQuery}
              placeholder="Ask AI across all selected canvas nodes..."
              placeholderTextColor={colors.muted}
            />
            <Pressable style={styles.askBtn} onPress={handleAskCanvasAi}>
              <Ionicons name="send" size={16} color="#FFF" />
            </Pressable>
          </View>

          {isAskingAi ? (
            <View style={{ paddingVertical: spacing.md, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ fontSize: 12 * fontSizeScale, color: colors.muted, marginTop: 4 }}>Synthesizing cross-node knowledge map...</Text>
            </View>
          ) : aiAnswer ? (
            <View style={styles.answerBox}>
              <Text style={styles.answerText}>{aiAnswer}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    backBtn: { padding: 4, marginRight: spacing.sm },
    headerSubtitle: { fontSize: 10 * scale, fontWeight: "800", color: colors.primary, letterSpacing: 1 },
    headerTitle: { fontSize: 16 * scale, fontWeight: "800", color: colors.text },
    searchLoopBtn: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, paddingHorizontal: spacing.xs + 4, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, gap: 4 },
    searchLoopText: { color: colors.primary, fontWeight: "700", fontSize: 11 * scale },
    reviewTriggerBtn: { flexDirection: "row", alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, gap: 4 },
    reviewTriggerText: { color: "#FFF", fontWeight: "700", fontSize: 11 * scale },
    scrollContent: { padding: spacing.md, paddingBottom: 60 },
    sectionTitle: { fontSize: 12 * scale, fontWeight: "700", color: colors.primary, marginBottom: spacing.xs },
    legendRow: { flexDirection: "row", marginBottom: spacing.md },
    typeTag: { backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs },
    typeTagText: { fontSize: 10 * scale, color: colors.subdued, fontWeight: "600" },
    canvasGrid: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: 280 },
    canvasGridHint: { fontSize: 11 * scale, color: colors.muted, marginBottom: spacing.md },
    nodeCard: { backgroundColor: colors.background, padding: spacing.sm + 2, borderRadius: radius.sm, marginBottom: spacing.sm, borderWidth: 2 },
    selectedNodeCard: { backgroundColor: colors.surface },
    nodeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
    nodeTypeTag: { fontSize: 10 * scale, fontWeight: "800" },
    nodeTitle: { fontSize: 13 * scale, fontWeight: "800", color: colors.text },
    nodeSubtitle: { fontSize: 11 * scale, color: colors.subdued },
    aiQueryCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary },
    aiQueryTitle: { fontSize: 13 * scale, fontWeight: "800", color: colors.primary, marginBottom: spacing.xs },
    inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    input: { flex: 1, backgroundColor: colors.background, color: colors.text, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, fontSize: 12 * scale },
    askBtn: { backgroundColor: colors.primary, padding: spacing.xs + 4, borderRadius: radius.sm },
    answerBox: { backgroundColor: colors.background, padding: spacing.md, borderRadius: radius.sm, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
    answerText: { fontSize: 12 * scale, color: colors.text, lineHeight: 18 }
  });
}
