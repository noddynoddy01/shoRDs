import { router } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { ContactContent } from "@/components/ContactContent";
import { Screen } from "@/components/Screen";

export default function ContactScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ContactContent showBack onBack={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 110,
    gap: 18
  }
});
