import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Avatar, Badge, Banner, Btn, Card, Empty, Field, Loading, Muted, Page, Pills, Row, Segmented } from "@/components/social/Ui";
import { Modal, SkeletonList } from "@/components/ui";
import { spacing, tokens } from "@/constants/theme";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { AVAILABILITY_LABEL, describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import { ReviewAction, reasonProblem, reviewActions, safeLink } from "@/services/social/review";
import type { MentorApplication } from "@/services/social/types";

type Tab = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
const TAB_LABEL: Record<Tab, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", REVOKED: "Revoked" };

/**
 * Administrator review of mentor applications. This screen is a convenience only: every call goes to /admin/* endpoints that the server restricts to
 * accounts in ADMIN_UIDS, and the server also refuses a reviewer deciding their own application (separation of duties). A non-admin who opens this
 * route sees an explanation, and the server would refuse the calls anyway.
 */
export default function ReviewScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { isAdmin, phase } = useProfile();
  const [tab, setTab] = useState<Tab>("PENDING");
  const [items, setItems] = useState<MentorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ app: MentorApplication; action: ReviewAction } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems((await social.listApplications(tab)).items); } catch (e) { setError(describeSocialError(e)); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (phase !== "READY") return <Page title="Mentor applications"><Loading /></Page>;
  if (!isAdmin) return <Page title="Mentor applications"><Empty icon="lock-closed-outline" title="Administrators only" text="This screen is for shoRDs administrators. Mentor approval cannot be done from a normal account." /></Page>;

  const name = (a: MentorApplication) => a.applicant?.displayName ?? "Unknown applicant";
  const run = async (a: MentorApplication, action: ReviewAction, why: string) => {
    setBusyId(a.applicationId); setDone(null); setError(null);
    try {
      if (action === "REVOKE") await social.revokeMentor(a.applicant!.uid, why.trim());
      else await social.reviewApplication(a.applicationId, action, why.trim() || undefined);
      setDone(`${name(a)} ${action === "APPROVE" ? "approved. They are now listed as a verified mentor" : action === "REJECT" ? "rejected. They can see your reason" : "revoked. They are no longer listed"}.`);
      setPending(null); setReason("");
      await load();
    } catch (e) { setError(describeSocialError(e)); setPending(null); } finally { setBusyId(null); }
  };
  const begin = (a: MentorApplication, action: ReviewAction) => {
    if (action === "APPROVE") { void run(a, action, ""); return; }
    setReason(""); setReasonError(null); setPending({ app: a, action });
  };
  const confirm = () => {
    if (!pending) return;
    const p = reasonProblem(pending.action, reason);
    if (p) { setReasonError(p); return; }
    void run(pending.app, pending.action, reason);
  };

  return (
    <Page title="Mentor applications" subtitle="Administrator review" wide>
      <Segmented value={tab} onChange={setTab} options={(Object.keys(TAB_LABEL) as Tab[]).map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load() }} /> : null}
      {done ? <Banner kind="success" text={done} /> : null}
      {loading ? <SkeletonList rows={2} /> : items.length === 0 ? <Empty icon="documents-outline" title={`No ${TAB_LABEL[tab].toLowerCase()} applications`} text={tab === "PENDING" ? "New applications will appear here." : undefined} /> : items.map((a) => {
        const actions = reviewActions(a);
        const own = a.ownApplication === true;
        return (
          <Card key={a.applicationId} style={{ gap: spacing.md }}>
            <Row style={{ alignItems: "flex-start" }}>
              <Avatar name={name(a)} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.lg * k }}>{name(a)}</Text>
                <Muted>{[a.designation, a.institution].filter(Boolean).join(" · ") || "No designation or institution given"}</Muted>
                <Muted>Submitted {timeAgo(a.createdAt)} · {new Date(a.createdAt).toISOString().slice(0, 10)}</Muted>
              </View>
              <Badge label={TAB_LABEL[a.status as Tab] ?? a.status} tone={a.status === "APPROVED" ? "good" : a.status === "PENDING" ? "warn" : "bad"} />
            </Row>
            {own ? <Banner kind="warning" text="This is your own application. Another administrator must review it; you cannot approve or reject your own." /> : null}
            {a.professionalBio ? <View style={{ gap: 2 }}><Muted>Professional biography</Muted><Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }} selectable>{a.professionalBio}</Text></View> : null}
            <View style={{ gap: 2 }}><Muted>Research background</Muted><Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }} selectable>{a.background}</Text></View>
            <View style={{ gap: 2 }}><Muted>Mentoring experience</Muted><Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }} selectable>{a.experience}</Text></View>
            <View style={{ gap: 6 }}><Muted>Research expertise</Muted><Pills items={a.expertise} /></View>
            <View style={{ gap: 6 }}>
              <Muted>Professional links</Muted>
              {[...a.portfolioLinks, ...(a.googleScholar ? [a.googleScholar] : [])].map((l) => {
                const ok = safeLink(l);
                return ok ? <Pressable key={l} onPress={() => void Linking.openURL(ok)} accessibilityRole="link" accessibilityLabel={`Open ${l}`}><Row style={{ gap: 6 }}><Ionicons name="open-outline" size={14} color={colors.accent} /><Text style={{ color: colors.accent, fontSize: tokens.fontSize.sm * k, flex: 1 }} numberOfLines={1}>{l}</Text></Row></Pressable> : null;
              })}
              {a.orcid ? <Muted>ORCID {a.orcid}</Muted> : null}
              {a.portfolioLinks.length === 0 && !a.googleScholar && !a.orcid ? <Muted>No links provided.</Muted> : null}
            </View>
            <View style={{ gap: 2 }}>
              <Muted>Supporting evidence</Muted>
              <Text style={{ color: colors.text, fontSize: tokens.fontSize.sm * k }} selectable>{a.verificationNote || "No reviewer notes were added."}</Text>
              <Muted>No documents: shoRDs has no secure upload for credentials, so evidence is links and notes only.</Muted>
            </View>
            <Muted>Availability: {AVAILABILITY_LABEL[a.availability]} · capacity {a.capacity}</Muted>
            {a.reviewNote ? <View style={{ borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10 }}><Muted>Reviewer note: {a.reviewNote}</Muted></View> : null}
            {actions.length > 0 ? (
              <Row style={{ flexWrap: "wrap" }}>
                {actions.includes("APPROVE") ? <Btn label="Approve" icon="checkmark" onPress={() => begin(a, "APPROVE")} loading={busyId === a.applicationId} disabled={busyId !== null} /> : null}
                {actions.includes("REJECT") ? <Btn kind="secondary" label="Reject with reason" icon="close" onPress={() => begin(a, "REJECT")} disabled={busyId !== null} /> : null}
                {actions.includes("REVOKE") ? <Btn kind="danger" label="Revoke verification" icon="ban" onPress={() => begin(a, "REVOKE")} disabled={busyId !== null} /> : null}
              </Row>
            ) : null}
          </Card>
        );
      })}
      <Modal
        visible={pending !== null}
        title={pending?.action === "REVOKE" ? "Revoke verified status" : "Reject application"}
        onClose={() => setPending(null)}
        actions={<><Btn kind="secondary" label="Cancel" onPress={() => setPending(null)} /><Btn kind={pending?.action === "REVOKE" ? "danger" : "primary"} label={pending?.action === "REVOKE" ? "Revoke" : "Reject"} onPress={confirm} loading={busyId !== null} /></>}
      >
        <Muted>{pending ? `${name(pending.app)} will be notified and will see your reason. ${pending.action === "REVOKE" ? "They stop appearing in the Mentors directory immediately; existing mentorships are not ended." : "They may apply again."}` : ""}</Muted>
        <Field label="Reason (required)" value={reason} onChangeText={(v) => { setReason(v); setReasonError(null); }} multiline maxLength={500} error={reasonError} autoFocus />
      </Modal>
    </Page>
  );
}
