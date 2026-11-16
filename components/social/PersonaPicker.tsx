import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { radius, spacing, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { PERSONA_CHOICES, SelectablePersona } from "@/services/social/intent";
import type { PState } from "@/components/ui/Button";

/**
 * "How would you like to use shoRDs?" Four selectable cards (radio group). Choosing one only records what the person says they are; it does not
 * verify or authorise anything. The Mentor card says plainly that verification by an administrator is required.
 */
export function PersonaPicker({ value, onChange, columns }: { value: SelectablePersona | null; onChange: (p: SelectablePersona) => void; columns?: 1 | 2 | 4 }) {
  const { colors, fontSizeScale: k } = useTheme();
  const { width } = useWindowDimensions();
  // Columns follow the width this control is actually given (a narrow form column on a wide screen must not get four cards across).
  const [own, setOwn] = useState<number | null>(null);
  const room = own ?? width;
  const cols = columns ?? (room >= 940 ? 4 : room >= 520 ? 2 : 1);
  return (
    <View onLayout={(e) => setOwn(Math.round(e.nativeEvent.layout.width))} accessibilityRole="radiogroup" accessibilityLabel="How would you like to use shoRDs?" style={[s.grid, { gap: spacing.sm }]}>
      {PERSONA_CHOICES.map((c) => {
        const on = c.persona === value;
        return (
          <Pressable
            key={c.persona}
            onPress={() => onChange(c.persona as SelectablePersona)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            aria-checked={on}
            accessibilityLabel={`${c.title}. ${c.tagline} ${c.points.join(". ")}.${c.notice ? " " + c.notice : ""}`}
            style={({ hovered, focused }: PState) => [
              s.card,
              { width: cols === 1 ? "100%" : cols === 2 ? "48.8%" : "24%", borderColor: on ? colors.primary : hovered ? colors.muted : colors.border, backgroundColor: on ? colors.primary + "12" : colors.card, borderWidth: on || focused ? 2 : 1 },
              focused && { borderColor: tokens.focusRing }
            ]}
          >
            <View style={s.top}>
              <View style={[s.icon, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}>
                <Ionicons name={c.icon} size={22} color={on ? "#FFFFFF" : colors.muted} />
              </View>
              <View style={[s.radio, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : "transparent" }]}>
                {on ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
              </View>
            </View>
            <Text style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.heavy }}>{c.title}</Text>
            <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 19 * k }}>{c.tagline}</Text>
            <View style={{ gap: 6, marginTop: 2 }}>
              {c.points.map((p) => (
                <View key={p} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={on ? colors.primary : colors.subdued} />
                  <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, flex: 1 }}>{p}</Text>
                </View>
              ))}
            </View>
            {c.notice ? (
              <View style={[s.notice, { backgroundColor: colors.warning + "14", borderColor: colors.warning + "44" }]}>
                <Ionicons name="shield-checkmark-outline" size={15} color={colors.warning} />
                <Text style={{ color: colors.text, fontSize: tokens.fontSize.xs * k, lineHeight: 17 * k, flex: 1 }}>{c.notice}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: { borderRadius: radius.lg, padding: spacing.md, gap: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  icon: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  notice: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1, borderRadius: radius.sm, padding: 8, marginTop: 4 }
});
