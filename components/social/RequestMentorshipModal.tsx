import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { social } from "@/services/social/instance";
import { describeSocialError } from "@/services/social/format";
import { Banner, Btn, Field, Row } from "./Ui";

/** Asks one verified mentor for guidance. The server checks the mentor is approved and has capacity, rejects duplicates, and notifies the mentor. */
export function RequestMentorshipModal({ mentorUid, mentorName, visible, onClose, onSent }: { mentorUid: string; mentorName: string; visible: boolean; onClose: () => void; onSent: () => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  const [domain, setDomain] = useState("");
  const [interests, setInterests] = useState("");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    if (!domain.trim() || interests.trim().length < 10 || guidance.trim().length < 10) { setProblem("Fill in all three fields. Your interests and the guidance you want each need at least 10 characters."); return; }
    setBusy(true); setProblem(null);
    try {
      await social.createRequest({ mentorUid, domain: domain.trim(), interests: interests.trim(), guidanceNeeded: guidance.trim() });
      setDomain(""); setInterests(""); setGuidance("");
      onSent();
    } catch (e) { setProblem(describeSocialError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%", padding: 16 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 * k }} accessibilityRole="header">Request mentorship from {mentorName}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 * k }}>Your message is shown to this mentor only. They can accept or decline. Nothing is guaranteed until they accept.</Text>
            {problem ? <Banner text={problem} /> : null}
            <Field label="Research area" value={domain} onChangeText={setDomain} maxLength={80} placeholder="e.g. Computational biology" />
            <Field label="Your interests" value={interests} onChangeText={setInterests} multiline maxLength={1000} help="At least 10 characters." />
            <Field label="What guidance do you need?" value={guidance} onChangeText={setGuidance} multiline maxLength={1000} help="At least 10 characters. Be specific; mentors decide from this." />
            <Row style={{ justifyContent: "flex-end" }}>
              <Btn kind="ghost" label="Cancel" onPress={onClose} />
              <Btn label="Send request" onPress={() => void send()} loading={busy} icon="send" />
            </Row>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
