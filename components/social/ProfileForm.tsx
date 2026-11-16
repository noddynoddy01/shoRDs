import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { Draft, bodyFrom, draftFrom } from "@/services/social/draft";
import { AVAILABILITY_LABEL, LEVEL_LABEL, PERSONA_HELP, PERSONA_LABEL } from "@/services/social/format";
import type { AcademicLevel, Availability, Persona } from "@/services/social/types";
import { Banner, Btn, Card, Field, Row } from "./Ui";
import { Select } from "@/components/ui";

export const PERSONAS: Persona[] = ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR", "ENTHUSIAST"];
const LEVELS = Object.keys(LEVEL_LABEL) as AcademicLevel[];

export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string; help?: string }[]; onChange: (v: T) => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text, fontSize: 13 * k, fontWeight: "700" }}>{label}</Text>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on} accessibilityLabel={o.label}
            style={{ borderWidth: 1, borderRadius: 12, padding: 12, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + "14" : colors.surface }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 * k }}>{o.label}</Text>
            {o.help ? <Text style={{ color: colors.muted, fontSize: 12 * k, marginTop: 2 }}>{o.help}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

type Props = { draft: Draft; set: (patch: Partial<Draft>) => void; fields: (keyof Draft)[]; errors?: Record<string, string> };

/** Renders exactly the fields asked for, so onboarding stages and the full edit screen share one form. */
export function ProfileFields({ draft, set, fields, errors = {} }: Props) {
  const has = (f: keyof Draft) => fields.includes(f);
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      {has("displayName") && <Field label="Your name" value={draft.displayName} onChangeText={(v) => set({ displayName: v })} maxLength={80} placeholder="How you want to appear" error={errors.displayName} />}
      {has("persona") && <Choice label="What describes you best?" value={draft.persona} onChange={(v) => set({ persona: v })} options={PERSONAS.map((p) => ({ value: p, label: PERSONA_LABEL[p], help: PERSONA_HELP[p] }))} />}
      {has("headline") && <Field label="Headline" value={draft.headline} onChangeText={(v) => set({ headline: v })} maxLength={140} placeholder="e.g. PhD student in signal processing" help="One line shown under your name." error={errors.headline} />}
      {has("institution") && <Field label="Institution" value={draft.institution} onChangeText={(v) => set({ institution: v })} maxLength={120} error={errors.institution} />}
      {has("department") && <Field label="Department" value={draft.department} onChangeText={(v) => set({ department: v })} maxLength={120} error={errors.department} />}
      {has("academicLevel") && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13 * k, fontWeight: "700" }}>Academic level</Text>
          <Row style={{ flexWrap: "wrap" }}>
            {LEVELS.map((l) => <Btn key={l} small kind={draft.academicLevel === l ? "primary" : "secondary"} label={LEVEL_LABEL[l]} onPress={() => set({ academicLevel: draft.academicLevel === l ? null : l })} />)}
          </Row>
        </View>
      )}
      {has("interests") && <Field label="Research interests" value={draft.interests} onChangeText={(v) => set({ interests: v })} placeholder="machine learning, genomics, optics" help="Separate with commas. At least one is needed to finish your profile." error={errors.researchInterests} />}
      {has("domains") && <Field label="Research domains" value={draft.domains} onChangeText={(v) => set({ domains: v })} placeholder="Deep learning, Signal processing" help="Broader fields; used when people search for mentors." error={errors.researchDomains} />}
      {has("expertise") && <Field label="Expertise" value={draft.expertise} onChangeText={(v) => set({ expertise: v })} placeholder="Statistics, Experimental design" help="Separate with commas." error={errors.expertise} />}
      {has("skills") && <Field label="Skills" value={draft.skills} onChangeText={(v) => set({ skills: v })} placeholder="Python, MATLAB, LaTeX" help="Separate with commas." error={errors.skills} />}
      {has("bio") && <Field label="About you" value={draft.bio} onChangeText={(v) => set({ bio: v })} multiline maxLength={1500} placeholder="A short bio" error={errors.bio} />}
      {has("orcid") && <Field label="ORCID" value={draft.orcid} onChangeText={(v) => set({ orcid: v })} autoCapitalize="none" placeholder="0000-0002-1825-0097" error={errors.orcid} />}
      {has("linkedin") && <Field label="LinkedIn" value={draft.linkedin} onChangeText={(v) => set({ linkedin: v })} autoCapitalize="none" keyboardType="url" placeholder="https://www.linkedin.com/in/…" error={errors.linkedin} />}
      {has("github") && <Field label="GitHub" value={draft.github} onChangeText={(v) => set({ github: v })} autoCapitalize="none" keyboardType="url" placeholder="https://github.com/…" error={errors.github} />}
      {has("website") && <Field label="Website" value={draft.website} onChangeText={(v) => set({ website: v })} autoCapitalize="none" keyboardType="url" placeholder="https://" error={errors.website} />}
      {has("publications") && <Field label="Publication links" value={draft.publications} onChangeText={(v) => set({ publications: v })} multiline autoCapitalize="none" placeholder={"One https link per line (up to 6)"} error={errors.publications} />}
      {has("availability") && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13 * k, fontWeight: "700" }}>Availability for mentoring or collaboration</Text>
          <Row style={{ flexWrap: "wrap" }}>
            {(Object.keys(AVAILABILITY_LABEL) as Availability[]).map((a) => <Btn key={a} small kind={draft.availability === a ? "primary" : "secondary"} label={AVAILABILITY_LABEL[a]} onPress={() => set({ availability: a })} />)}
          </Row>
        </View>
      )}
      {has("allowDirectMessages") && (
        <Card>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 * k }}>Accept direct messages</Text>
              <Text style={{ color: colors.muted, fontSize: 12 * k, marginTop: 2 }}>Lets other signed-in people start a text conversation with you. Mentors and mentees can always message each other. Off by default.</Text>
            </View>
            <Switch value={draft.allowDirectMessages} onValueChange={(v) => set({ allowDirectMessages: v })} accessibilityLabel="Accept direct messages" />
          </Row>
        </Card>
      )}
    </View>
  );
}

/** Which fields each persona is asked about in onboarding stage 2 (everything stays optional except what the server requires). */
export const PERSONA_FIELDS: Record<Persona, (keyof Draft)[]> = {
  STUDENT: ["institution", "academicLevel", "headline"],
  MENTOR: ["headline", "institution", "expertise", "domains"],
  RESEARCHER: ["headline", "institution", "department", "domains", "orcid"],
  PROFESSOR: ["headline", "institution", "department", "domains", "orcid"],
  ENTHUSIAST: ["headline", "bio"]
};

export function useDraft(initial: Draft) {
  const [draft, setDraft] = useState<Draft>(initial);
  return { draft, set: (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), reset: (d: Draft) => setDraft(d) };
}

export { Banner, bodyFrom, draftFrom };
export type { Draft };
