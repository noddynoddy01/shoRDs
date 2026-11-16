/**
 * The community screens import their building blocks from here. Each one is now the shared design-system component from components/ui,
 * so the whole community area (profiles, mentors, requests, messaging, notifications, Assistant) follows the same tokens, spacing,
 * focus and touch-target rules. Names are kept so screens did not need to change when the kit was introduced.
 */
import { ReactNode } from "react";
import { Text } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { tokens } from "@/constants/theme";
import { Banner, Button, Card, Avatar, Badge, EmptyState, Input, Pills, Page, Row, SectionHeader, Spinner, Tabs } from "@/components/ui";

export { Page, Card, Avatar, Badge, Pills, Row, Banner };
export const Btn = Button;
export const Field = Input;
export const Empty = EmptyState;
export const Loading = Spinner;
export const Segmented = Tabs;
export const SectionTitle = ({ children }: { children: ReactNode }) => <SectionHeader title={String(children)} />;

export const Muted = ({ children, numberOfLines }: { children: ReactNode; numberOfLines?: number }) => {
  const { colors, fontSizeScale: k } = useTheme();
  return <Text numberOfLines={numberOfLines} style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 20 * k }}>{children}</Text>;
};
export const Body = ({ children }: { children: ReactNode }) => {
  const { colors, fontSizeScale: k } = useTheme();
  return <Text style={{ color: colors.text, fontSize: 14 * k, lineHeight: 22 * k }}>{children}</Text>;
};
