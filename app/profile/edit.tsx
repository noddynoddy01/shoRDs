import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { PersonaPicker } from "@/components/social/PersonaPicker";
import { Banner, Btn, Card, Loading, Muted, Page, Row, SectionTitle } from "@/components/social/Ui";
import { ProfileFields, bodyFrom, draftFrom, useDraft } from "@/components/social/ProfileForm";
import { ConfirmDialog, Modal, useToast } from "@/components/ui";
import { tokens } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { PERSONA_LABEL } from "@/services/social/format";
import type { SelectablePersona } from "@/services/social/intent";

const FIELDS = ["displayName", "headline", "bio", "institution", "department", "academicLevel", "interests", "domains", "expertise", "skills", "orcid", "linkedin", "github", "website", "publications", "availability", "allowDirectMessages"] as const;

/**
 * Edit your own profile. Only fields on the server's allow-list are sent; mentor status and admin cannot be set from here.
 * Changing your profile type is a separate, confirmed step: it changes how shoRDs tailors your home screen and onboarding questions, and it
 * never grants or removes verified-mentor status (that is decided by an administrator).
 */
export default function EditProfile() {
  const { colors, fontSizeScale: k } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const { profile, phase, saveProfile, refresh } = useProfile();
  const { draft, set, reset } = useDraft(draftFrom(null, user?.displayName ?? ""));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [candidate, setCandidate] = useState<SelectablePersona | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { if (phase === "READY" && !ready) { reset(draftFrom(profile, user?.displayName ?? "")); setReady(true); } }, [phase, ready, profile, user, reset]);

  if (phase === "ERROR") return <Page title="Edit profile"><Banner text="Could not load your profile." action={{ label: "Retry", onPress: () => void refresh() }} /></Page>;
  if (!ready) return <Page title="Edit profile"><Loading /></Page>;

  const save = async () => {
    setBusy(true); setProblem(null); setSaved(false);
    const r = await saveProfile(bodyFrom(draft, [...FIELDS]));
    setBusy(false);
    if (r.ok) { setSaved(true); toast.show("Profile saved", "success"); } else setProblem(r.message);
  };

  const changePersona = async () => {
    if (!candidate) return;
    setBusy(true); setProblem(null);
    const r = await saveProfile({ persona: candidate });
    setBusy(false); setConfirming(false); setChoosing(false);
    if (r.ok) { set({ persona: candidate }); toast.show(`Profile type changed to ${PERSONA_LABEL[candidate]}`, "success"); if (candidate === "MENTOR" && !profile?.verifiedMentor) router.push("/mentor/application" as never); }
    else setProblem(r.message);
  };

  const current = profile?.persona ?? draft.persona;
  return (
    <Page title="Edit profile" subtitle={profile?.verifiedMentor ? "Verified mentor" : undefined}>
      {problem ? <Banner text={problem} /> : null}
      {saved ? <Banner kind="success" text="Saved." /> : null}
      <Card><Muted>Your email is private and is never shown on your profile. Verified-mentor status is granted by an administrator and cannot be changed here.</Muted></Card>
      <Card>
        <SectionTitle>Profile type</SectionTitle>
        <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: tokens.fontSize.md * k, fontWeight: tokens.weight.bold }}>{current ? PERSONA_LABEL[current] : "Not chosen"}</Text>
          <Btn small kind="secondary" label="Change profile type" onPress={() => { setCandidate(null); setChoosing(true); }} />
        </Row>
        <Muted>This shapes your home screen and what you are asked in setup. It does not make you a verified mentor.</Muted>
      </Card>
      <ProfileFields draft={draft} set={set} fields={[...FIELDS]} />
      <Row style={{ justifyContent: "space-between" }}>
        <Btn kind="ghost" label="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/dashboard" as never))} />
        <Btn label="Save changes" onPress={() => void save()} loading={busy} icon="checkmark" />
      </Row>

      <Modal visible={choosing && !confirming} title="Change your profile type" onClose={() => setChoosing(false)} actions={<><Btn kind="secondary" label="Cancel" onPress={() => setChoosing(false)} /><Btn label="Continue" disabled={!candidate || candidate === current} onPress={() => setConfirming(true)} /></>}>
        <Muted>Choose how you would like to use shoRDs now.</Muted>
        <PersonaPicker columns={1} value={candidate ?? (current && current !== "ENTHUSIAST" ? (current as SelectablePersona) : null)} onChange={setCandidate} />
      </Modal>
      <ConfirmDialog
        visible={confirming}
        title={`Change to ${candidate ? PERSONA_LABEL[candidate] : ""}?`}
        message={profile?.verifiedMentor ? "Your verified mentor status stays as the administrators set it; changing your profile type does not remove or add it. Your home screen and profile label will change." : candidate === "MENTOR" ? "You will not be listed as a verified mentor until you apply and an administrator approves your application." : "Your home screen and profile label will change. Nothing else about your account changes."}
        confirmLabel="Change profile type"
        busy={busy}
        onConfirm={() => void changePersona()}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  );
}
