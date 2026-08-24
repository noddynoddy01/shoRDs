/**
 * Conversational Audio Brief Player Component for shoRDs Research Intelligence OS
 * Integrated player supporting play/pause, playback speed options (1.0x, 1.25x, 1.5x),
 * active chapter tracking, and natural conversational human researcher narration.
 */

import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/constants/theme";
import {
  ExpressiveAudioEngine,
  NarrationScriptPayload,
  PlaybackSpeed,
  PLAYBACK_SPEEDS
} from "@/services/audioService";

interface Props {
  narration: NarrationScriptPayload;
}

export function AudioBriefPlayer({ narration }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1.0);

  useEffect(() => {
    ExpressiveAudioEngine.initPlaybackSpeedAsync().then((saved) => {
      setSpeed(saved);
    });
    return () => {
      ExpressiveAudioEngine.stop();
    };
  }, []);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      ExpressiveAudioEngine.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      await ExpressiveAudioEngine.playNarrationAsync(
        narration,
        activeChapterIndex,
        speed,
        (newIndex) => setActiveChapterIndex(newIndex),
        () => setIsPlaying(false)
      );
    }
  };

  const handleCycleSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(speed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    const nextSpeed = PLAYBACK_SPEEDS[nextIndex];

    setSpeed(nextSpeed);
    ExpressiveAudioEngine.setPlaybackSpeed(nextSpeed);

    if (isPlaying) {
      ExpressiveAudioEngine.playNarrationAsync(
        narration,
        activeChapterIndex,
        nextSpeed,
        (newIndex) => setActiveChapterIndex(newIndex),
        () => setIsPlaying(false)
      );
    }
  };

  const handleRestart = () => {
    ExpressiveAudioEngine.stop();
    setActiveChapterIndex(0);
    setIsPlaying(false);
  };

  const handleJumpToChapter = async (idx: number) => {
    setActiveChapterIndex(idx);
    setIsPlaying(true);
    await ExpressiveAudioEngine.playNarrationAsync(
      narration,
      idx,
      speed,
      (newIndex) => setActiveChapterIndex(newIndex),
      () => setIsPlaying(false)
    );
  };

  const activeChapter = narration.chapters[activeChapterIndex] || narration.chapters[0];

  return (
    <View style={styles.container}>
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleBadge}>
          <Ionicons name="headset-outline" size={14} color={colors.primary || "#818CF8"} />
          <Text style={styles.headerTitle}>HUMAN VOICE BRIEF · {narration.estimatedDurationMinutes} MIN READ/LISTEN</Text>
        </View>
        <Pressable onPress={handleCycleSpeed} style={styles.speedBtn}>
          <Text style={styles.speedText}>{speed}x</Text>
        </Pressable>
      </View>

      {/* Spoken Chapter Title */}
      <Text style={styles.chapterTitle} numberOfLines={1}>
        {activeChapter ? activeChapter.title : "01 · Spoken Hook & 30-Second Overview"}
      </Text>

      {/* Audio Controls & Progress */}
      <View style={styles.controlsRow}>
        <Pressable onPress={handleRestart} style={styles.controlIconBtn}>
          <Ionicons name="refresh-outline" size={18} color={colors.muted || "#94A3B8"} />
        </Pressable>

        <Pressable onPress={handleTogglePlay} style={styles.mainPlayBtn}>
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={18}
            color="#FFF"
            style={{ marginLeft: isPlaying ? 0 : 2 }}
          />
          <Text style={styles.mainPlayBtnText}>
            {isPlaying ? "Pause Audio" : "Listen to Human Brief"}
          </Text>
        </Pressable>

        <View style={styles.chapterIndicator}>
          <Text style={styles.chapterIndicatorText}>
            {activeChapterIndex + 1} / {narration.totalChapters}
          </Text>
        </View>
      </View>

      {/* Subtle Spoken Script Preview */}
      {activeChapter && (
        <Text style={styles.scriptPreviewText} numberOfLines={2}>
          "{activeChapter.spokenScript}"
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(129, 140, 248, 0.08)",
    borderColor: "rgba(129, 140, 248, 0.25)",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.md
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs
  },
  titleBadge: {
    flexDirection: "row",
    alignItems: "center"
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.primary || "#818CF8",
    marginLeft: 6,
    letterSpacing: 0.5
  },
  speedBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs
  },
  speedText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text || "#FFF"
  },
  chapterTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text || "#FFF",
    marginBottom: spacing.xs + 2
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  controlIconBtn: {
    padding: 6
  },
  mainPlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary || "#818CF8",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.sm
  },
  mainPlayBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFF",
    marginLeft: 6
  },
  chapterIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs
  },
  chapterIndicatorText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted || "#94A3B8"
  },
  scriptPreviewText: {
    fontSize: 11,
    color: colors.muted || "#94A3B8",
    fontStyle: "italic",
    marginTop: spacing.xs + 4,
    lineHeight: 16
  }
});
