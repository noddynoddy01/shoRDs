import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors } from "../constants/theme";
import { Logo } from "./Logo";

type PageHeaderProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
};

export function PageHeader({ kicker, title, subtitle }: PageHeaderProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

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

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    header: {
      gap: 12
    },
    copy: {
      gap: 5
    },
    kicker: {
      color: colors.accent,
      fontSize: 12 * scale,
      fontWeight: "800",
      textTransform: "uppercase"
    },
    title: {
      color: colors.text,
      fontSize: 26 * scale,
      lineHeight: 32 * scale,
      fontWeight: "800",
      letterSpacing: 0
    },
    subtitle: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    }
  });
}
