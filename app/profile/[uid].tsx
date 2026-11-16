import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ProfileLinks } from "@/components/social/ProfileLinks";
import { RequestMentorshipModal } from "@/components/social/RequestMentorshipModal";
import { useLoad } from "@/components/social/useLoad";
import { Avatar, Badge, Banner, Btn, Card, Loading, Muted, Page, Pills, Row, SectionTitle } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { AVAILABILITY_LABEL, LEVEL_LABEL, PERSONA_LABEL, describeSocialError } from "@/services/social/format";
import { social } from "@/services/social/instance";

/**
 * A profile page. For your own uid it is your full profile (with the private settings and a link to edit). For anyone else it is the public
 * view the server chooses to return: no e-mail, and unfinished profiles are not found.
 */
export default function ProfileScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { colors, fontSizeScale: k } = useTheme();
  const { profile: me } = useProfile();
  const target = String(uid);
  const { data: p, error, loading, reload } = useLoad(() => social.getProfile(target), [target]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Page title="Profile"><Loading /></Page>;
  if (error || !p) return <Page title="Profile"><Banner text={error || "Profile not found."} action={{ label: "Retry", onPress: () => void reload() }} /></Page>;

  const self = me?.uid === p.uid;
  const ready = !!me?.own?.onboardingCompleted;
  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote({ kind: "success", text: done }); }
    catch (e) { setNote({ kind: "error", text: describeSocialError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <Page title={p.displayName} subtitle={self ? "Your profile" : PERSONA_LABEL[p.persona]} right={self ? <Btn small kind="secondary" label="Edit" icon="create-outline" onPress={() => router.push("/profile/edit" as never)} /> : undefined}>
      <Card>
        <Row>
          <Avatar name={p.displayName} uri={p.photoUrl} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 * k }}>{p.displayName}</Text>
            {p.headline ? <Muted>{p.headline}</Muted> : null}
            <Row style={{ flexWrap: "wrap" }}>
              <Badge label={PERSONA_LABEL[p.persona]} />
              {p.verifiedMentor ? <Badge label="Verified mentor" tone="good" icon="shield-checkmark" /> : null}
              {p.availability !== "UNAVAILABLE" ? <Badge label={AVAILABILITY_LABEL[p.availability]} tone="accent" /> : null}
            </Row>
          </View>
        </Row>
        <Muted>{[p.institution, p.department, p.academicLevel ? LEVEL_LABEL[p.academicLevel] : null].filter(Boolean).join(" · ")}</Muted>
        {self && p.own ? <Muted>Email (only you can see this): {p.own.email || "none on file"}</Muted> : null}
        {self && p.own && !p.own.onboardingCompleted ? <Banner kind="info" text="Your profile is not finished, so other people cannot see it yet." action={{ label: "Finish", onPress: () => router.push("/onboarding" as never) }} /> : null}
      </Card>
      {note ? <Banner kind={note.kind} text={note.text} /> : null}
      {!self && (
        <Card>
          {!ready && <Banner kind="info" text="Finish your own profile first to message people or request mentorship." action={{ label: "Finish profile", onPress: () => router.push("/onboarding" as never) }} />}
          <Row style={{ flexWrap: "wrap" }}>
            {p.verifiedMentor ? <Btn label="Request mentorship" icon="hand-right" onPress={() => setOpen(true)} disabled={!ready} /> : null}
            <Btn kind="secondary" label="Message" icon="chatbubble-outline" disabled={!ready || busy} onPress={() => void act(async () => { const c = await social.startDirect(p.uid); router.push(`/messages/${c.conversationId}` as never); }, "Conversation opened.")} />
            <Btn kind="ghost" label="Block" icon="ban" disabled={busy} onPress={() => void act(() => social.blockUser(p.uid), "Blocked. They can no longer message you.")} />
          </Row>
          <Muted>Messaging works if this person accepts direct messages or you already have a mentorship; otherwise the app says why.</Muted>
        </Card>
      )}
      {p.bio ? <><SectionTitle>About</SectionTitle><Text style={{ color: colors.text, fontSize: 14 * k, lineHeight: 21 * k }} selectable>{p.bio}</Text></> : null}
      {p.researchInterests.length > 0 && <><SectionTitle>Research interests</SectionTitle><Pills items={p.researchInterests} /></>}
      {p.researchDomains.length > 0 && <><SectionTitle>Research domains</SectionTitle><Pills items={p.researchDomains} /></>}
      {p.expertise.length > 0 && <><SectionTitle>Expertise</SectionTitle><Pills items={p.expertise} /></>}
      {p.skills.length > 0 && <><SectionTitle>Skills</SectionTitle><Pills items={p.skills} /></>}
      <ProfileLinks links={p.links} />
      {p.verifiedMentor && <RequestMentorshipModal mentorUid={p.uid} mentorName={p.displayName} visible={open} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setNote({ kind: "success", text: "Request sent. The mentor has been notified." }); }} />}
    </Page>
  );
}
