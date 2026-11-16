import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { ReactNode, useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useLoad } from "@/components/social/useLoad";
import { Avatar, Badge, Banner, Button, Card, Columns, EmptyState, FadeIn, Pills, Row, SectionHeader, SkeletonList, Stat } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { spacing, tokens } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { dashboardModel, dashboardTitle, profileCompletion } from "@/services/social/dashboard";
import { AVAILABILITY_LABEL, PERSONA_LABEL, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";

/**
 * The home screen after sign-in. It is composed only from what the backend returns (profile, application standing, requests, mentorships,
 * conversations, notifications); a section that fails to load says so and offers a retry, and an empty section says it is empty. Nothing here
 * is a placeholder figure. Which panel a person sees is decided by dashboardModel from server-provided facts, never from local state.
 */
function Quick({ icon, label, hint, to }: { icon: IconName; label: string; hint?: string; to: string }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <Card onPress={() => router.push(to as never)} accessibilityLabel={label} style={{ flex: 1, minWidth: 150, gap: 6 }}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }}>{label}</Text>
      {hint ? <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }}>{hint}</Text> : null}
    </Card>
  );
}

function Section({ title, action, state, children }: { title: string; action?: { label: string; onPress: () => void }; state: { loading: boolean; error: string | null; reload: () => void }; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title={title} action={action} />
      {state.loading ? <SkeletonList rows={1} /> : state.error ? <Banner text={state.error} action={{ label: "Retry", onPress: state.reload }} /> : children}
    </View>
  );
}

