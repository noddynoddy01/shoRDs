import { Text, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/context/ThemeContext";
import { AVAILABILITY_LABEL, PERSONA_LABEL } from "@/services/social/format";
import type { Profile } from "@/services/social/types";
import { Avatar, Badge, Card, Pills, Row } from "./Ui";

export function MentorCard({ m }: { m: Profile }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <Card onPress={() => router.push(`/mentors/${m.uid}` as never)} accessibilityLabel={`Open mentor ${m.displayName}`}>
      <Row>
        <Avatar name={m.displayName} uri={m.photoUrl} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 * k }} numberOfLines={1}>{m.displayName}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 * k }} numberOfLines={2}>{m.headline || [PERSONA_LABEL[m.persona], m.institution].filter(Boolean).join(" · ")}</Text>
        </View>
        <Badge label="Verified mentor" tone="good" icon="shield-checkmark" />
      </Row>
      {m.expertise.length > 0 && <Pills items={m.expertise.slice(0, 4)} />}
      <Row style={{ justifyContent: "space-between" }}>
        <Badge label={AVAILABILITY_LABEL[m.availability]} tone={m.availability === "AVAILABLE" ? "good" : m.availability === "LIMITED" ? "warn" : "neutral"} />
        {m.openSlots !== null && <Text style={{ color: colors.muted, fontSize: 12 * k }}>{m.openSlots} open {m.openSlots === 1 ? "slot" : "slots"}</Text>}
      </Row>
    </Card>
  );
}
