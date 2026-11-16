import { Linking, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { Block, Inline, parseMarkdown } from "@/services/social/markdown";

/** Renders assistant Markdown as native text. No HTML is ever interpreted; only https links are tappable. */
export function MarkdownText({ text }: { text: string }) {
  const { colors, fontSizeScale: k } = useTheme();
  const base = { color: colors.text, fontSize: 14.5 * k, lineHeight: 22 * k };
  const inline = (parts: Inline[]) =>
    parts.map((p, i) => {
      if (p.t === "bold") return <Text key={i} style={{ fontWeight: "800" }}>{p.v}</Text>;
      if (p.t === "italic") return <Text key={i} style={{ fontStyle: "italic" }}>{p.v}</Text>;
      if (p.t === "code") return <Text key={i} style={[st.code, { backgroundColor: colors.surface, color: colors.accentSoft }]}>{p.v}</Text>;
      if (p.t === "link") return <Text key={i} accessibilityRole="link" style={{ color: colors.accent, textDecorationLine: "underline" }} onPress={() => Linking.openURL(p.href).catch(() => undefined)}>{p.v}</Text>;
      return <Text key={i}>{p.v}</Text>;
    });
  const render = (b: Block, i: number) => {
    switch (b.t) {
      case "p": return <Text key={i} style={base}>{inline(b.c)}</Text>;
      case "h": return <Text key={i} style={[base, { fontWeight: "800" }]}>{inline(b.c)}</Text>;
      case "quote": return <View key={i} style={[st.quote, { borderLeftColor: colors.accent }]}><Text style={[base, { color: colors.muted }]}>{inline(b.c)}</Text></View>;
      case "code": return <View key={i} style={[st.codeBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text selectable style={[st.mono, { color: colors.text, fontSize: 12.5 * k }]}>{b.v}</Text></View>;
      case "ul": return <View key={i} style={{ gap: 4 }}>{b.items.map((it, n) => <View key={n} style={st.li}><Text style={base}>•</Text><Text style={[base, { flex: 1 }]}>{inline(it)}</Text></View>)}</View>;
      case "ol": return <View key={i} style={{ gap: 4 }}>{b.items.map((it, n) => <View key={n} style={st.li}><Text style={base}>{n + 1}.</Text><Text style={[base, { flex: 1 }]}>{inline(it)}</Text></View>)}</View>;
    }
  };
  return <View style={{ gap: 8 }}>{parseMarkdown(text).map(render)}</View>;
}

const st = StyleSheet.create({
  li: { flexDirection: "row", gap: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  codeBlock: { borderWidth: 1, borderRadius: 8, padding: 10 },
  code: { fontFamily: "Courier", paddingHorizontal: 4, borderRadius: 4 },
  mono: { fontFamily: "Courier" }
});
