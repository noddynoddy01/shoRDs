import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal as RNModal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { radius, spacing, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { Button, IconName, PState } from "./Button";
import { useReducedMotion } from "./motion";

/** A centred dialog (a bottom sheet on phones). Escape and a tap on the backdrop close it; the title is announced; actions sit in the footer. */
export function Modal({ visible, title, onClose, children, actions }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const { colors, fontSizeScale: k } = useTheme();
  const { width } = useWindowDimensions();
  const sheet = width < tokens.breakpoints.tablet;
  return (
    <RNModal visible={visible} transparent animationType={useReducedMotion() ? "none" : "fade"} onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable style={[s.backdrop, { backgroundColor: colors.overlay, justifyContent: sheet ? "flex-end" : "center" }]} onPress={onClose} accessibilityLabel="Close dialog">
        <Pressable onPress={() => undefined} accessible={false} style={[s.panel, { backgroundColor: colors.card, borderColor: colors.border }, sheet ? s.sheet : s.dialog]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text accessibilityRole="header" style={{ flex: 1, color: colors.text, fontSize: tokens.fontSize.xl * k, fontWeight: tokens.weight.heavy }}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}><Ionicons name="close" size={22} color={colors.muted} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {actions ? <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" }}>{actions}</View> : null}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

/** Confirm/cancel helper used for irreversible or consequential choices (changing a profile type, revoking a mentor). */
export function ConfirmDialog({ visible, title, message, confirmLabel, danger, busy, onConfirm, onCancel }: { visible: boolean; title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <Modal visible={visible} title={title} onClose={onCancel} actions={<><Button kind="secondary" label="Cancel" onPress={onCancel} /><Button kind={danger ? "danger" : "primary"} label={confirmLabel} onPress={onConfirm} loading={busy} /></>}>
      <Text style={{ color: colors.muted, fontSize: tokens.fontSize.md * k, lineHeight: 22 * k }}>{message}</Text>
    </Modal>
  );
}

export type MenuItem = { label: string; icon?: IconName; onPress: () => void; danger?: boolean };

/** A small anchored menu: a trigger button that reveals a list. Closes on selection or a tap outside. */
export function Dropdown({ trigger, items, accessibilityLabel, align = "right" }: { trigger: ReactNode; items: MenuItem[]; accessibilityLabel: string; align?: "left" | "right" }) {
  const { colors, fontSizeScale: k } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ zIndex: open ? 100 : 1 }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ expanded: open }} aria-expanded={open} hitSlop={6}>{trigger}</Pressable>
      {open ? (
        <>
          <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close menu" style={{ position: "absolute", top: -2000, bottom: -2000, left: -2000, right: -2000 }} />
          <View accessibilityRole="menu" style={[s.menu, { backgroundColor: colors.card, borderColor: colors.border }, align === "right" ? { right: 0 } : { left: 0 }, tokens.shadow.md]}>
            {items.map((it) => (
              <Pressable key={it.label} accessibilityRole="menuitem" onPress={() => { setOpen(false); it.onPress(); }}
                style={({ hovered }: PState) => [s.menuItem, hovered && { backgroundColor: colors.surface }]}>
                {it.icon ? <Ionicons name={it.icon} size={17} color={it.danger ? tokens.danger : colors.muted} /> : null}
                <Text style={{ color: it.danger ? tokens.danger : colors.text, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.medium }}>{it.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Tabs: a segmented row. `badge` shows a count when it is above zero. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; badge?: number }[]; onChange: (v: T) => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={[s.tabs, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on}
            style={({ hovered }: PState) => [s.tab, on ? { backgroundColor: colors.card, borderColor: colors.border } : hovered ? { backgroundColor: colors.card + "88" } : null]}>
            <Text style={{ color: on ? colors.text : colors.muted, fontWeight: on ? tokens.weight.bold : tokens.weight.medium, fontSize: tokens.fontSize.sm * k }}>{o.label}{o.badge ? ` (${o.badge})` : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A single-choice picker: stacked or wrapped option chips with a selected state (use for small sets such as availability or academic level). */
export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.semibold }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on} accessibilityLabel={o.label}
              style={({ hovered, focused }: PState) => [s.chip, { borderColor: on ? colors.primary : hovered ? colors.muted : colors.border, backgroundColor: on ? colors.primary + "18" : colors.surface }, focused && { borderColor: tokens.focusRing }]}>
              {on ? <Ionicons name="checkmark" size={14} color={colors.primary} /> : null}
              <Text style={{ color: on ? colors.primary : colors.text, fontSize: tokens.fontSize.sm * k, fontWeight: on ? tokens.weight.bold : tokens.weight.medium }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Banner({ kind = "error", text, action }: { kind?: "error" | "info" | "success" | "warning"; text: string; action?: { label: string; onPress: () => void } }) {
  const { colors, fontSizeScale: k } = useTheme();
  const tone = kind === "error" ? tokens.danger : kind === "success" ? colors.success : kind === "warning" ? colors.warning : colors.accent;
  return (
    <View accessibilityRole="alert" style={[s.banner, { borderColor: tone + "55", backgroundColor: tone + "12" }]}>
      <Ionicons name={kind === "error" ? "alert-circle" : kind === "success" ? "checkmark-circle" : kind === "warning" ? "warning" : "information-circle"} size={18} color={tone} />
      <Text style={{ color: colors.text, flex: 1, fontSize: tokens.fontSize.sm * k, lineHeight: 19 * k }}>{text}</Text>
      {action ? <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8}><Text style={{ color: tone, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.sm * k }}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

type ToastKind = "success" | "error" | "info";
type ToastApi = { show: (text: string, kind?: ToastKind) => void };
const ToastCtx = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastCtx);

/** Short confirmations ("Saved"). Announced politely, dismissed after a few seconds, never covers the bottom navigation. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, fontSizeScale: k } = useTheme();
  const reduced = useReducedMotion();
  const [toast, setToast] = useState<{ id: number; text: string; kind: ToastKind } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: ToastKind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), text, kind });
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => { if (toast) { if (reduced) opacity.setValue(1); else Animated.timing(opacity, { toValue: 1, duration: tokens.motion.base, useNativeDriver: true }).start(); } else opacity.setValue(0); }, [toast, reduced, opacity]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const api = useMemo(() => ({ show }), [show]);
  const tone = toast?.kind === "error" ? tokens.danger : toast?.kind === "success" ? colors.success : colors.accent;
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[s.toast, { opacity, backgroundColor: colors.cardElevated, borderColor: tone + "88" }, tokens.shadow.md]}>
          <Ionicons name={toast.kind === "error" ? "alert-circle" : toast.kind === "success" ? "checkmark-circle" : "information-circle"} size={18} color={tone} />
          <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, flexShrink: 1 }}>{toast.text}</Text>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", padding: spacing.md },
  panel: { borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  dialog: { width: "100%", maxWidth: 520, borderRadius: radius.lg },
  sheet: { width: "100%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderRadius: radius.lg },
  menu: { position: "absolute", top: 44, minWidth: 200, borderWidth: 1, borderRadius: radius.md, paddingVertical: 6, zIndex: 101 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 40 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 3 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  toast: { position: "absolute", top: 16, alignSelf: "center", maxWidth: 420, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, zIndex: 2000 }
});
