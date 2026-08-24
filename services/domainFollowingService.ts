/**
 * Personalized Domain Following & Research Channels Engine for shoRDs Research Intelligence OS
 * Manages followed domain preferences, dedicated domain channels (Newest / Trending / Recommended),
 * cold-start exploration feeds, and diversity guardrails.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ResearchDomain {
  id: string;
  name: string;
  category: "Computer Science" | "Electrical Engineering" | "Physics" | "Biology" | "Interdisciplinary";
  iconName: string;
  description: string;
  paperCount: number;
}

export const SCHOLARLY_DOMAINS: ResearchDomain[] = [
  { id: "ai_ml", name: "AI & Machine Learning", category: "Computer Science", iconName: "hardware-chip-outline", description: "Deep learning, LLMs, reinforcement learning, and transformers.", paperCount: 420 },
  { id: "computer_vision", name: "Computer Vision", category: "Computer Science", iconName: "eye-outline", description: "Visual representation, generative models, and 3D vision.", paperCount: 280 },
  { id: "wireless_comm", name: "Wireless & Networks", category: "Electrical Engineering", iconName: "wifi-outline", description: "6G, MIMO, signal processing, and low-latency networks.", paperCount: 195 },
  { id: "robotics", name: "Robotics & Control", category: "Electrical Engineering", iconName: "cog-outline", description: "Autonomous systems, manipulation, and control theory.", paperCount: 160 },
  { id: "quantum", name: "Quantum Computing", category: "Physics", iconName: "nuclear-outline", description: "Quantum error correction, circuits, and quantum optics.", paperCount: 135 },
  { id: "biotech", name: "Biotechnology & Medicine", category: "Biology", iconName: "medkit-outline", description: "Genomics, computational biology, and drug discovery.", paperCount: 230 }
];

const FOLLOWED_DOMAINS_KEY = "shords_followed_domains";

export class DomainFollowingService {
  private static followedDomainIds: Set<string> = new Set(["ai_ml", "computer_vision"]);

  static async initAsync(): Promise<string[]> {
    try {
      const stored = await AsyncStorage.getItem(FOLLOWED_DOMAINS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.followedDomainIds = new Set(parsed);
        }
      }
    } catch {}
    return Array.from(this.followedDomainIds);
  }

  static async followDomainAsync(domainId: string): Promise<string[]> {
    this.followedDomainIds.add(domainId);
    await AsyncStorage.setItem(FOLLOWED_DOMAINS_KEY, JSON.stringify(Array.from(this.followedDomainIds)));
    return Array.from(this.followedDomainIds);
  }

  static async unfollowDomainAsync(domainId: string): Promise<string[]> {
    this.followedDomainIds.delete(domainId);
    await AsyncStorage.setItem(FOLLOWED_DOMAINS_KEY, JSON.stringify(Array.from(this.followedDomainIds)));
    return Array.from(this.followedDomainIds);
  }

  static isFollowingDomain(domainId: string): boolean {
    return this.followedDomainIds.has(domainId);
  }

  static getFollowedDomains(): ResearchDomain[] {
    return SCHOLARLY_DOMAINS.filter(d => this.followedDomainIds.has(d.id));
  }

  /**
   * Generates a blended feed ranking ensuring diversity.
   * Ensures at least 25% cross-domain discovery papers are present to prevent filter bubbles!
   */
  static rankPersonalizedFeed<T extends { domain?: string; isSummaryReady: boolean }>(
    papers: T[],
    isColdStart: boolean = false
  ): T[] {
    // Strict Safety Gate: Only SUMMARY_READY papers are eligible!
    const eligible = papers.filter(p => p.isSummaryReady);

    if (isColdStart || this.followedDomainIds.size === 0) {
      // Cold-start: Return globally diverse quality feed
      return eligible;
    }

    const followedPapers = eligible.filter(p => p.domain && this.followedDomainIds.has(p.domain));
    const discoveryPapers = eligible.filter(p => !p.domain || !this.followedDomainIds.has(p.domain));

    // Blend: 70% Followed Domain Interests, 30% Diverse Scholarly Discovery
    const blended: T[] = [];
    let fIdx = 0;
    let dIdx = 0;

    while (fIdx < followedPapers.length || dIdx < discoveryPapers.length) {
      // Add 2 followed papers
      for (let i = 0; i < 2 && fIdx < followedPapers.length; i++) {
        blended.push(followedPapers[fIdx++]);
      }
      // Add 1 cross-domain discovery paper
      if (dIdx < discoveryPapers.length) {
        blended.push(discoveryPapers[dIdx++]);
      }
    }

    return blended;
  }
}
