import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";
import { Paper } from "@/types/models";
import { parsePaperSections } from "@/services/papersStore";
import { ResearchIllustration } from "./ResearchIllustration";

type VideoExplainerModalProps = {
  visible: boolean;
  onClose: () => void;
  paper: Paper;
  selectedLang?: "en" | "hi" | "es";
};

export function VideoExplainerModal({ visible, onClose, paper, selectedLang = "en" }: VideoExplainerModalProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  // Playback States
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0); // 0 to 60 seconds
  const videoIntervalRef = useRef<any>(null);
  const videoDuration = 60; // 60s total (15s per slide)

  const styles = getStyles(colors, fontSizeScale, theme);

  // Parse paper sections
  const hasTranslation = paper.translations && paper.translations[selectedLang];
  const displayTitle = hasTranslation ? paper.translations![selectedLang].title : paper.title;
  const displaySummary = hasTranslation ? paper.translations![selectedLang].summary : paper.summary;
  const displayExplanation = hasTranslation ? paper.translations![selectedLang].fullExplanation : paper.fullExplanation;

  const sections = parsePaperSections(displayExplanation, displayTitle, displaySummary, paper.domain);

  // Narration Slides
  const narrationSlides = [
    {
      chapter: "CHAPTER 1",
      title: selectedLang === "hi" ? "संदर्भ और पृष्ठभूमि" : selectedLang === "es" ? "Contexto y Antecedentes" : "Research Context & Background",
      body: sections.context,
      voice: selectedLang === "hi"
        ? `नमस्ते! ... आज हम '${displayTitle}' नाम के शोध पत्र को समझेंगे। ... संक्षेप में कहें तो, ... ${displaySummary}। ... इस काम का मुख्य उद्देश्य इस क्षेत्र में आने वाली प्रमुख सीमाओं को दूर करना है।`
        : selectedLang === "es"
        ? `¡Hola! ... Exploremos el contexto de: '${displayTitle}'. ... En resumen: ... ${displaySummary}. ... Este estudio aborda desafíos clave en este campo de investigación.`
        : `Hello there! ... Welcome to this shoRDs video brief. ... Let's take a look at the background of: '${displayTitle}'. ... In short: ... ${displaySummary}. ... This study focuses on resolving critical bottlenecks in this area.`,
      icon: "book-outline",
      accent: "#06B6D4"
    },
    {
      chapter: "CHAPTER 2",
      title: selectedLang === "hi" ? "तकनीकी कार्यप्रणाली" : selectedLang === "es" ? "Metodología Técnica" : "Technical Methodology",
      body: sections.methodology,
      voice: selectedLang === "hi"
        ? `इसकी कार्यप्रणाली को समझने के लिए, ... शोधकर्ताओं ने एक नया तकनीकी ढांचा तैयार किया है। ... संक्षेप में कहें तो, ... ${sections.methodology}`
        : selectedLang === "es"
        ? `En cuanto a la metodología técnica, ... los investigadores implementaron un diseño detallado. ... Básicamente, ... ${sections.methodology}`
        : `To explain the technical methodology: ... the researchers designed a custom framework. ... To put it simply: ... ${sections.methodology}`,
      icon: "hardware-chip-outline",
      accent: "#8B5CF6"
    },
    {
      chapter: "CHAPTER 3",
      title: selectedLang === "hi" ? "मुख्य परिणाम और निष्कर्ष" : selectedLang === "es" ? "Resultados Clave" : "Key Findings & Results",
      body: sections.results,
      voice: selectedLang === "hi"
        ? `अब, ... मुख्य परिणामों पर नज़र डालते हैं। ... प्रयोगों और मूल्यांकनों से यह साबित हुआ है कि: ... ${sections.results}`
        : selectedLang === "es"
        ? `Revisemos ahora los resultados clave. ... La evaluación experimental demostró que: ... ${sections.results}`
        : `Now, ... let's review the key results and findings. ... The experimental evaluation demonstrated that: ... ${sections.results}`,
      icon: "analytics-outline",
      accent: "#10B981"
    },
    {
      chapter: "CHAPTER 4",
      title: selectedLang === "hi" ? "भविष्य की संभावना" : selectedLang === "es" ? "Alcance Futuro" : "Future Scope & Horizons",
      body: sections.futureScope,
      voice: selectedLang === "hi"
        ? `अंत में, ... भविष्य की संभावनाओं की बात करें तो, ... यह शोध आने वाले समय में नए रास्ते खोलता है। ... इसके अगले कदम हैं: ... ${sections.futureScope}`
        : selectedLang === "es"
        ? `Finalmente, ... sobre el alcance futuro y horizontes: ... este trabajo establece una base sólida. ... Los próximos pasos contemplan: ... ${sections.futureScope}`
        : `Finally, ... looking at the future scope and horizons: ... this work establishes a strong baseline. ... The next steps include: ... ${sections.futureScope}`,
      icon: "planet-outline",
      accent: "#F59E0B"
    }
  ];

  const activeSlideIndex = Math.min(3, Math.floor((videoProgress / videoDuration) * 4));
  const activeSlide = narrationSlides[activeSlideIndex];

  // Resolve dynamic illustration to show inside the video frame
  let activeIllustration = null;
  if (paper.illustrations && paper.illustrations.length > 0) {
    if (activeSlideIndex === 1) {
      const flow = paper.illustrations.find((i) => i.includes("flow-chart"));
      activeIllustration = flow || paper.illustrations[0];
    } else if (activeSlideIndex === 2) {
      const chart = paper.illustrations.find((i) => i.includes("bar-chart") || i.includes("line-chart"));
      activeIllustration = chart || paper.illustrations[paper.illustrations.length > 1 ? 1 : 0];
    } else {
      activeIllustration = paper.illustrations[0];
    }
  }

  // Handle video playback loop timer
  useEffect(() => {
    if (visible && isVideoPlaying) {
      videoIntervalRef.current = setInterval(() => {
        setVideoProgress((prev) => {
          if (prev >= videoDuration) {
            setIsVideoPlaying(false);
            if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
      }
    }
    return () => {
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
    };
  }, [isVideoPlaying, visible]);

  // Sync TTS narration when active slide changes
  useEffect(() => {
    if (visible && isVideoPlaying && activeSlide) {
      Speech.stop();
      
      const locale = selectedLang === "en" ? "en-US" : selectedLang;
      Speech.speak(activeSlide.voice, {
        language: locale,
        rate: 0.85, // Slower and more natural pacing
        pitch: 1.0,
        onError: (e) => console.warn("TTS Presentation error:", e)
      });
    } else {
      Speech.stop();
    }
    return () => {
      Speech.stop();
    };
  }, [activeSlideIndex, isVideoPlaying, visible, selectedLang]);

  const handleClose = () => {
    setIsVideoPlaying(false);
    setVideoProgress(0);
    Speech.stop();
    onClose();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.videoPlayerSheet}>
          {/* Header */}
          <View style={styles.videoHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.videoModalSubtitle}>AI GENERATED VIDEO PRESENTATION</Text>
              <Text style={styles.videoModalTitle} numberOfLines={1}>{displayTitle}</Text>
            </View>
            <Pressable style={styles.closeVideoBtn} onPress={handleClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Video Frame */}
          <View style={styles.videoScreen}>
            <LinearGradient
              colors={["#0B0F19", "#17153B"]}
              style={StyleSheet.absoluteFill}
            />

            {/* Subtopic / Domain overlay badge */}
            <View style={styles.domainBadge}>
              <Text style={styles.domainText}>{paper.domain} {paper.subdomain ? `• ${paper.subdomain}` : ""}</Text>
            </View>

            {/* Dynamic visual illustration content inside the video frame */}
            {isVideoPlaying || videoProgress > 0 ? (
              <View style={styles.activeFrameContent}>
                {activeIllustration ? (
                  <View style={styles.illustrationFrameWrapper}>
                    <ResearchIllustration dataString={activeIllustration} compact={true} />
                  </View>
                ) : (
                  <View style={styles.graphicPlaceholder}>
                    <Ionicons name={activeSlide.icon as any} size={72} color={activeSlide.accent} style={{ opacity: 0.15 }} />
                  </View>
                )}

                {/* Subtitle slide overlay */}
                <View style={styles.slideOverlay}>
                  <View style={[styles.slideBadge, { borderColor: activeSlide.accent }]}>
                    <Text style={[styles.slideBadgeText, { color: activeSlide.accent }]}>{activeSlide.chapter}</Text>
                  </View>
                  <Text style={styles.slideTitle} numberOfLines={1}>{activeSlide.title}</Text>
                  <Text style={styles.slideBody} numberOfLines={3}>{activeSlide.body}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.startFrameWrapper}>
                <Pressable onPress={() => setIsVideoPlaying(true)} style={styles.videoPlayOverlayBtn}>
                  <View style={styles.playIconCircle}>
                    <Ionicons name="play" size={32} color="#FFFFFF" style={{ marginLeft: 4 }} />
                  </View>
                  <Text style={styles.streamingText}>GENERATE EXPLAINER VIDEO</Text>
                  <Text style={styles.streamingHint}>Narrates research methodology & visuals with a natural voice</Text>
                </Pressable>
              </View>
            )}

            {/* Timeline controller bottom bar */}
            <View style={styles.videoControls}>
              <Pressable onPress={() => setIsVideoPlaying(!isVideoPlaying)} style={styles.videoPlayBtnSmall}>
                <Ionicons name={isVideoPlaying ? "pause" : "play"} size={14} color="#FFFFFF" />
              </Pressable>
              <View style={styles.videoTrackBar}>
                <View style={[styles.videoTrackProgress, { width: `${(videoProgress / videoDuration) * 100}%` }]} />
              </View>
              <Text style={styles.videoTimeText}>{formatTime(videoProgress)} / {formatTime(videoDuration)}</Text>
            </View>
          </View>

          {/* Clickable Chapter List */}
          <ScrollView contentContainerStyle={styles.videoChapters} showsVerticalScrollIndicator={false}>
            <Text style={styles.chaptersTitle}>AI Lecture Segments</Text>
            {narrationSlides.map((slide, idx) => {
              const isActiveChapter = idx === activeSlideIndex && (isVideoPlaying || videoProgress > 0);
              const chapterTime = `0:${String(idx * 15).padStart(2, "0")}`;
              
              return (
                <Pressable
                  key={idx}
                  style={[styles.chapterRow, isActiveChapter && styles.chapterRowActive]}
                  onPress={() => {
                    setVideoProgress(idx * 15);
                    setIsVideoPlaying(true);
                  }}
                >
                  <View style={[styles.chapterDotMarker, { backgroundColor: slide.accent }, isActiveChapter && styles.chapterDotMarkerActive]} />
                  <Text style={[styles.chapterTime, isActiveChapter && { color: slide.accent }]}>{chapterTime}</Text>
                  <Text style={[styles.chapterText, isActiveChapter && { color: "#FFFFFF", fontWeight: "700" }]}>
                    {slide.title}
                  </Text>
                  {isActiveChapter ? (
                    <Ionicons name="volume-high" size={16} color={slide.accent} />
                  ) : (
                    <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.2)" />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      justifyContent: "flex-end"
    },
    videoPlayerSheet: {
      backgroundColor: "#0B0E17",
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: 16,
      minHeight: 520,
      borderTopWidth: 1.5,
      borderColor: "rgba(6, 182, 212, 0.2)"
    },
    videoHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    },
    videoModalSubtitle: {
      color: colors.accentSoft,
      fontSize: 9 * scale,
      fontWeight: "800",
      letterSpacing: 1
    },
    videoModalTitle: {
      color: "#FFFFFF",
      fontSize: 16 * scale,
      fontWeight: "800",
      marginTop: 2
    },
    closeVideoBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      alignItems: "center",
      justifyContent: "center"
    },
    videoScreen: {
      height: 250,
      borderRadius: radius.md,
      overflow: "hidden",
      position: "relative",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.08)"
    },
    domainBadge: {
      position: "absolute",
      top: 10,
      left: 10,
      backgroundColor: "rgba(0,0,0,0.6)",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.1)",
      zIndex: 10
    },
    domainText: {
      color: "rgba(255,255,255,0.7)",
      fontSize: 9 * scale,
      fontWeight: "700"
    },
    activeFrameContent: {
      flex: 1,
      justifyContent: "space-between",
      padding: 10,
      paddingTop: 45,
      paddingBottom: 40
    },
    illustrationFrameWrapper: {
      flex: 1,
      maxHeight: 110,
      justifyContent: "center"
    },
    graphicPlaceholder: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center"
    },
    slideOverlay: {
      backgroundColor: "rgba(0,0,0,0.75)",
      borderRadius: radius.sm,
      padding: 8,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.06)"
    },
    slideBadge: {
      alignSelf: "flex-start",
      borderWidth: 1,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      marginBottom: 3
    },
    slideBadgeText: {
      fontSize: 8 * scale,
      fontWeight: "800"
    },
    slideTitle: {
      color: "#FFFFFF",
      fontSize: 12 * scale,
      fontWeight: "800",
      marginBottom: 2
    },
    slideBody: {
      color: "rgba(255,255,255,0.7)",
      fontSize: 10 * scale,
      lineHeight: 14 * scale
    },
    startFrameWrapper: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    },
    videoPlayOverlayBtn: {
      alignItems: "center",
      justifyContent: "center"
    },
    playIconCircle: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.accent,
      shadowOpacity: 0.4,
      shadowRadius: 10,
      elevation: 6,
      marginBottom: 10
    },
    streamingText: {
      color: "#FFFFFF",
      fontWeight: "900",
      fontSize: 13 * scale,
      letterSpacing: 1
    },
    streamingHint: {
      color: colors.muted,
      fontSize: 10 * scale,
      marginTop: 4,
      textAlign: "center"
    },
    videoControls: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 35,
      backgroundColor: "rgba(0,0,0,0.85)",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      gap: 10
    },
    videoPlayBtnSmall: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center"
    },
    videoTrackBar: {
      flex: 1,
      height: 4,
      backgroundColor: "rgba(255,255,255,0.2)",
      borderRadius: 2,
      overflow: "hidden"
    },
    videoTrackProgress: {
      height: "100%",
      backgroundColor: colors.accentSoft
    },
    videoTimeText: {
      color: "#FFFFFF",
      fontSize: 10 * scale,
      fontWeight: "700"
    },
    videoChapters: {
      marginTop: 18,
      gap: 10
    },
    chaptersTitle: {
      color: colors.muted,
      fontSize: 11 * scale,
      fontWeight: "800",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 4
    },
    chapterRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(255,255,255,0.03)",
      borderRadius: radius.md,
      padding: 12,
      gap: 10,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.02)"
    },
    chapterRowActive: {
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      borderColor: "rgba(6, 182, 212, 0.2)"
    },
    chapterDotMarker: {
      width: 6,
      height: 6,
      borderRadius: 3
    },
    chapterDotMarkerActive: {
      transform: [{ scale: 1.5 }]
    },
    chapterTime: {
      color: colors.subdued,
      fontSize: 10 * scale,
      fontWeight: "700"
    },
    chapterText: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 12 * scale,
      fontWeight: "600",
      flex: 1
    }
  });
}
