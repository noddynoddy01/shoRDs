import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  ActivityIndicator
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Chip } from "@/components/Chip";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { ResearchIllustration } from "@/components/ResearchIllustration";
import * as Speech from "expo-speech";
import { Video, ResizeMode } from "expo-av";
import { colors as defaultColors, radius } from "@/constants/theme";
import { samplePapers } from "@/data/samplePapers";
import { getPaperById, parsePaperSections, deletePaper } from "@/services/papersStore";
import { isPaperSaved, toggleSavedPaper } from "@/services/savedPapers";
import { Paper } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";

type TabType = "context" | "methods" | "results" | "future";
type LangType = "en" | "hi" | "es";

export default function ResearchDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, fontSizeScale, theme } = useTheme();
  
  // Core states
  const [paper, setPaper] = useState<Paper | null>(null);
  const [saved, setSaved] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("context");
  const [selectedLang, setSelectedLang] = useState<LangType>("en");

  // Audio Player states
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState<"1.0x" | "1.5x" | "2.0x">("1.0x");
  const [audioProgress, setAudioProgress] = useState(0); // seconds
  const audioDuration = 190; // 3 min 10 sec
  const audioIntervalRef = useRef<any>(null);

  // Video Explainer Modal state
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const styles = getStyles(colors, fontSizeScale, theme);

  // Resolve paper content based on selected language (safely handle null paper before load)
  const hasTranslation = paper?.translations && paper.translations[selectedLang];
  const displayTitle = paper ? (hasTranslation ? paper.translations![selectedLang].title : paper.title) : "";
  const displaySummary = paper ? (hasTranslation ? paper.translations![selectedLang].summary : paper.summary) : "";
  const displayExplanation = paper ? (hasTranslation ? paper.translations![selectedLang].fullExplanation : paper.fullExplanation) : "";

  // Page Access / Subscription check
  useEffect(() => {
    async function checkAccessAndFetch() {
      // Load user language preference from global settings
      const userVal = await AsyncStorage.getItem("shords.currentUser");
      if (userVal) {
        const parsedUser = JSON.parse(userVal);
        const mappedLang: Record<string, LangType> = {
          "English": "en",
          "Hindi": "hi",
          "Spanish": "es"
        };
        const lang = mappedLang[parsedUser.language] || "en";
        setSelectedLang(lang);
      }

      const { isSubscribed, incrementFreeViews, hasFreeViewsRemaining } = await import("@/services/subscriptionService");
      
      const premium = await isSubscribed();
      let hasAccess = premium;

      if (!premium) {
        // Check if viewed before
        const viewedPapersJson = await AsyncStorage.getItem("shords.viewedPapers") || "[]";
        const viewedPapers = JSON.parse(viewedPapersJson) as string[];
        const alreadyViewed = viewedPapers.includes(id);

        if (alreadyViewed) {
          hasAccess = true;
        } else {
          // Check if has views remaining
          const remaining = await hasFreeViewsRemaining();
          if (remaining) {
            const { allowed } = await incrementFreeViews();
            if (allowed) {
              hasAccess = true;
              viewedPapers.push(id);
              await AsyncStorage.setItem("shords.viewedPapers", JSON.stringify(viewedPapers));
            }
          }
        }
      }

      if (!hasAccess) {
        Alert.alert(
          "View Limit Reached",
          "You have reached your limit of 5 free research papers. Upgrade to Premium for unlimited access, expert chats, and translations.",
          [
            { text: "View Plans", onPress: () => router.replace("/paywall" as never) },
            { text: "Go Back", style: "cancel", onPress: () => router.back() }
          ]
        );
        return;
      }

      getPaperById(id).then((found) => setPaper(found ?? samplePapers[0]));
    }

    checkAccessAndFetch();
  }, [id]);

  // Check saved state and deletion permissions
  useFocusEffect(
    useCallback(() => {
      if (paper) {
        isPaperSaved(paper.id).then(setSaved);
        
        AsyncStorage.getItem("shords.currentUser").then((val) => {
          if (val) {
            const parsed = JSON.parse(val);
            setCanDelete(parsed.role === "admin" || parsed.id === paper.authorId || paper.authorId === "local-uploader");
          } else {
            setCanDelete(paper.authorId === "local-uploader");
          }
        });
      }
    }, [paper])
  );

  // Audio timer setup
  useEffect(() => {
    if (isPlaying) {
      const speedMultiplier = audioSpeed === "1.0x" ? 1 : audioSpeed === "1.5x" ? 1.5 : 2.0;
      audioIntervalRef.current = setInterval(() => {
        setAudioProgress((prev) => {
          if (prev >= audioDuration) {
            setIsPlaying(false);
            if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
            return 0;
          }
          return prev + 1;
        });
      }, 1000 / speedMultiplier);
    } else {
      if (audioIntervalRef.current) {
        clearInterval(audioIntervalRef.current);
      }
    }

    return () => {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
    };
  }, [isPlaying, audioSpeed]);

  // Native speech synthesis trigger
  useEffect(() => {
    if (isPlaying) {
      const speechText = `${displayTitle}. Summary: ${displaySummary}. Insights: ${paper?.insights ? paper.insights.join(". ") : ""}`;
      const rateScale = audioSpeed === "1.0x" ? 1.0 : audioSpeed === "1.5x" ? 1.4 : 1.8;
      
      Speech.speak(speechText, {
        language: selectedLang,
        rate: rateScale,
        onDone: () => {
          setIsPlaying(false);
          setAudioProgress(0);
        },
        onError: (e) => {
          console.warn("Speech error:", e);
          setIsPlaying(false);
        }
      });
    } else {
      Speech.stop();
    }

    return () => {
      Speech.stop();
    };
  }, [isPlaying, audioSpeed, selectedLang, displayTitle, displaySummary, paper?.insights]);

  if (!paper) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accentSoft} />
          <Text style={styles.loadingText}>Fetching Academic Journal...</Text>
        </View>
      </Screen>
    );
  }



  // Parse sections
  const sections = parsePaperSections(displayExplanation, displayTitle, displaySummary, paper.domain);

  const tabContent = {
    context: {
      icon: "bookmark-outline",
      title: selectedLang === "hi" ? "🔬 संदर्भ और पृष्ठभूमि" : selectedLang === "es" ? "🔬 Contexto y Antecedentes" : "🔬 Context & Abstract",
      text: sections.context
    },
    methods: {
      icon: "hardware-chip-outline",
      title: selectedLang === "hi" ? "⚙️ तकनीकी कार्यप्रणाली" : selectedLang === "es" ? "⚙️ Metodología Técnica" : "⚙️ Technical Methodology",
      text: sections.methodology
    },
    results: {
      icon: "analytics-outline",
      title: selectedLang === "hi" ? "📊 मुख्य परिणाम और निष्कर्ष" : selectedLang === "es" ? "📊 Resultados Clave" : "📊 Key Findings & Results",
      text: sections.results
    },
    future: {
      icon: "planet-outline",
      title: selectedLang === "hi" ? "🔮 भविष्य की संभावना" : selectedLang === "es" ? "🔮 Alcance Futuro" : "🔮 Future Scope & Horizons",
      text: sections.futureScope
    }
  };

  const currentTab = tabContent[activeTab];

  // Helper formatting for audio progress
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  async function sharePaper() {
    const shareMessage = `📚 Discover Research on shoRDs!
 
🔍 Title: ${displayTitle}
🔬 Domain: ${paper!.domain}
✍️ Author: ${paper!.authorName} (${paper!.authorRole})
 
📖 Brief Summary:
"${displaySummary}"
 
💡 Read the full interactive technical brief on shoRDs!
🔗 Link: ${paper!.originalLink}`;

    await Share.share({
      title: displayTitle,
      message: shareMessage
    });
  }

  async function toggleSave() {
    const next = await toggleSavedPaper(paper!.id);
    setSaved(next);
  }

  async function openOriginal() {
    if (paper!.originalLink.startsWith("http")) {
      await Linking.openURL(paper!.originalLink);
    } else if (paper!.originalLink.startsWith("file://") || paper!.pdfUri) {
      const uri = paper!.pdfUri || paper!.originalLink;
      try {
        await Linking.openURL(uri);
      } catch {
        Alert.alert("Local File", `Opening local document: ${uri.replace("file://", "")}. Make sure the PDF file exists in your cached documents.`);
      }
    } else {
      Alert.alert("Link Unavailable", "This paper does not have a valid document link.");
    }
  }

  async function handleDelete() {
    Alert.alert(
      "Delete Paper",
      "Are you sure you want to permanently delete this research paper?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deletePaper(paper!.id);
            Alert.alert("Success", "Research brief has been deleted.");
            router.back();
          }
        }
      ]
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header navigation */}
        <View style={styles.header}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" color={colors.text} size={22} />
          </Pressable>
          <Logo />
          <View style={styles.headerActions}>
            <Pressable style={[styles.iconButton, saved && styles.iconButtonActive]} onPress={toggleSave}>
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                color={saved ? colors.accentSoft : colors.text}
                size={21}
              />
            </Pressable>
            <Pressable style={styles.iconButton} onPress={sharePaper}>
              <Ionicons name="share-social-outline" color={colors.text} size={21} />
            </Pressable>
            {canDelete && (
              <Pressable style={[styles.iconButton, { borderColor: "rgba(239, 68, 68, 0.2)" }]} onPress={handleDelete}>
                <Ionicons name="trash-outline" color="#EF4444" size={21} />
              </Pressable>
            )}
          </View>
        </View>



        {/* Hero Card */}
        <View style={styles.hero}>
          <LinearGradient
            colors={[
              colors.accent + "24",
              colors.primary + "14",
              "transparent"
            ]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.journalHeader}>
            <Text style={styles.journalName}>{paper.organization || "ACADEMIC PUBLICATION"}</Text>
            {paper.doi && <Text style={styles.journalDoi}>DOI: {paper.doi}</Text>}
          </View>
          <Text style={styles.domain}>{paper.domain}</Text>
          <Text style={styles.title}>{displayTitle}</Text>
          <Text style={styles.summary}>{displaySummary}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{paper.readingTime}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.metaText}>{paper.authorName}</Text>
            {paper.pubYear && (
              <>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.metaText}>{paper.pubYear}</Text>
              </>
            )}
          </View>
        </View>

        {/* Highlights / Bullet Insights */}
        {paper.insights && paper.insights.length > 0 && (
          <View style={styles.insightsCard}>
            <Text style={styles.insightsLabel}>✦ CORE RESEARCH INSIGHTS</Text>
            {paper.insights.map((insight, idx) => (
              <View key={idx} style={styles.insightRow}>
                <Ionicons name="sparkles" size={14} color={colors.accentSoft} style={styles.insightSparkle} />
                <Text style={styles.insightText}>{insight}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Dynamic Vector Illustrations In Details */}
        {paper.illustrations && paper.illustrations.length > 0 && (
          <View style={styles.illustrationsSection}>
            <Text style={styles.illustrationsSectionTitle}>📈 Visual Illustrations</Text>
            {paper.illustrations.map((illustration, idx) => (
              <ResearchIllustration key={idx} dataString={illustration} />
            ))}
          </View>
        )}

        {/* Audio Summary Player */}
        <View style={styles.audioPlayerCard}>
          <View style={styles.audioHeader}>
            <Ionicons name="volume-high" size={22} color={colors.accentSoft} />
            <Text style={styles.audioTitle}>AI Technical Summary Readout</Text>
          </View>
          
          <View style={styles.audioBody}>
            <Pressable
              style={styles.playBtn}
              onPress={() => setIsPlaying(!isPlaying)}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={22}
                color={colors.text}
              />
            </Pressable>

            <View style={styles.audioTimeline}>
              <View style={styles.audioTrack}>
                <View
                  style={[
                    styles.audioProgressLine,
                    { width: `${(audioProgress / audioDuration) * 100}%` }
                  ]}
                />
              </View>
              <View style={styles.audioTimeLabels}>
                <Text style={styles.audioTimeText}>{formatTime(audioProgress)}</Text>
                <Text style={styles.audioTimeText}>{formatTime(audioDuration)}</Text>
              </View>
            </View>

            <Pressable
              style={styles.speedBtn}
              onPress={() => {
                if (audioSpeed === "1.0x") setAudioSpeed("1.5x");
                else if (audioSpeed === "1.5x") setAudioSpeed("2.0x");
                else setAudioSpeed("1.0x");
              }}
            >
              <Text style={styles.speedText}>{audioSpeed}</Text>
            </Pressable>
          </View>
        </View>

        {/* Video Overview Explainer Button */}
        {paper.videoUrl && (
          <GlassButton
            title="Watch AI Video Explainer"
            icon="play-circle-outline"
            onPress={() => setVideoModalVisible(true)}
            style={styles.videoBtn}
          />
        )}

        {/* Segmented Technical Tabs Selector */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab("context")}
            style={[styles.tabButton, activeTab === "context" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonText, activeTab === "context" && styles.tabButtonTextActive]}>
              Context
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("methods")}
            style={[styles.tabButton, activeTab === "methods" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonText, activeTab === "methods" && styles.tabButtonTextActive]}>
              Methods
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("results")}
            style={[styles.tabButton, activeTab === "results" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonText, activeTab === "results" && styles.tabButtonTextActive]}>
              Results
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("future")}
            style={[styles.tabButton, activeTab === "future" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonText, activeTab === "future" && styles.tabButtonTextActive]}>
              Horizons
            </Text>
          </Pressable>
        </View>

        {/* Technical Content Display Card */}
        <View style={styles.tabCard}>
          <LinearGradient
            colors={theme === "light" || theme === "sepia" ? [colors.card, colors.card] : ["rgba(255, 255, 255, 0.05)", "rgba(255, 255, 255, 0.01)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.tabCardHeader}>
            <Ionicons name={currentTab.icon as any} color={colors.accentSoft} size={22} />
            <Text style={styles.tabCardTitle}>{currentTab.title}</Text>
          </View>
          <Text style={styles.tabCardBody}>{currentTab.text}</Text>
        </View>

        {/* Author Details Box */}
        <View style={styles.authorBox}>
          <Text style={styles.authorLabel}>Lead Researcher</Text>
          <Text style={styles.authorName}>{paper.authorName}</Text>
          <Text style={styles.authorRole}>{paper.authorRole}</Text>
        </View>

        {/* Tags */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Research Tags</Text>
          <View style={styles.tags}>
            {paper.tags.map((tag) => (
              <Chip key={tag} label={`#${tag}`} />
            ))}
          </View>
        </View>

        {/* Open PDF Trigger */}
        <GlassButton
          title={paper.pdfUri ? "View Uploaded PDF Document" : "Open Original Research Paper"}
          icon="document-text-outline"
          variant="quiet"
          onPress={openOriginal}
        />
      </ScrollView>

      {/* Video Explainer Modal */}
      <Modal
        visible={videoModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setVideoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.videoPlayerSheet}>
            <View style={styles.videoHeader}>
              <Text style={styles.videoModalTitle} numberOfLines={1}>{displayTitle}</Text>
              <Pressable
                style={styles.closeVideoBtn}
                onPress={() => {
                  setVideoModalVisible(false);
                  setIsVideoPlaying(false);
                }}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            {/* Video Native/Simulated screen */}
            <View style={styles.videoScreen}>
              {isVideoPlaying ? (
                <Video
                  source={{ 
                    uri: paper.videoUrl && !paper.videoUrl.includes("shords.app") 
                      ? paper.videoUrl 
                      : "https://www.w3schools.com/html/mov_bbb.mp4" 
                  }}
                  rate={1.0}
                  volume={1.0}
                  isMuted={false}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={true}
                  isLooping
                  useNativeControls
                  style={styles.videoPlayerNative}
                  onError={(e) => {
                    console.warn("Video play error:", e);
                    Alert.alert("Playback Error", "Could not stream AI video lesson.");
                    setIsVideoPlaying(false);
                  }}
                />
              ) : (
                <>
                  <LinearGradient
                    colors={["#0F172A", "#1E293B"]}
                    style={StyleSheet.absoluteFill}
                  />
                  <Ionicons
                    name="stats-chart"
                    size={80}
                    color="rgba(6, 182, 212, 0.15)"
                    style={styles.videoDiagramMock}
                  />
                  <Pressable
                    onPress={() => setIsVideoPlaying(true)}
                    style={styles.videoPlayOverlayBtn}
                  >
                    <Ionicons name="play-circle" size={64} color={colors.accentSoft} />
                  </Pressable>
                </>
              )}
            </View>

            {/* AI Chapters / Explainer notes */}
            <ScrollView contentContainerStyle={styles.videoChapters} showsVerticalScrollIndicator={false}>
              <Text style={styles.chaptersTitle}>AI-Generated Video Chapters</Text>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterTime}>0:00</Text>
                <Text style={styles.chapterText}>Paper Abstract & Core Hypothesis</Text>
              </View>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterTime}>1:15</Text>
                <Text style={styles.chapterText}>Experimental Architecture & Dataset Analysis</Text>
              </View>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterTime}>2:40</Text>
                <Text style={styles.chapterText}>Key Math Formula Walkthrough & Results</Text>
              </View>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterTime}>3:50</Text>
                <Text style={styles.chapterText}>Limitations & Future Application Directions</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    content: {
      padding: 18,
      paddingBottom: 36,
      gap: 16
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
      paddingVertical: 120
    },
    loadingText: {
      color: colors.muted,
      fontSize: 14 * scale,
      fontWeight: "600"
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    headerActions: {
      flexDirection: "row",
      gap: 10
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    iconButtonActive: {
      borderColor: "rgba(103, 232, 249, 0.42)",
      backgroundColor: "rgba(6, 182, 212, 0.12)"
    },
    langSelector: {
      flexDirection: "row",
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 4,
      gap: 2
    },
    langBtn: {
      flex: 1,
      height: 36,
      borderRadius: radius.pill,
      justifyContent: "center",
      alignItems: "center"
    },
    langBtnActive: {
      backgroundColor: colors.cardElevated,
      shadowColor: colors.accent,
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 1
    },
    langText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    langTextActive: {
      color: colors.accentSoft,
      fontWeight: "800"
    },
    translatorLoader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 8,
      backgroundColor: "rgba(6, 182, 212, 0.05)",
      borderColor: "rgba(6, 182, 212, 0.1)",
      borderWidth: 1,
      borderRadius: radius.md
    },
    translatorLoaderText: {
      color: colors.accentSoft,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    hero: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: 20,
      gap: 10,
      overflow: "hidden"
    },
    journalHeader: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: 8,
      marginBottom: 4
    },
    journalName: {
      fontFamily: "serif",
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "800",
      letterSpacing: 1.5,
      textTransform: "uppercase"
    },
    journalDoi: {
      fontFamily: "monospace",
      color: colors.subdued,
      fontSize: 10 * scale,
      marginTop: 2
    },
    domain: {
      color: colors.accent,
      fontSize: 12 * scale,
      fontWeight: "800",
      textTransform: "uppercase"
    },
    title: {
      color: colors.text,
      fontSize: 22 * scale,
      lineHeight: 28 * scale,
      fontWeight: "800",
      fontFamily: "serif"
    },
    summary: {
      color: colors.muted,
      fontSize: 14 * scale,
      lineHeight: 21 * scale
    },
    meta: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      marginTop: 4
    },
    metaText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    dot: {
      color: colors.subdued
    },
    insightsCard: {
      backgroundColor: theme === "light" || theme === "sepia" ? "rgba(6, 182, 212, 0.04)" : "rgba(6, 182, 212, 0.03)",
      borderColor: colors.accent + "18",
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 16,
      gap: 10
    },
    insightsLabel: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "800",
      letterSpacing: 1
    },
    insightRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start"
    },
    insightSparkle: {
      marginTop: 2
    },
    insightText: {
      color: colors.text,
      fontSize: 13 * scale,
      lineHeight: 18 * scale,
      flex: 1
    },
    audioPlayerCard: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: 14,
      gap: 12
    },
    audioHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    audioTitle: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "700"
    },
    audioBody: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12
    },
    playBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.cardElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    audioTimeline: {
      flex: 1,
      gap: 4
    },
    audioTrack: {
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: "hidden"
    },
    audioProgressLine: {
      height: "100%",
      backgroundColor: colors.accentSoft
    },
    audioTimeLabels: {
      flexDirection: "row",
      justifyContent: "space-between"
    },
    audioTimeText: {
      fontSize: 10 * scale,
      color: colors.subdued,
      fontWeight: "600"
    },
    speedBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: colors.cardElevated,
      borderColor: colors.border,
      borderWidth: 1
    },
    speedText: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.accentSoft
    },
    videoBtn: {
      backgroundColor: "rgba(124, 58, 237, 0.08)",
      borderColor: "rgba(124, 58, 237, 0.2)"
    },
    tabBar: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 4
    },
    tabButton: {
      flex: 1,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center"
    },
    tabButtonActive: {
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 2
    },
    tabButtonText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    tabButtonTextActive: {
      color: colors.text,
      fontWeight: "800"
    },
    tabCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 20,
      gap: 14,
      overflow: "hidden",
      minHeight: 180
    },
    tabCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    tabCardTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    tabCardBody: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 22 * scale
    },
    authorBox: {
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 4
    },
    authorLabel: {
      color: colors.accent,
      fontSize: 11 * scale,
      fontWeight: "800",
      textTransform: "uppercase"
    },
    authorName: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    },
    authorRole: {
      color: colors.muted,
      fontSize: 12 * scale
    },
    section: {
      gap: 10
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(11, 16, 32, 0.82)",
      justifyContent: "center",
      alignItems: "center",
      padding: 16
    },
    videoPlayerSheet: {
      backgroundColor: "#1E293B",
      borderRadius: radius.lg,
      width: "100%",
      maxHeight: "85%",
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "#334155"
    },
    videoHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: "#334155"
    },
    videoModalTitle: {
      color: "#FFFFFF",
      fontWeight: "700",
      fontSize: 14 * scale,
      flex: 1,
      marginRight: 12
    },
    closeVideoBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#334155",
      borderRadius: 16
    },
    videoScreen: {
      height: 220,
      justifyContent: "center",
      alignItems: "center",
      position: "relative"
    },
    videoPlayerNative: {
      width: "100%",
      height: 220
    },
    videoDiagramMock: {
      position: "absolute",
      opacity: 0.25
    },
    videoPlayOverlayBtn: {
      zIndex: 5,
      alignItems: "center"
    },
    pulseContainer: {
      alignItems: "center",
      gap: 8
    },
    streamingText: {
      color: "#67E8F9",
      fontWeight: "800",
      fontSize: 11 * scale,
      letterSpacing: 1
    },
    videoControls: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      padding: 10,
      gap: 8,
      backgroundColor: "rgba(15, 23, 42, 0.72)"
    },
    videoTimeText: {
      color: "#FFFFFF",
      fontSize: 10 * scale,
      fontWeight: "600"
    },
    videoTrackBar: {
      flex: 1,
      height: 3,
      backgroundColor: "#475569",
      borderRadius: 1.5
    },
    videoTrackProgress: {
      height: "100%",
      backgroundColor: "#06B6D4"
    },
    videoChapters: {
      padding: 16,
      gap: 12,
      backgroundColor: "#0F172A"
    },
    chaptersTitle: {
      color: "#E2E8F0",
      fontWeight: "800",
      fontSize: 13 * scale,
      marginBottom: 4,
      letterSpacing: 0.5
    },
    chapterRow: {
      flexDirection: "row",
      gap: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: "#1E293B"
    },
    chapterTime: {
      color: "#06B6D4",
      fontFamily: "monospace",
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    chapterText: {
      color: "#94A3B8",
      fontSize: 12 * scale,
      flex: 1
    },
    illustrationsSection: {
      gap: 10,
      marginVertical: 4
    },
    illustrationsSectionTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    }
  });
}
