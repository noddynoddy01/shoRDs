/**
 * Read-aloud for shoRDs: speaks the research brief that is shown on screen using the device's built-in text-to-speech.
 * It is not a recording and not a human voice, and it says nothing that is not already on the screen.
 */

import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GroundedResearchBrief } from "./paperSummarizer";

const MUTE_STORAGE_KEY = "shords_audio_muted";
const SPEED_STORAGE_KEY = "shords_audio_playback_speed_pref";
export type PlaybackSpeed = 0.75 | 1.0 | 1.25 | 1.5 | 1.75 | 2.0;

export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export interface NarrationSegment {
  text: string;
  section: string;
  emphasis?: "normal" | "important" | "result";
  pauseAfterMs?: number;
}

export interface AudioChapter {
  id: string;
  title: string;
  spokenScript: string;
  segments?: NarrationSegment[];
}

export interface NarrationScriptPayload {
  paperTitle: string;
  paperCanonicalId: string;
  totalChapters: number;
  estimatedDurationMinutes: number;
  chapters: AudioChapter[];
}

/**
 * Light text clean-up so device text-to-speech reads symbols naturally. Generic only: no figure, percentage or phrase is
 * rewritten into specific wording (the previous version hard-coded "18.4%", "94.2%", "3.1x" and "142").
 */
export function formatTechnicalPronunciation(text: string): string {
  if (!text) return "";
  return text
    .replace(/%/g, " percent")
    .replace(/\bvs\b\.?/gi, "versus")
    .replace(/\bSOTA\b/g, "state of the art");
}

/** Speech rate assumed for the duration estimate at 1.0x (words per minute). An estimate, shown as such. */
const SPEECH_WORDS_PER_MINUTE = 150;

/**
 * Builds the read-aloud script from the brief that is ON SCREEN: each section's own title and text, in order, and nothing else.
 * It never adds an introduction, statistics, a summary, or any wording that is not in the displayed brief. A brief with no
 * readable section (for example metadata only) yields no chapters, and the player is not shown.
 *
 * (The previous version ignored the paper and read the same invented script to everyone: "an 18.4 percent accuracy boost",
 * "142 independent benchmark trials", "peak accuracy of 94.2 percent".)
 */
export function generateNarrationScript(brief: GroundedResearchBrief): NarrationScriptPayload {
  const readable = brief.summaryMode === "METADATA_ONLY" ? [] : brief.sections.filter((s) => s.content && s.content.trim().length > 0);
  const chapters: AudioChapter[] = readable.map((s, i) => ({
    id: `ch${i + 1}_${s.sectionId}`,
    title: s.title,
    spokenScript: `${s.title.replace(/^\d+\s*·\s*/, "")}. ${formatTechnicalPronunciation(s.content)}`
  }));
  const words = chapters.reduce((n, c) => n + c.spokenScript.split(/\s+/).filter(Boolean).length, 0);
  return {
    paperTitle: brief.title,
    paperCanonicalId: brief.paperCanonicalId,
    totalChapters: chapters.length,
    estimatedDurationMinutes: Math.max(1, Math.ceil(words / SPEECH_WORDS_PER_MINUTE)),
    chapters
  };
}

export class ExpressiveAudioEngine {
  private static isSpeaking = false;
  private static isMuted = false;
  private static currentChapterIndex = 0;
  private static activeChapters: AudioChapter[] = [];
  private static currentSpeed: PlaybackSpeed = 1.0;

  static async initMuteStateAsync(): Promise<boolean> {
    try {
      const stored = await AsyncStorage.getItem(MUTE_STORAGE_KEY);
      this.isMuted = stored === "true";
    } catch {
      this.isMuted = false;
    }
    return this.isMuted;
  }

  static async toggleMuteAsync(): Promise<boolean> {
    this.isMuted = !this.isMuted;
    try {
      await AsyncStorage.setItem(MUTE_STORAGE_KEY, this.isMuted ? "true" : "false");
    } catch {}

    if (this.isMuted) {
      this.stop();
    }
    return this.isMuted;
  }

  static getIsMuted(): boolean {
    return this.isMuted;
  }

  static getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  static async initPlaybackSpeedAsync(): Promise<PlaybackSpeed> {
    try {
      const stored = await AsyncStorage.getItem(SPEED_STORAGE_KEY);
      if (stored) {
        const val = parseFloat(stored) as PlaybackSpeed;
        if (PLAYBACK_SPEEDS.includes(val)) {
          this.currentSpeed = val;
        }
      }
    } catch {}
    return this.currentSpeed;
  }

  static setPlaybackSpeed(speed: PlaybackSpeed) {
    this.currentSpeed = speed;
    AsyncStorage.setItem(SPEED_STORAGE_KEY, String(speed)).catch(() => {});
  }

  static getPlaybackSpeed(): PlaybackSpeed {
    return this.currentSpeed;
  }

  /**
   * Starts playing a full narrated research brief from a given chapter index.
   */
  static async playNarrationAsync(
    narration: NarrationScriptPayload,
    startIndex: number = 0,
    speed: PlaybackSpeed = 1.0,
    onChapterChange?: (index: number) => void,
    onComplete?: () => void
  ) {
    if (this.isMuted) return;

    this.stop();
    this.activeChapters = narration.chapters;
    this.currentChapterIndex = startIndex;
    this.currentSpeed = speed;
    this.isSpeaking = true;

    this.playCurrentChapter(onChapterChange, onComplete);
  }

  private static playCurrentChapter(
    onChapterChange?: (index: number) => void,
    onComplete?: () => void
  ) {
    if (this.currentChapterIndex >= this.activeChapters.length) {
      this.isSpeaking = false;
      if (onComplete) onComplete();
      return;
    }

    const currentChapter = this.activeChapters[this.currentChapterIndex];
    if (onChapterChange) onChapterChange(this.currentChapterIndex);

    const options: Speech.SpeechOptions = {
      rate: this.currentSpeed,
      pitch: 1.0,
      onDone: () => {
        this.currentChapterIndex += 1;
        this.playCurrentChapter(onChapterChange, onComplete);
      },
      onStopped: () => {
        this.isSpeaking = false;
      },
      onError: () => {
        this.isSpeaking = false;
      }
    };

    Speech.speak(currentChapter.spokenScript, options);
  }

  static pause() {
    Speech.stop();
    this.isSpeaking = false;
  }

  static stop() {
    Speech.stop();
    this.isSpeaking = false;
    this.currentChapterIndex = 0;
  }
}
