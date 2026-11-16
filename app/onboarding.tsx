import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { PersonaPicker } from "@/components/social/PersonaPicker";
import { Banner, Btn, Card, Muted, Page, Row } from "@/components/social/Ui";
import { PERSONA_FIELDS, ProfileFields, bodyFrom, draftFrom, useDraft } from "@/components/social/ProfileForm";
import { ProgressSteps } from "@/components/social/ProgressSteps";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { tokens } from "@/constants/theme";
import { postOnboardingRoute } from "@/services/social/dashboard";
import { SelectablePersona } from "@/services/social/intent";
import { intent } from "@/services/social/intentStore";
import { PERSONA_LABEL } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { ApplicationStatus } from "@/services/social/types";

/**
 * First-time profile setup, in stages. Every stage is saved to the backend (PostgreSQL) as you go, so you can stop and come back; the profile
 * only becomes visible to other people when you press Finish. The first stage carries the choice made on the landing page or sign-up screen
 * ("How would you like to use shoRDs?"), preselected here and saved with your name through the ordinary profile API. Mentors finish by being
 * taken to the dedicated application step: choosing Mentor never makes anyone a verified mentor, only an administrator can.
 */
const STAGES = ["About you", "Your background", "Interests and links", "Review"] as const;

export default function OnboardingScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { user } = useAuth();
  const { profile, phase, saveProfile, skipOnboarding, refresh, error: loadError } = useProfile();
  const { draft, set, reset } = useDraft(draftFrom(null, user?.displayName ?? ""));
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (phase !== "READY" || hydrated) return;
    void (async () => {
      const pending = await intent.hydrate();
      const base = draftFrom(profile, user?.displayName ?? "");
      // A saved profile type always wins; the sign-up choice only fills an empty one.
      if (!base.persona && pending) base.persona = pending;
      reset(base);
      setHydrated(true);
    })();
  }, [phase, hydrated, profile, user, reset]);

  // The account's name can arrive just after this screen opens (Firebase stores it a moment after creating the account): fill it in only while the field is still empty.
  useEffect(() => {
    if (hydrated && !draft.displayName.trim() && user?.displayName) set({ displayName: user.displayName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.displayName]);

  const persona = draft.persona;
  const stageFields = (): (keyof typeof draft)[] =>
    stage === 0 ? ["displayName", "persona"] : stage === 1 ? (persona ? PERSONA_FIELDS[persona] : []) : stage === 2 ? ["interests", "skills", "linkedin", "github", "website", "allowDirectMessages"] : [];

  const save = async (fields: (keyof typeof draft)[], extra: Record<string, unknown> = {}) => {
    setBusy(true); setProblem(null);
    const r = await saveProfile({ ...bodyFrom(draft, fields), ...extra });
    setBusy(false);
    if (!r.ok) { setProblem(r.message); return false; }
    return true;
  };

  const next = async () => {
    if (stage === 0 && (!draft.displayName.trim() || !draft.persona)) { setProblem("Add your name and choose how you would like to use shoRDs."); return; }
    if (await save(stageFields())) {
      if (stage === 0) void intent.clear(); // the choice now lives in the profile (PostgreSQL); the device-local hint is no longer needed
      setStage((s) => Math.min(STAGES.length - 1, s + 1));
    }
  };
  const finish = async () => {
    if (!(await save(["interests"], { completeOnboarding: true }))) return;
    let applicationStatus: ApplicationStatus = "NOT_APPLIED";
    let verified = false;
    try { const me = await social.getMyApplication(); applicationStatus = me.status; verified = me.verifiedMentor; } catch (_) { /* the application screen loads its own state */ }
    router.replace(postOnboardingRoute({ persona: draft.persona, verifiedMentor: verified, applicationStatus }) as never);
  };
  const skip = () => { skipOnboarding(); router.replace("/(tabs)/dashboard" as never); };

  if (phase === "ERROR") return <Page title="Set up your profile" onBack={skip}><Banner text={loadError || "Could not load your profile."} action={{ label: "Retry", onPress: () => void refresh() }} /><Btn kind="secondary" label="Continue without a profile for now" onPress={skip} /></Page>;

  const mentorNext = persona === "MENTOR";
  return (
    <Page title="Set up your profile" subtitle={`Step ${stage + 1} of ${STAGES.length}: ${STAGES[stage]}`} onBack={stage > 0 ? () => setStage(stage - 1) : skip} back={stage > 0}>
      <ProgressSteps total={STAGES.length} current={stage} />
      {problem ? <Banner text={problem} /> : null}
      {stage === 0 && (
        <>
          <Muted>shoRDs keeps your profile on its own servers. Your sign-in stays with Firebase. Your email address is never shown to other people.</Muted>
          <ProfileFields draft={draft} set={set} fields={["displayName"]} />
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold }}>How would you like to use shoRDs?</Text>
          <PersonaPicker value={persona === "ENTHUSIAST" ? null : (persona as SelectablePersona | null)} onChange={(p) => set({ persona: p })} />
          {persona === "ENTHUSIAST" ? <Muted>Your saved profile type is "{PERSONA_LABEL.ENTHUSIAST}". Choose one above to change it.</Muted> : null}
        </>
      )}
      {stage === 1 && !persona && <Banner kind="info" text="Go back and choose how you would like to use shoRDs first." />}
      {stage === 1 && persona && <Muted>A few details for a {PERSONA_LABEL[persona].toLowerCase()}. All of these are optional.</Muted>}
      {stage > 0 && stage < 3 && <ProfileFields draft={draft} set={set} fields={stageFields()} />}
      {stage === 3 && (
        <Card>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 * k }}>{draft.displayName || "Your name"}</Text>
          <Muted>{draft.persona ? PERSONA_LABEL[draft.persona] : "No profile type chosen"}{draft.institution ? ` · ${draft.institution}` : ""}</Muted>
          <Muted>{draft.interests ? `Interests: ${draft.interests}` : "No research interests yet. Add at least one to finish."}</Muted>
          <Muted>Direct messages: {draft.allowDirectMessages ? "on" : "off"}</Muted>
          <Muted>Pressing Finish makes your profile visible to other signed-in people. You can change everything later from your profile.</Muted>
          {mentorNext ? <Banner kind="info" text="Next you will complete your mentor application. You are not a verified mentor, and are not listed as one, until an administrator approves it." /> : null}
        </Card>
      )}
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <Btn kind="ghost" label="Skip for now" onPress={skip} />
        {stage < STAGES.length - 1 ? <Btn label="Save and continue" onPress={() => void next()} loading={busy} iconRight="arrow-forward" /> : <Btn label={mentorNext ? "Finish and continue to application" : "Finish"} onPress={() => void finish()} loading={busy} icon="checkmark" />}
      </Row>
    </Page>
  );
}
