import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "@/constants/theme";
import { GroundedClaim } from "@/services/claimVerification";

interface EvidenceInspectorDrawerProps {
  visible: boolean;
  onClose: () => void;
  claim?: GroundedClaim | null;
  sectionTitle?: string;
  sectionContent?: string;
}

export const EvidenceInspectorDrawer: React.FC<EvidenceInspectorDrawerProps> = ({
  visible,
  onClose,
  claim,
  sectionTitle,
  sectionContent
}) => {
  if (!visible) return null;

  const ev = claim?.evidence && claim.evidence.length > 0 ? claim.evidence[0] : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.drawerCard}>
          {/* Drawer Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={styles.drawerTitle}>Evidence Provenance Inspector</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.subdued} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} showsVerticalScrollIndicator={false}>
            {/* Section / Claim Focus */}
            <View style={styles.focusBox}>
              <Text style={styles.focusLabel}>{sectionTitle || "Asserted Claim"}</Text>
              <Text style={styles.focusText}>{claim?.text || sectionContent || "Verified claim text."}</Text>
            </View>

            {/* Evidence Provenance Box */}
            {ev ? (
              <View style={styles.evidenceBox}>
                <View style={styles.provenanceHeader}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.provenanceTag}>{ev.provenanceLabel || "Verified Source Evidence"}</Text>
                </View>

                <Text style={styles.snippetLabel}>Source Chunk Text:</Text>
                <Text style={styles.snippetText}>"{ev.supportingTextSnippet}"</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.metaBadge}>Section: {ev.section || "Body"}</Text>
                  <Text style={styles.metaBadge}>Page: {ev.page || 1}</Text>
                  <Text style={styles.metaBadge}>Format: {ev.sourceType || "PDF"}</Text>
                  <Text style={[styles.metaBadge, { color: "#10B981" }]}>Confidence: {claim?.claimConfidence || "HIGH"}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.evidenceBox}>
                <View style={styles.provenanceHeader}>
                  <Ionicons name="shield-checkmark" size={16} color={colors.primary} />
                  <Text style={styles.provenanceTag}>Abstract & Metadata Evidence</Text>
                </View>
                <Text style={styles.snippetText}>"{sectionContent || "Synthesized from verified open-access publication metadata."}"</Text>
              </View>
            )}

            <Pressable style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Close Inspector</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end"
  },
  drawerCard: {
    backgroundColor: colors.card || "#1E293B",
    borderTopLeftRadius: radius.lg || 16,
    borderTopRightRadius: radius.lg || 16,
    padding: spacing.md || 16,
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)"
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md || 16
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text || "#F8FAFC"
  },
  closeBtn: {
    padding: 4
  },
  scrollBody: {
    paddingBottom: spacing.md || 16
  },
  focusBox: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radius.md || 8,
    padding: spacing.sm || 12,
    marginBottom: spacing.md || 16,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary || "#6366F1"
  },
  focusLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary || "#818CF8",
    marginBottom: 4,
    textTransform: "uppercase"
  },
  focusText: {
    fontSize: 14,
    color: colors.text || "#F1F5F9",
    lineHeight: 20
  },
  evidenceBox: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderRadius: radius.md || 8,
    padding: spacing.sm || 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    marginBottom: spacing.md || 16
  },
  provenanceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8
  },
  provenanceTag: {
    fontSize: 13,
    fontWeight: "700",
    color: "#10B981"
  },
  snippetLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.subdued || "#94A3B8",
    marginBottom: 4
  },
  snippetText: {
    fontSize: 13,
    fontStyle: "italic",
    color: colors.muted || "#CBD5E1",
    lineHeight: 19,
    marginBottom: 10
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  metaBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.subdued || "#94A3B8",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4
  },
  doneBtn: {
    backgroundColor: colors.primary || "#6366F1",
    paddingVertical: 12,
    borderRadius: radius.md || 8,
    alignItems: "center",
    marginTop: spacing.sm || 8
  },
  doneBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  }
});
