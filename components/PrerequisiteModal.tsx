import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export type PrerequisiteConceptPayload = {
  conceptName: string;
  miniExplanation: string;
  whyRequired: string;
  recommendedPaper: {
    title: string;
    doi?: string;
  };
  recommendedVideo: string;
  recommendedStack: string;
};

type PrerequisiteModalProps = {
  visible: boolean;
  onClose: () => void;
  conceptName: string | null;
};

export function PrerequisiteModal({ visible, onClose, conceptName }: PrerequisiteModalProps) {
  const { colors, fontSizeScale } = useTheme();

  if (!conceptName) return null;

  const getConceptPayload = (name: string): PrerequisiteConceptPayload => {
    const lower = name.toLowerCase();
    if (lower.includes("attention") || lower.includes("transformer")) {
      return {
        conceptName: name,
        miniExplanation: "Attention mechanisms allow neural networks to dynamically weigh the importance of different tokens in a sequence regardless of distance.",
        whyRequired: "Essential for understanding parallel self-attention layers and matrix projections (Query, Key, Value).",
        recommendedPaper: {
          title: "Attention Is All You Need (Vaswani et al., 2017)",
          doi: "10.48550/arXiv.1706.03762"
        },
        recommendedVideo: "Visual Guide to Self-Attention & Transformers (12 min)",
        recommendedStack: "Foundations of Transformer Architectures"
      };
    }

    if (lower.includes("cuda") || lower.includes("kernel") || lower.includes("sram")) {
      return {
        conceptName: name,
        miniExplanation: "CUDA SRAM kernels optimize low-level GPU memory bandwidth by tiling matrix operations directly inside fast local SRAM caches.",
        whyRequired: "Critical for understanding memory IO bottlenecks in high-throughput tensor acceleration.",
        recommendedPaper: {
          title: "FlashAttention: Fast and Memory-Efficient Exact Attention (Dao et al., 2022)",
          doi: "10.48550/arXiv.2205.14135"
        },
        recommendedVideo: "GPU Memory Hierarchy & Tensor Cores (15 min)",
        recommendedStack: "Hardware-Aware Deep Learning Systems"
      };
    }

    return {
      conceptName: name,
      miniExplanation: `${name} provides a foundational mathematical or architectural building block required for this manuscript.`,
      whyRequired: `Establishes core prerequisite principles necessary to understand the methodology.`,
      recommendedPaper: {
        title: `Foundational Principles of ${name}`,
        doi: "10.48550/arXiv.2001.00000"
      },
      recommendedVideo: `Introduction to ${name} (10 min)`,
      recommendedStack: `Core Foundations in AI & ML`
    };
  };

  const payload = getConceptPayload(conceptName);
  const styles = getStyles(colors, fontSizeScale);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSubtitle}>PREREQUISITE KNOWLEDGE EXPLORER</Text>
            <Text style={styles.headerTitle}>{payload.conceptName}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Mini Explanation Card */}
          <View style={styles.conceptCard}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="book-outline" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>1. Conceptual Intuition</Text>
            </View>
            <Text style={styles.bodyText}>{payload.miniExplanation}</Text>
          </View>

          {/* Why Required Card */}
          <View style={styles.conceptCard}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="school-outline" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>2. Why This Is Required</Text>
            </View>
            <Text style={styles.bodyText}>{payload.whyRequired}</Text>
          </View>

          {/* Recommended Reading */}
          <View style={styles.conceptCard}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>3. Recommended Foundational Reading</Text>
            </View>
            <Text style={styles.itemTitle}>{payload.recommendedPaper.title}</Text>
            {payload.recommendedPaper.doi && <Text style={styles.itemSub}>DOI: {payload.recommendedPaper.doi}</Text>}
          </View>

          {/* Recommended Video & Stack */}
          <View style={styles.conceptCard}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="videocam-outline" size={18} color={colors.primary} />
              <Text style={styles.cardTitle}>4. Learning Media & Next Stack</Text>
            </View>
            <Text style={styles.itemTitle}>Video: {payload.recommendedVideo}</Text>
            <Text style={[styles.itemTitle, { marginTop: 4 }]}>Stack: {payload.recommendedStack}</Text>
          </View>
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
    conceptCard: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.xs,
      gap: 6
    },
    cardTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    bodyText: {
      fontSize: 13 * scale,
      color: colors.subdued,
      lineHeight: 20
    },
    itemTitle: {
      fontSize: 13 * scale,
      fontWeight: "700",
      color: colors.text
    },
    itemSub: {
      fontSize: 11 * scale,
      color: colors.muted,
      marginTop: 2
    }
  });
}
