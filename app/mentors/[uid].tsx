import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ProfileLinks } from "@/components/social/ProfileLinks";
import { useLoad } from "@/components/social/useLoad";
import { RequestMentorshipModal } from "@/components/social/RequestMentorshipModal";
import { Avatar, Badge, Banner, Btn, Card, Loading, Muted, Page, Pills, Row, SectionTitle } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { AVAILABILITY_LABEL, LEVEL_LABEL, PERSONA_LABEL, describeSocialError } from "@/services/social/format";
import { social } from "@/services/social/instance";

/** One verified mentor. The page 404s for anyone who is not an approved mentor, so it cannot be used to look people up. */
export default function MentorDetail() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { colors, fontSizeScale: k } = useTheme();
  const { profile: me } = useProfile();
  const { data: m, error, loading, reload } = useLoad(() => social.getMentor(String(uid)), [uid]);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  if (loading) return <Page title="Mentor"><Loading /></Page>;
  if (error || !m) return <Page title="Mentor"><Banner text={error || "Mentor not found."} action={{ label: "Retry", onPress: () => void reload() }} /></Page>;

  const self = me?.uid === m.uid;
  const ready = !!me?.own?.onboardingCompleted;
  const full = m.openSlots === 0;
  const message = async () => {
    setMsgBusy(true); setMsgError(null);
    try { const c = await social.startDirect(m.uid); router.push(`/messages/${c.conversationId}` as never); }
    catch (e) { setMsgError(describeSocialError(e)); }
    finally { setMsgBusy(false); }
  };

  return (
    <Page title={m.displayName} subtitle="Verified mentor">
      <Card>
        <Row>
          <Avatar name={m.displayName} uri={m.photoUrl} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 * k }}>{m.displayName}</Text>
            {m.headline ? <Muted>{m.headline}</Muted> : null}
            <Row style={{ flexWrap: "wrap" }}>
              <Badge label="Verified mentor" tone="good" icon="shield-checkmark" />
              <Badge label={AVAILABILITY_LABEL[m.availability]} tone={m.availability === "AVAILABLE" ? "good" : m.availability === "LIMITED" ? "warn" : "neutral"} />
            </Row>
          </View>
        </Row>
        <Muted>{[PERSONA_LABEL[m.persona], m.institution, m.department, m.academicLevel ? LEVEL_LABEL[m.academicLevel] : null].filter(Boolean).join(" · ")}</Muted>
        {m.openSlots !== null && <Muted>{m.openSlots} open mentoring {m.openSlots === 1 ? "slot" : "slots"}</Muted>}
      </Card>
      {sent ? <Banner kind="success" text="Request sent. The mentor has been notified and can accept or decline. You can follow it under Mentorship requests." action={{ label: "View requests", onPress: () => router.push("/mentorship/requests" as never) }} /> : null}
      {msgError ? <Banner text={msgError} /> : null}
      {!self && (
        <Card>
          {!ready && <Banner kind="info" text="Finish your profile to request mentorship or send messages." action={{ label: "Finish profile", onPress: () => router.push("/onboarding" as never) }} />}
          {full && <Muted>This mentor currently has no open slots; a request may be declined.</Muted>}
          <Row style={{ flexWrap: "wrap" }}>
            <Btn label="Request mentorship" icon="hand-right" onPress={() => setOpen(true)} disabled={!ready || sent} />
            <Btn kind="secondary" label="Message" icon="chatbubble-outline" onPress={() => void message()} loading={msgBusy} disabled={!ready} />
          </Row>
          <Muted>Messaging works if the mentor accepts direct messages or you already have a mentorship. Otherwise the app will say why.</Muted>
        </Card>
      )}
      {m.bio ? <><SectionTitle>About</SectionTitle><Body text={m.bio} /></> : null}
      {m.expertise.length > 0 && <><SectionTitle>Expertise</SectionTitle><Pills items={m.expertise} /></>}
      {m.researchDomains.length > 0 && <><SectionTitle>Research domains</SectionTitle><Pills items={m.researchDomains} /></>}
      {m.researchInterests.length > 0 && <><SectionTitle>Interests</SectionTitle><Pills items={m.researchInterests} /></>}
      {m.skills.length > 0 && <><SectionTitle>Skills</SectionTitle><Pills items={m.skills} /></>}
      <ProfileLinks links={m.links} />
      <RequestMentorshipModal mentorUid={m.uid} mentorName={m.displayName} visible={open} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setSent(true); }} />
    </Page>
  );
}

function Body({ text }: { text: string }) { const { colors, fontSizeScale: k } = useTheme(); return <Text style={{ color: colors.text, fontSize: 14 * k, lineHeight: 21 * k }} selectable>{text}</Text>; }
