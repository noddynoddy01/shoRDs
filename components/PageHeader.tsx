import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/constants/theme";
import { Logo } from "./Logo";

type PageHeaderProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
};

export function PageHeader({ kicker, title, subtitle }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <Logo />
      <View style={styles.copy}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 12
  },
  copy: {
    gap: 5
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: 0
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  }
});
