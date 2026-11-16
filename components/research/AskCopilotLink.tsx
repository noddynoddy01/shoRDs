/**
 * "Ask the Research Copilot about this paper" button for the paper screen. It is offered only when the record has a DOI, PubMed id or
 * arXiv id the server can resolve, and it only navigates: no request is made until the user asks a question on the Copilot screen.
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, spacing } from "@/constants/theme";
import { backendPaperRef } from "@/services/analysisClient";

export function AskCopilotLink({ paper }: { paper: { id?: unknown; doi?: unknown; title?: string } }) {
  const router = useRouter();
  const ref = backendPaperRef(paper);
  if (!ref) return null;
  return (
    <Pressable
      style={s.btn}
      accessibilityRole="button"
      accessibilityLabel="Ask the Research Copilot about this paper"
      onPress={() => router.push({ pathname: "/research/copilot", params: { ref, title: paper.title ?? "" } } as never)}
    >
      <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
      <Text style={s.text}>Ask the Research Copilot about this paper</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.text, fontWeight: "600", fontSize: 14 }
});