export default function DashboardScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { user } = useAuth();
  const { profile, isAdmin, counters, phase, refresh } = useProfile();
  const { contentBottomPadding } = useFeedMetrics();
  const me = useLoad(() => social.getMyApplication(), []);
  const incoming = useLoad(() => social.listRequests("incoming", "PENDING"), []);
  const outgoing = useLoad(() => social.listRequests("outgoing"), []);
  const active = useLoad(() => social.listRelationships("ACTIVE"), []);
  const convs = useLoad(() => social.listConversations(0), []);
  const notes = useLoad(() => social.listNotifications({}), []);

  useFocusEffect(useCallback(() => {
    void refresh(); void me.reload(); void incoming.reload(); void outgoing.reload(); void active.reload(); void convs.reload(); void notes.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const name = profile?.displayName || user?.displayName || "";
  const model = dashboardModel({ persona: profile?.persona ?? null, verifiedMentor: profile?.verifiedMentor === true, applicationStatus: me.data?.status ?? "NOT_APPLIED", isAdmin });
  const completion = profileCompletion(profile);
  const title = dashboardTitle(model.kind, name);
  const st = (l: { loading: boolean; error: string | null; reload: () => Promise<void> }) => ({ loading: l.loading, error: l.error, reload: () => void l.reload() });
  const mentees = (active.data?.items ?? []).filter((r) => r.role === "MENTOR").length;
  const mentoring = (active.data?.items ?? []).filter((r) => r.role === "MENTEE").length;
  const capacity = profile?.own?.mentorCapacity ?? 0;

  return (
    <Screen maxWidth={1080}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: contentBottomPadding + 24, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <FadeIn style={{ gap: spacing.lg }}>
          <Row style={{ alignItems: "center" }}>
            <Avatar name={name || "You"} uri={profile?.photoUrl} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.xxl * k, fontWeight: tokens.weight.heavy, letterSpacing: -0.4 }} numberOfLines={1}>{title.greeting}</Text>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{title.sub}</Text>
            </View>
            <Pressable onPress={() => router.push("/notifications" as never)} accessibilityRole="button" accessibilityLabel={counters.notifications > 0 ? `Notifications, ${counters.notifications} unread` : "Notifications"} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="notifications-outline" size={24} color={colors.text} />
              {counters.notifications > 0 ? <View style={{ position: "absolute", top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: tokens.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: "#fff", fontSize: 10, fontWeight: tokens.weight.bold }}>{counters.notifications > 99 ? "99+" : counters.notifications}</Text></View> : null}
            </Pressable>
          </Row>

          {phase === "READY" && !profile ? <Banner kind="info" text="You have not set up your profile yet. It takes about two minutes." action={{ label: "Set up", onPress: () => router.push("/onboarding" as never) }} /> : null}
          {phase === "ERROR" ? <Banner text="Your profile could not be loaded." action={{ label: "Retry", onPress: () => void refresh() }} /> : null}

          {/* Mentor standing: verified dashboard, or the honest status of the application */}
          {model.mentorPanel === "VERIFIED" ? (
            <Card style={{ gap: spacing.md }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Row><Ionicons name="shield-checkmark" size={22} color={colors.success} /><Text accessibilityRole="header" style={{ color: colors.text, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.lg * k }}>Verified mentor</Text></Row>
                <Badge label={profile ? AVAILABILITY_LABEL[profile.availability] : "—"} tone={profile?.availability === "AVAILABLE" ? "good" : profile?.availability === "LIMITED" ? "warn" : "neutral"} />
              </Row>
              <Columns>
                <Stat label="Pending requests" value={incoming.error ? null : incoming.data?.items.length ?? null} hint={incoming.data && incoming.data.items.length > 0 ? "Waiting for your answer" : undefined} onPress={() => router.push("/mentorship/requests" as never)} />
                <Stat label="Active mentees" value={active.error ? null : active.data ? mentees : null} hint={capacity > 0 ? `Capacity ${capacity}` : "Set your capacity in your profile"} onPress={() => router.push("/mentorship" as never)} />
                <Stat label="Unread messages" value={counters.messages} onPress={() => router.push("/messages" as never)} />
              </Columns>
              <Row style={{ flexWrap: "wrap" }}>
                <Button small kind="secondary" label="Mentorship requests" onPress={() => router.push("/mentorship/requests" as never)} />
                <Button small kind="secondary" label="Edit availability and capacity" onPress={() => router.push("/profile/edit" as never)} />
              </Row>
            </Card>
          ) : model.mentorPanel === "PENDING" ? (
            <Card style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between" }}><Text accessibilityRole="header" style={{ color: colors.text, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.lg * k }}>Mentor application</Text><Badge label="Pending review" tone="warn" icon="time" /></Row>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>An administrator is reviewing your application. You are not listed as a verified mentor yet, and mentorship requests are not available to you until it is approved.</Text>
              <Row><Button small label="View application status" onPress={() => router.push("/mentor/application" as never)} /></Row>
            </Card>
          ) : model.mentorPanel === "REJECTED" || model.mentorPanel === "REVOKED" ? (
            <Card style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between" }}><Text accessibilityRole="header" style={{ color: colors.text, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.lg * k }}>Mentor application</Text><Badge label={model.mentorPanel === "REJECTED" ? "Rejected" : "Revoked"} tone="bad" /></Row>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>{me.data?.application?.reviewNote ? `Reviewer note: ${me.data.application.reviewNote}` : "No reviewer note was left."}</Text>
              <Row><Button small label="Review and apply again" onPress={() => router.push("/mentor/application" as never)} /></Row>
            </Card>
          ) : model.mentorPanel === "APPLY" || model.mentorPanel === "APPLY_OPTIONAL" ? (
            <Card style={{ gap: spacing.sm }}>
              <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: tokens.weight.heavy, fontSize: tokens.fontSize.lg * k }}>{model.mentorPanel === "APPLY" ? "Become a verified mentor" : "Mentor students as a verified mentor"}</Text>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>{model.mentorPanel === "APPLY" ? "You chose Mentor. Submit your professional details for an administrator to verify. Until they approve, you are not listed as a verified mentor." : "If you would like to take on mentees, apply for verification. An administrator reviews every application."}</Text>
              <Row><Button small label="Start application" iconRight="arrow-forward" onPress={() => router.push("/mentor/application" as never)} /></Row>
            </Card>
          ) : null}

          {/* Profile completion */}
          {profile && completion.percent < 100 ? (
            <Card style={{ gap: spacing.sm }}>
              <Row style={{ justifyContent: "space-between" }}><Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }}>Profile completion</Text><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{completion.percent}%</Text></Row>
              <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: completion.percent }} style={{ height: 8, borderRadius: 4, backgroundColor: colors.cardElevated, overflow: "hidden" }}><View style={{ width: `${completion.percent}%`, height: 8, backgroundColor: colors.primary }} /></View>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }}>Still to add: {completion.missing.join(", ")}</Text>
              <Row><Button small kind="secondary" label="Complete profile" onPress={() => router.push("/profile/edit" as never)} /></Row>
            </Card>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            <SectionHeader title={model.kind === "STUDENT" ? "Your learning" : model.kind === "RESEARCHER" ? "Your research" : model.kind === "PROFESSOR" ? "Your academic community" : model.kind === "MENTOR" ? "Your toolkit" : "Explore"} />
            <Columns>
              <Quick icon="newspaper-outline" label="Research feed" hint="Short cards from recent papers" to="/(tabs)" />
              <Quick icon="compass-outline" label="Explore by topic" hint="Search and filter by domain" to="/(tabs)/explore" />
              <Quick icon="sparkles-outline" label="Research Copilot" hint="Questions about a paper" to="/research/copilot" />
            </Columns>
            <Columns>
              <Quick icon="people-outline" label={model.kind === "STUDENT" ? "Find a mentor" : "Mentor directory"} hint="Verified mentors only" to="/(tabs)/mentors" />
              <Quick icon="help-buoy-outline" label="shoRDs Assistant" hint="Help about using shoRDs" to="/assistant" />
              <Quick icon="cloud-upload-outline" label="Upload a paper" hint="Add a PDF to read" to="/(tabs)/upload" />
            </Columns>
            {isAdmin ? <Columns><Quick icon="shield-checkmark-outline" label="Review mentor applications" hint="Administrator" to="/mentor/review" /></Columns> : null}
          </View>

          {model.mentorPanel !== "VERIFIED" || mentoring > 0 || (outgoing.data?.items.length ?? 0) > 0 ? (
            <Section title="Your mentorship requests" action={{ label: "See all", onPress: () => router.push("/mentorship/requests" as never) }} state={st(outgoing)}>
              {(outgoing.data?.items ?? []).length === 0 ? (
                <EmptyState icon="paper-plane-outline" title="No requests sent" text="Find a verified mentor and send a request. Mentors who accept start a private conversation with you." action={<Button small kind="secondary" label="Browse mentors" onPress={() => router.push("/(tabs)/mentors" as never)} />} />
              ) : (outgoing.data?.items ?? []).slice(0, 3).map((r) => (
                <Card key={r.requestId} onPress={() => router.push("/mentorship/requests" as never)} accessibilityLabel={`Request to ${r.mentor.displayName}, ${r.status.toLowerCase()}`}>
                  <Row><Avatar name={r.mentor.displayName} uri={r.mentor.photoUrl} size={36} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }} numberOfLines={1}>{r.mentor.displayName}</Text><Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }}>{r.domain} · {timeAgo(r.createdAt)}</Text></View><Badge label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} tone={r.status === "ACCEPTED" ? "good" : r.status === "PENDING" ? "warn" : "neutral"} /></Row>
                </Card>
              ))}
            </Section>
          ) : null}

          <Section title="Active mentorships" action={{ label: "See all", onPress: () => router.push("/mentorship" as never) }} state={st(active)}>
            {(active.data?.items ?? []).length === 0 ? <EmptyState icon="people-circle-outline" title="No active mentorships" text="A mentorship starts when a mentor accepts a request." /> : (active.data?.items ?? []).slice(0, 3).map((r) => {
              const other = r.role === "MENTOR" ? r.mentee : r.mentor;
              return <Card key={r.relationshipId} onPress={() => router.push(r.conversationId ? (`/messages/${r.conversationId}` as never) : ("/mentorship" as never))} accessibilityLabel={`Mentorship with ${other.displayName}`}><Row><Avatar name={other.displayName} uri={other.photoUrl} size={36} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }} numberOfLines={1}>{other.displayName}</Text><Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }}>You are the {r.role === "MENTOR" ? "mentor" : "mentee"} · since {timeAgo(r.startedAt)}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.subdued} /></Row></Card>;
            })}
          </Section>

          <Section title="Messages" action={{ label: "Open", onPress: () => router.push("/messages" as never) }} state={st(convs)}>
            {(convs.data?.items ?? []).length === 0 ? <EmptyState icon="chatbubbles-outline" title="No conversations yet" text="Conversations appear when a mentorship starts or someone who accepts direct messages writes to you." /> : (convs.data?.items ?? []).slice(0, 3).map((c) => (
              <Card key={c.conversationId} onPress={() => router.push(`/messages/${c.conversationId}` as never)} accessibilityLabel={`Conversation with ${c.other.displayName}${c.unreadCount ? `, ${c.unreadCount} unread` : ""}`}>
                <Row><Avatar name={c.other.displayName} uri={c.other.photoUrl} size={36} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }} numberOfLines={1}>{c.other.displayName}</Text><Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }} numberOfLines={1}>{c.lastMessage ? c.lastMessage.body : "No messages yet"}</Text></View>{c.unreadCount > 0 ? <Badge label={`${c.unreadCount} new`} tone="accent" /> : null}</Row>
              </Card>
            ))}
          </Section>

          <Section title="Recent notifications" action={{ label: "See all", onPress: () => router.push("/notifications" as never) }} state={st(notes)}>
            {(notes.data?.items ?? []).length === 0 ? <EmptyState icon="notifications-off-outline" title="Nothing new" text="Requests, messages and mentor-status changes will show up here." /> : (notes.data?.items ?? []).slice(0, 3).map((n) => (
              <Card key={n.id} onPress={() => router.push("/notifications" as never)} accessibilityLabel={n.title}><Row><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.read ? "transparent" : colors.primary }} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: n.read ? tokens.weight.medium : tokens.weight.bold, fontSize: tokens.fontSize.sm * k }} numberOfLines={1}>{n.title}</Text><Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{timeAgo(n.createdAt)}</Text></View></Row></Card>
            ))}
          </Section>

          {profile && profile.researchInterests.length > 0 ? <View style={{ gap: 6 }}><Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, textTransform: "uppercase", letterSpacing: 0.6 }}>{PERSONA_LABEL[profile.persona]} · your interests</Text><Pills items={profile.researchInterests.slice(0, 8)} /></View> : null}
        </FadeIn>
      </ScrollView>
    </Screen>
  );
}
