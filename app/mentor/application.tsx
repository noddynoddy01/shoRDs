import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLoad } from "@/components/social/useLoad";
import { Badge, Banner, Btn, Card, Field, Loading, Muted, Page, Pills, Row, SectionTitle } from "@/components/social/Ui";
import { Select } from "@/components/ui";
import { spacing, tokens } from "@/constants/theme";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { ApplicationForm, applicationBody, applicationStatusInfo, emptyApplicationForm, validateApplicationForm } from "@/services/social/application";
import { AVAILABILITY_LABEL, describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { Availability, MentorApplication } from "@/services/social/types";

/**
 * The mentor application and its status. Submitting only creates a PENDING application: nothing about your profile changes until an administrator
 * approves it, and there is no way to approve yourself. Verification evidence is described in text and links; there is NO document upload, because
 * shoRDs has no secure file-storage system for credentials, and the screen says so rather than pretending otherwise.
 */
function formFrom(app: MentorApplication | null, institution: string): ApplicationForm {
  if (!app) return emptyApplicationForm(institution);
  return {
    institution: app.institution ?? institution, designation: app.designation ?? "", professionalBio: app.professionalBio ?? "", background: app.background, experience: app.experience,
    expertise: app.expertise.join(", "), mentoringAreas: app.mentoringAreas.join(", "), links: app.portfolioLinks.join("\n"), orcid: app.orcid ?? "", googleScholar: app.googleScholar ?? "",
    verificationNote: app.verificationNote ?? "", availability: app.availability === "LIMITED" ? "LIMITED" : "AVAILABLE", capacity: String(app.capacity)
  };
}

export default function MentorApplicationScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { profile, refresh } = useProfile();
  const { data: me, error, loading, reload } = useLoad(() => social.getMyApplication(), []);
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const set = (patch: Partial<ApplicationForm>) => setForm((f) => ({ ...(f as ApplicationForm), ...patch }));

  useEffect(() => { if (me && !form) setForm(formFrom(me.application, profile?.institution ?? "")); }, [me, form, profile]);

  if (loading || !me || !form) {
    if (error) return <Page title="Mentor application"><Banner text={error} action={{ label: "Retry", onPress: () => void reload() }} /></Page>;
    return <Page title="Mentor application"><Loading /></Page>;
  }

  const info = applicationStatusInfo(me.status, me.verifiedMentor);
  const ready = !!profile?.own?.onboardingCompleted;
  const app = me.application;

  const submit = async () => {
    const e = validateApplicationForm(form);
    setErrors(e);
    if (Object.keys(e).length > 0) { setProblem("Please fix the highlighted fields."); return; }
    setBusy(true); setProblem(null);
    try {
      await social.submitApplication(applicationBody(form));
      setFresh(true); await reload(); await refresh();
    } catch (err) { setProblem(describeSocialError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Page title="Mentor application" subtitle="Verified mentor status">
      <Card style={{ gap: spacing.md }}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.xl * k, fontWeight: tokens.weight.heavy }}>{info.headline}</Text>
            <Muted>{info.detail}</Muted>
          </View>
          <Badge label={info.label} tone={info.tone === "bad" ? "bad" : info.tone === "good" ? "good" : info.tone === "warn" ? "warn" : "neutral"} icon={info.tone === "good" ? "shield-checkmark" : info.tone === "warn" ? "time" : info.tone === "bad" ? "close-circle" : "ellipse-outline"} />
        </Row>
        {info.showNote ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: info.tone === "bad" ? tokens.danger : colors.success, paddingLeft: 12, gap: 2 }}>
            <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, textTransform: "uppercase", letterSpacing: 0.6 }}>Reviewer note</Text>
            <Text style={{ color: colors.text, fontSize: tokens.fontSize.md * k, lineHeight: 22 * k }} selectable>{app?.reviewNote || "No reviewer note was left."}</Text>
            {app?.reviewedAt ? <Muted>Decided {timeAgo(app.reviewedAt)}</Muted> : null}
          </View>
        ) : null}
        {fresh ? <Banner kind="success" text="Application submitted. It is pending review. You are not a verified mentor until it is approved." /> : null}
        {me.status === "PENDING" ? (
          <View style={{ gap: 10 }} accessibilityLabel="Application progress">
            {[["Submitted", true], ["Under review by an administrator", true], ["Decision", false]].map(([t, on], i) => (
              <Row key={String(t)} style={{ gap: 10 }}>
                <Ionicons name={on ? (i === 1 ? "time" : "checkmark-circle") : "ellipse-outline"} size={20} color={on ? (i === 1 ? colors.warning : colors.success) : colors.subdued} />
                <Text style={{ color: on ? colors.text : colors.muted, fontSize: tokens.fontSize.sm * k }}>{String(t)}{i === 0 && app ? ` · ${timeAgo(app.createdAt)}` : ""}</Text>
              </Row>
            ))}
          </View>
        ) : null}
        {me.verifiedMentor ? <Row><Btn small kind="secondary" label="View my mentor dashboard" onPress={() => router.replace("/(tabs)/dashboard" as never)} /></Row> : null}
      </Card>

      {app && (me.status === "PENDING" || me.verifiedMentor) ? (
        <Card>
          <SectionTitle>Submitted details</SectionTitle>
          <Muted>{[app.designation, app.institution].filter(Boolean).join(" · ") || "Details not recorded"}</Muted>
          {app.professionalBio ? <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>{app.professionalBio}</Text> : null}
          <Pills items={app.expertise} />
          <Muted>Availability: {AVAILABILITY_LABEL[app.availability]} · capacity {app.capacity}</Muted>
          {app.portfolioLinks.length > 0 ? <Muted>Links: {app.portfolioLinks.join("  ")}</Muted> : null}
          {app.orcid ? <Muted>ORCID: {app.orcid}</Muted> : null}
          {app.googleScholar ? <Muted>Google Scholar: {app.googleScholar}</Muted> : null}
        </Card>
      ) : null}

      {info.canApply && !ready ? <Banner kind="info" text="Finish your profile before applying. Verified mentors are shown with their profile." action={{ label: "Finish profile", onPress: () => router.push("/onboarding" as never) }} /> : null}

      {info.canApply && ready ? (
        <>
          {problem ? <Banner text={problem} /> : null}
          <Card>
            <SectionTitle>Professional details</SectionTitle>
            <Field label="Institution or organisation" value={form.institution} onChangeText={(v) => set({ institution: v })} maxLength={120} error={errors.institution} />
            <Field label="Designation" value={form.designation} onChangeText={(v) => set({ designation: v })} maxLength={120} placeholder="e.g. Associate Professor, Postdoctoral Researcher" error={errors.designation} />
            <Field label="Professional biography" value={form.professionalBio} onChangeText={(v) => set({ professionalBio: v })} multiline maxLength={2000} help="At least 20 characters. This is what the reviewer reads first." error={errors.professionalBio} />
          </Card>
          <Card>
            <SectionTitle>Research and mentoring</SectionTitle>
            <Field label="Research background" value={form.background} onChangeText={(v) => set({ background: v })} multiline maxLength={2000} help="At least 20 characters." error={errors.background} />
            <Field label="Mentoring or supervision experience" value={form.experience} onChangeText={(v) => set({ experience: v })} multiline maxLength={2000} help="At least 20 characters." error={errors.experience} />
            <Field label="Research expertise" value={form.expertise} onChangeText={(v) => set({ expertise: v })} placeholder="Statistics, Neuroscience" help="Separate with commas; at least one." error={errors.expertise} />
            <Field label="Areas you can mentor in" value={form.mentoringAreas} onChangeText={(v) => set({ mentoringAreas: v })} placeholder="Thesis writing, Lab techniques" help="Separate with commas; at least one." error={errors.mentoringAreas} />
          </Card>
          <Card>
            <SectionTitle>Verification information</SectionTitle>
            <Banner kind="info" text="shoRDs does not accept document uploads, because it has no secure place to store credentials. Please give verifiable links instead, and describe anything the reviewer should check. Never paste identity numbers, passwords or private documents here." />
            <Field label="Professional profile links" value={form.links} onChangeText={(v) => set({ links: v })} multiline autoCapitalize="none" placeholder="One https link per line (up to 6): staff page, lab page, LinkedIn, publications" error={errors.links} />
            <Field label="ORCID (optional)" value={form.orcid} onChangeText={(v) => set({ orcid: v })} autoCapitalize="none" placeholder="0000-0002-1825-0097" error={errors.orcid} />
            <Field label="Google Scholar profile (optional)" value={form.googleScholar} onChangeText={(v) => set({ googleScholar: v })} autoCapitalize="none" keyboardType="url" placeholder="https://scholar.google.com/citations?user=…" error={errors.googleScholar} />
            <Field label="Notes for the reviewer (optional)" value={form.verificationNote} onChangeText={(v) => set({ verificationNote: v })} multiline maxLength={500} help="For example: where the reviewer can confirm your role." error={errors.verificationNote} />
          </Card>
          <Card>
            <SectionTitle>Availability</SectionTitle>
            <Select<Availability> label="How available are you?" value={form.availability} onChange={(v) => set({ availability: v })} options={(["AVAILABLE", "LIMITED"] as Availability[]).map((a) => ({ value: a, label: AVAILABILITY_LABEL[a] }))} />
            <Field label="How many mentees can you take at once?" value={form.capacity} onChangeText={(v) => set({ capacity: v })} keyboardType="number-pad" maxLength={2} error={errors.capacity} />
          </Card>
          <Muted>An administrator reviews every application. Submitting does not make you a verified mentor.</Muted>
          <Btn label={me.status === "NOT_APPLIED" ? "Submit application" : "Submit updated application"} onPress={() => void submit()} loading={busy} icon="send" />
        </>
      ) : null}
    </Page>
  );
}
