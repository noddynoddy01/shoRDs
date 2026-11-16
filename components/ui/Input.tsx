import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { radius, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

/** Labelled text input with help/error text, focus ring, and an optional show/hide toggle for passwords. The error is announced to screen readers. */
export function Input({ label, error, help, password, ...input }: { label: string; error?: string | null; help?: string; password?: boolean } & TextInputProps) {
  const { colors, fontSizeScale: k } = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const border = error ? tokens.danger : focused ? colors.primary : colors.border;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.semibold }}>{label}</Text>
      <View style={[s.wrap, { backgroundColor: colors.surface, borderColor: border, borderWidth: focused || error ? 2 : 1 }]}>
        <TextInput
          placeholderTextColor={colors.subdued}
          accessibilityLabel={label}
          {...input}
          secureTextEntry={password ? !shown : input.secureTextEntry}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={[s.input, { color: colors.text, fontSize: tokens.fontSize.md * k }, input.multiline && { minHeight: 96, textAlignVertical: "top" }, input.style, { outlineStyle: "none" } as object]}
        />
        {password ? (
          <Pressable onPress={() => setShown((v) => !v)} accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} hitSlop={10} style={s.eye}>
            <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: tokens.danger, fontSize: tokens.fontSize.xs * k }}>{error}</Text> : help ? <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{help}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", borderRadius: radius.md },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 11, minHeight: tokens.minTouch },
  eye: { paddingHorizontal: 12, height: tokens.minTouch, justifyContent: "center" }
});
