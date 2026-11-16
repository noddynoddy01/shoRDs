import { Linking, Pressable, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import type { Links } from "@/services/social/types";
import { SectionTitle } from "./Ui";

/** Only https links are ever opened; anything else a profile might contain is dropped. */
export function ProfileLinks({ links }: { links: Links }) {
  const { colors, fontSizeScale: k } = useTheme();
  const items: { label: string; url: string }[] = [];
  if (links.orcid) items.push({ label: `ORCID ${links.orcid}`, url: `https://orcid.org/${links.orcid}` });
  if (links.linkedin) items.push({ label: "LinkedIn", url: links.linkedin });
  if (links.github) items.push({ label: "GitHub", url: links.github });
  if (links.website) items.push({ label: "Website", url: links.website });
  links.publications.forEach((u, i) => items.push({ label: `Publication ${i + 1}`, url: u }));
  const safe = items.filter((i) => /^https:\/\//i.test(i.url));
  if (safe.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <SectionTitle>Links</SectionTitle>
      {safe.map((i) => (
        <Pressable key={i.url} onPress={() => void Linking.openURL(i.url)} accessibilityRole="link" accessibilityLabel={`Open ${i.label}`}>
          <Text style={{ color: colors.accent, fontSize: 14 * k, textDecorationLine: "underline" }} numberOfLines={1}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
