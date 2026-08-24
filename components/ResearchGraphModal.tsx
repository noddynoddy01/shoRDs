import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export type GraphNode = {
  id: string;
  concept: string;
  paperTitle: string;
  year: number;
  authors: string;
  impact: string;
  nextConceptId?: string;
};

type ResearchGraphModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelectNode?: (node: GraphNode) => void;
};

export function ResearchGraphModal({ visible, onClose, onSelectNode }: ResearchGraphModalProps) {
  const { colors, fontSizeScale } = useTheme();

  const graphNodes: GraphNode[] = [
    {
      id: "node-1",
      concept: "1. Attention Mechanisms",
      paperTitle: "Attention Is All You Need",
      year: 2017,
      authors: "Vaswani et al.",
      impact: "Replaces recurrence with parallel self-attention layers.",
      nextConceptId: "node-2"
    },
    {
      id: "node-2",
      concept: "2. Pretrained Masked Language Models",
      paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
      year: 2018,
      authors: "Devlin et al.",
      impact: "Introduces bidirectional context representation.",
      nextConceptId: "node-3"
    },
    {
      id: "node-3",
      concept: "3. Optimized Pretraining Regimes",
      paperTitle: "RoBERTa: A Robustly Optimized BERT Pretraining Approach",
      year: 2019,
      authors: "Liu et al.",
      impact: "Removes NSP task & trains on longer sequences.",
      nextConceptId: "node-4"
    },
    {
      id: "node-4",
      concept: "4. Autoregressive Generative Models",
      paperTitle: "Language Models are Few-Shot Learners (GPT-3)",
      year: 2020,
      authors: "Brown et al.",
      impact: "Demonstrates emergent zero-shot & few-shot capabilities.",
      nextConceptId: "node-5"
    },
    {
      id: "node-5",
      concept: "5. Open Foundation Models",
      paperTitle: "LLaMA: Open and Efficient Foundation Language Models",
      year: 2023,
      authors: "Touvron et al.",
      impact: "Delivers SOTA open weights on standard hardware.",
      nextConceptId: "node-6"
    },
    {
      id: "node-6",
      concept: "6. Hardware-Aware State Space Models",
      paperTitle: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
      year: 2023,
      authors: "Gu & Dao et al.",
      impact: "Achieves linear-time scaling beyond standard attention.",
    }
  ];

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSubtitle}>INTERACTIVE RESEARCH CONCEPT GRAPH</Text>
            <Text style={styles.headerTitle}>Domain Trajectory & Lineage</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.introText}>
            Tap any concept node to inspect foundational papers, citation evolution, and methodological lineage.
          </Text>

          {/* Interactive Graph Node List */}
          {graphNodes.map((node, idx) => (
            <View key={node.id} style={styles.nodeWrapper}>
              <Pressable
                style={styles.nodeCard}
                onPress={() => onSelectNode ? onSelectNode(node) : null}
              >
                <View style={styles.nodeHeaderRow}>
                  <Text style={styles.conceptTitle}>{node.concept}</Text>
                  <Text style={styles.yearTag}>{node.year}</Text>
                </View>
                <Text style={styles.paperTitle}>{node.paperTitle}</Text>
                <Text style={styles.authorsText}>{node.authors}</Text>
                <Text style={styles.impactText}>{node.impact}</Text>
              </Pressable>

              {/* Connecting Line Indicator */}
              {idx < graphNodes.length - 1 && (
                <View style={styles.connectorContainer}>
                  <View style={styles.connectorLine} />
                  <Ionicons name="chevron-down" size={16} color={colors.primary} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: spacing.md
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    headerSubtitle: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 1
    },
    headerTitle: {
      fontSize: 16 * scale,
      fontWeight: "800",
      color: colors.text
    },
    closeBtn: {
      padding: 4
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 60
    },
    introText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      marginBottom: spacing.md,
      lineHeight: 18
    },
    nodeWrapper: {
      alignItems: "center",
      width: "100%"
    },
    nodeCard: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary
    },
    nodeHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4
    },
    conceptTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    yearTag: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.muted,
      backgroundColor: colors.background,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4
    },
    paperTitle: {
      fontSize: 14 * scale,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2
    },
    authorsText: {
      fontSize: 12 * scale,
      color: colors.muted,
      marginBottom: 6
    },
    impactText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      lineHeight: 18
    },
    connectorContainer: {
      alignItems: "center",
      marginVertical: spacing.xs
    },
    connectorLine: {
      width: 2,
      height: 16,
      backgroundColor: colors.primary + "60"
    }
  });
}
