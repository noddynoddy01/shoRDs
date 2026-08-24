/**
 * Public Beta Analytics & Telemetry Service for shoRDs Research Intelligence OS
 * Normalizes user behavior telemetry, measures core product funnels, calculates
 * Research Brief completion rates, Original Paper CTRs, and candidate North Star metrics.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type EventClassification =
  | "PRODUCTION TELEMETRY"
  | "HUMAN VALIDATION"
  | "AUTOMATED TEST"
  | "INTERNAL ENGINEERING"
  | "TEST FIXTURE"
  | "SIMULATION";

export interface AnalyticsEvent {
  eventName: string;
  timestamp: string;
  anonymousUserId?: string;
  sessionId?: string;
  paperCanonicalId?: string;
  source?: string;
  platform?: "android" | "web";
  appVersion?: string;
  classification?: EventClassification;
  metadata?: Record<string, unknown>;
}

export interface FunnelMetrics {
  totalAcquiredUsers: number;
  activeSessions: number;
  papersOpened: number;
  briefsStarted: number;
  briefsCompleted: number;
  figureInteractions: number;
  audioStarts: number;
  audioCompletions: number;
  originalPaperClicks: number;
  paywallViews: number;
  checkoutStarts: number;
  successfulPayments: number;
  activeSubscriptions: number;

  // Calculated Ratios
  briefCompletionRate: number; // briefsCompleted / briefsStarted
  figureInteractionRate: number; // figureInteractions / briefsStarted
  audioStartRate: number; // audioStarts / briefsStarted
  audioCompletionRate: number; // audioCompletions / audioStarts
  originalPaperCTR: number; // originalPaperClicks / briefsStarted
  paywallConversionRate: number; // successfulPayments / paywallViews
}

export interface MeaningfulResearchSession {
  sessionId: string;
  paperCanonicalId: string;
  timestamp: string;
  readingDurationSeconds: number;
  sectionsReadCount: number;
  figureInteracted: boolean;
  audioListened: boolean;
  originalPaperClicked: boolean;
  isMeaningful: boolean;
}

const ANALYTICS_STORAGE_KEY = "shords_public_beta_events";
const ANONYMOUS_USER_KEY = "shords_anon_user_id";

class PublicBetaAnalyticsService {
  private eventsLog: AnalyticsEvent[] = [];
  private currentAnonymousUserId: string | null = null;
  private currentSessionId: string | null = null;

  async initAsync(): Promise<string> {
    try {
      let storedId = await AsyncStorage.getItem(ANONYMOUS_USER_KEY);
      if (!storedId) {
        storedId = `usr_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
        await AsyncStorage.setItem(ANONYMOUS_USER_KEY, storedId);
      }
      this.currentAnonymousUserId = storedId;
      this.currentSessionId = `ses_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      return storedId;
    } catch {
      this.currentAnonymousUserId = `usr_fallback_${Date.now()}`;
      this.currentSessionId = `ses_fallback_${Date.now()}`;
      return this.currentAnonymousUserId;
    }
  }

  /**
   * Tracks an analytics event ensuring no PII, passwords, or payment credentials enter logs.
   */
  async trackEventAsync(
    eventName: string,
    metadata?: Record<string, unknown>,
    paperCanonicalId?: string,
    classification: EventClassification = "PRODUCTION TELEMETRY"
  ): Promise<AnalyticsEvent> {
    if (!this.currentAnonymousUserId) {
      await this.initAsync();
    }

    // PII & Payment Token Sanitization
    const sanitizedMetadata = this.sanitizeMetadata(metadata);

    const event: AnalyticsEvent = {
      eventName,
      timestamp: new Date().toISOString(),
      anonymousUserId: this.currentAnonymousUserId || undefined,
      sessionId: this.currentSessionId || undefined,
      paperCanonicalId,
      source: "app",
      platform: "android",
      appVersion: "2.1.0-beta",
      classification,
      metadata: sanitizedMetadata
    };

    this.eventsLog.push(event);

    try {
      if (this.eventsLog.length % 5 === 0) {
        await AsyncStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(this.eventsLog.slice(-100)));
      }
    } catch {}

    return event;
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("card") ||
        lowerKey.includes("cvv") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret")
      ) {
        clean[key] = "[REDACTED_PII]";
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }

  /**
   * Evaluates whether a research session qualifies as a candidate North Star "Meaningful Research Session".
   */
  evaluateMeaningfulSession(session: {
    readingDurationSeconds: number;
    sectionsReadCount: number;
    figureInteracted: boolean;
    audioListened: boolean;
    originalPaperClicked: boolean;
  }): boolean {
    const minTime = session.readingDurationSeconds >= 90;
    const minSections = session.sectionsReadCount >= 5;
    const activeEngagement = session.figureInteracted || session.audioListened || session.originalPaperClicked;

    return (minTime && minSections) || (minSections && activeEngagement);
  }

  /**
   * Computes Core Product Funnel metrics.
   */
  calculateFunnel(events: AnalyticsEvent[]): FunnelMetrics {
    const countEvent = (name: string) => events.filter(e => e.eventName === name).length;

    const acquired = new Set(events.map(e => e.anonymousUserId).filter(Boolean)).size || 1;
    const sessions = new Set(events.map(e => e.sessionId).filter(Boolean)).size || 1;
    const papersOpened = countEvent("paper_opened");
    const briefsStarted = countEvent("brief_started") || Math.max(1, papersOpened);
    const briefsCompleted = countEvent("brief_completed");
    const figureInteractions = countEvent("figure_opened") + countEvent("figure_zoomed");
    const audioStarts = countEvent("audio_started");
    const audioCompletions = countEvent("audio_completed");
    const originalPaperClicks = countEvent("original_paper_clicked");
    const paywallViews = countEvent("paywall_viewed");
    const checkoutStarts = countEvent("checkout_started");
    const successfulPayments = countEvent("payment_captured");
    const activeSubscriptions = countEvent("subscription_activated");

    return {
      totalAcquiredUsers: acquired,
      activeSessions: sessions,
      papersOpened,
      briefsStarted,
      briefsCompleted,
      figureInteractions,
      audioStarts,
      audioCompletions,
      originalPaperClicks,
      paywallViews,
      checkoutStarts,
      successfulPayments,
      activeSubscriptions,

      briefCompletionRate: Number((briefsCompleted / Math.max(1, briefsStarted)).toFixed(3)),
      figureInteractionRate: Number((figureInteractions / Math.max(1, briefsStarted)).toFixed(3)),
      audioStartRate: Number((audioStarts / Math.max(1, briefsStarted)).toFixed(3)),
      audioCompletionRate: Number((audioCompletions / Math.max(1, audioStarts)).toFixed(3)),
      originalPaperCTR: Number((originalPaperClicks / Math.max(1, briefsStarted)).toFixed(3)),
      paywallConversionRate: Number((successfulPayments / Math.max(1, paywallViews)).toFixed(3))
    };
  }

  getEventsLog(): AnalyticsEvent[] {
    return this.eventsLog;
  }
}

export const analyticsService = new PublicBetaAnalyticsService();
