import { ScrollView, StyleSheet } from "react-native";
import { ContactContent } from "@/components/ContactContent";
import { Screen } from "@/components/Screen";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { FloatingChatButton } from "@/components/FloatingChatButton";

export default function ContactTabScreen() {
  const { contentBottomPadding } = useFeedMetrics();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <ContactContent />
      </ScrollView>
      <FloatingChatButton />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: 18
  }
});
