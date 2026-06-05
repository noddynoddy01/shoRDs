import * as DocumentPicker from "expo-document-picker";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Chip } from "@/components/Chip";
import { GlassButton } from "@/components/GlassButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";
import { domains } from "@/data/samplePapers";
import { Domain } from "@/types/models";

export default function UploadScreen() {
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState<Domain>("AI / ML");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [generated, setGenerated] = useState<string[]>([]);

  const tagList = useMemo(
    () =>
      tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags]
  );

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true
    });
    if (!result.canceled) setPdfName(result.assets[0].name);
  }

  function generateReadableStack() {
    const paperTitle = title || pdfName.replace(/\.pdf$/i, "") || "Uploaded research paper";
    const base =
      summary ||
      "This paper studies a technical idea and explains how it can solve a real-world problem through careful experiments and design.";
    setTitle(paperTitle);
    setSummary(base);
    setGenerated([
      `Big idea: ${paperTitle} can be understood as a practical research story, not just a technical document.`,
      `Why it matters: ${base}`,
      "Simple version: shoRDs will break the paper into short cards covering the problem, method, result, and impact.",
      "Next step: connect this screen to an AI summarizer API so uploaded PDFs become readable research shorts automatically."
    ]);
  }

  function submit() {
    if (!title || !summary || !tagList.length || !generated.length) {
      Alert.alert("Create the readable stack", "Add details and generate the stack summary before submitting.");
      return;
    }
    Alert.alert("Research prepared", "Your paper is ready for the shoRDs feed. Backend publishing can be connected next.");
    setTitle("");
    setSummary("");
    setTags("");
    setPdfName("");
    setGenerated([]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          kicker="Upload"
          title="Turn dense papers into readable research stacks"
          subtitle="Upload a paper, generate a simple explanation, and prepare it for the shoRDs feed."
        />

        <View style={styles.form}>
          <Pressable style={styles.uploadBox} onPress={pickPdf}>
            <Ionicons name="cloud-upload-outline" color={colors.accentSoft} size={26} />
            <Text style={styles.uploadTitle}>{pdfName || "Choose a research PDF"}</Text>
            <Text style={styles.uploadHint}>PDF picker is active. AI conversion is prototyped below.</Text>
          </Pressable>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Paper Title"
            placeholderTextColor={colors.subdued}
            style={styles.input}
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Research Domain</Text>
            <View style={styles.chips}>
              {domains.map((item) => (
                <Chip key={item} label={item} selected={domain === item} onPress={() => setDomain(item)} />
              ))}
            </View>
          </View>

          <TextInput
            value={summary}
            onChangeText={setSummary}
            placeholder="What should people understand from this paper?"
            placeholderTextColor={colors.subdued}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.textArea]}
          />

          <TextInput
            value={tags}
            onChangeText={setTags}
            placeholder="Tags, separated by commas"
            placeholderTextColor={colors.subdued}
            style={styles.input}
          />

          <GlassButton title="Generate Easy Stack" icon="sparkles-outline" onPress={generateReadableStack} />
        </View>

        {generated.length ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Generated shoRDs Stack</Text>
            {generated.map((item, index) => (
              <View key={item} style={styles.stackCard}>
                <Text style={styles.stackIndex}>{String(index + 1).padStart(2, "0")}</Text>
                <Text style={styles.stackText}>{item}</Text>
              </View>
            ))}
            <View style={styles.tagPreview}>
              {tagList.map((tag) => (
                <Chip key={tag} label={`#${tag}`} selected />
              ))}
            </View>
          </View>
        ) : null}

        <GlassButton title="Submit Research" icon="checkmark-circle-outline" onPress={submit} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 112,
    gap: 18
  },
  form: {
    gap: 14
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15
  },
  textArea: {
    height: 142,
    lineHeight: 22
  },
  fieldGroup: {
    gap: 10
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  uploadBox: {
    minHeight: 126,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(103, 232, 249, 0.5)",
    backgroundColor: "rgba(6, 182, 212, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8
  },
  uploadTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  uploadHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center"
  },
  preview: {
    gap: 10
  },
  previewTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  stackCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(21, 27, 47, 0.9)",
    padding: 15,
    gap: 8
  },
  stackIndex: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "800"
  },
  stackText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  tagPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  }
});
