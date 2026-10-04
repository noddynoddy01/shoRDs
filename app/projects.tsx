import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { GlassButton } from "@/components/GlassButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius } from "@/constants/theme";
import { useProject } from "@/context/ProjectContext";
import { useTheme } from "@/context/ThemeContext";

/**
 * Project picker / first-project onboarding.
 *   none  -> explain and create the first project
 *   many  -> choose one (the server's list is the only source of truth)
 *   one   -> it is selected automatically; this screen then just shows it and allows creating another
 */
export default function ProjectsScreen() {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);
  const { phase, projects, active, error, refresh, select, create } = useProject();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  async function choose(projectId: string) {
    await select(projectId);
    leave();
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await create(name);
      if (r.ok) {
        setName("");
        leave();
      } else {
        setFormError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const empty = phase === "READY" && projects.length === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PageHeader
          kicker="Workspace"
          title={empty ? "Create your first project" : "Your projects"}
          subtitle={
            empty
              ? "A project keeps your papers, questions and analyses together, and only the people you add can see them."
              : "Choose the project you want to work in."
          }
        />

        {(phase === "LOADING" || phase === "IDLE") && <ActivityIndicator color={colors.accent} />}

        {phase === "ERROR" && (
          <View style={styles.card}>
            <Text style={styles.error} accessibilityRole="alert">
              {error || "Could not load your projects."}
            </Text>
            <GlassButton title="Try again" icon="refresh-outline" onPress={refresh} />
          </View>
        )}

        {phase === "READY" && projects.length > 0 && (
          <View style={styles.list}>
            {projects.map((p) => {
              const selected = active?.projectId === p.projectId;
              return (
                <Pressable key={p.projectId} onPress={() => choose(p.projectId)} style={[styles.row, selected && styles.rowActive]} accessibilityRole="button">
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{p.name}</Text>
                    <Text style={styles.rowMeta}>{p.role.charAt(0) + p.role.slice(1).toLowerCase()}</Text>
                  </View>
                  {selected && <Text style={styles.badge}>Active</Text>}
                </Pressable>
              );
            })}
          </View>
        )}

        {phase === "READY" && (
          <View style={styles.card}>
            <Text style={styles.label}>{empty ? "Project name" : "New project"}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Graph neural networks reading list"
              placeholderTextColor={colors.subdued}
              maxLength={120}
              onSubmitEditing={submit}
              style={styles.input}
            />
            {formError && (
              <Text style={styles.error} accessibilityRole="alert">
                {formError}
              </Text>
            )}
            <GlassButton title={busy ? "Creating" : "Create project"} icon="add-circle-outline" onPress={submit} disabled={busy || !name.trim()} />
          </View>
        )}

        {!empty && phase === "READY" && <GlassButton title="Back" variant="quiet" icon="arrow-back" onPress={leave} />}
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    content: { padding: 18, paddingBottom: 110, gap: 18 },
    list: { gap: 10 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 18,
      paddingVertical: 14
    },
    rowActive: { borderColor: colors.accent },
    rowCopy: { gap: 2, flexShrink: 1 },
    rowTitle: { color: colors.text, fontSize: 15 * scale, fontWeight: "700" },
    rowMeta: { color: colors.muted, fontSize: 12 * scale },
    badge: { color: colors.accent, fontSize: 12 * scale, fontWeight: "800" },
    card: {
      backgroundColor: colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 12
    },
    label: { color: colors.muted, fontSize: 12 * scale, fontWeight: "700" },
    input: {
      height: 52,
      borderRadius: 16,
      backgroundColor: colors.cardElevated,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.text,
      paddingHorizontal: 16,
      fontSize: 14 * scale,
      fontWeight: "600"
    },
    error: { color: "#F87171", fontSize: 13 * scale, lineHeight: 18 * scale, fontWeight: "600" }
  });
}
