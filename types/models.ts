export type Domain =
  | "AI / ML"
  | "Robotics"
  | "Electronics"
  | "Biotechnology"
  | "Quantum Computing"
  | "Space Tech"
  | "Cybersecurity"
  | "Renewable Energy"
  | "Nanotechnology"
  | "Genetics"
  | "Material Science"
  | "Climate Tech"
  | "Blockchain & Web3"
  | "Neuroscience"
  | "Nuclear Fusion"
  | "Medical Devices"
  | "IoT & Edge Computing";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  bio: string;
  interests: string[];
  profileImage: string;
  role?: "admin" | "user" | "mentor";
  phoneNumber?: string;
  country?: string;
  language?: string;
  subscription?: {
    tier: "free" | "premium";
    expiresAt: string;
    currency: "USD" | "INR";
  };
};

export type Mentor = {
  id: string;
  name: string;
  title: string;
  focus: string;
  affiliation: string;
  bio: string;
  availability: string;
};

export type Paper = {
  id: string;
  title: string;
  domain: string;
  summary: string;
  fullExplanation: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  originalLink: string;
  tags: string[];
  readingTime: string;
  savedCount: number;
  createdAt: Date;
  pdfUri?: string;
  organization?: string;
  pubYear?: number;
  doi?: string;
  illustrations?: string[];
  insights?: string[];
  audioUrl?: string;
  videoUrl?: string;
  translations?: Record<
    string,
    {
      title: string;
      summary: string;
      fullExplanation: string;
    }
  >;
  subdomain?: string;
};

export type Message = {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
};

export type ChatSession = {
  id: string;
  participants: string[];
  participantNames: string[];
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
};

export type CitationFormat = "bibtex" | "ris" | "apa" | "ieee" | "mla";

export type PaperDebate = {
  paperATitle: string;
  paperBTitle: string;
  topics: {
    topicName: string;
    thesisA: string;
    thesisB: string;
    verdict: string;
  }[];
};

export type ResearchRoadmap = {
  paperTitle: string;
  phases: {
    phaseNumber: number;
    title: string;
    description: string;
    estimatedTime: string;
  }[];
};

export type ContentCoverageType = "FULL_TEXT" | "ABSTRACT_ONLY" | "METADATA_ONLY" | "CONTENT_UNAVAILABLE";
export type IntelligenceConfidence = "HIGH" | "MEDIUM" | "LIMITED";

export interface PaperQuantitativeResult {
  metric: string;
  value: string;
  baselineValue?: string;
  improvement?: string;
  units?: string;
  context?: string;
  evidenceReference?: string;
}

export interface PaperIntelligence {
  paperId: string;
  intelligenceVersion: string;
  contentCoverage: ContentCoverageType;
  confidence: IntelligenceConfidence;
  confidenceReason: string;
  tldr: string;
  researchProblem: string;
  motivation?: string;
  keyContributions: string[];
  methodology: {
    overview: string;
    approach?: string;
    techniques?: string[];
    architecture?: string;
    dataset?: string;
    sampleSize?: string;
    experimentalSetup?: string;
    baselines?: string[];
  };
  keyFindings: string[];
  quantitativeResults: PaperQuantitativeResult[];
  strengths?: string[];
  limitations: {
    authorStated?: string[];
    analyticalCautions?: string[];
  };
  whyItMatters: string;
  practicalImplications?: string[];
  futureWork?: string[];
  keywords: string[];
  evidence: Array<{
    claimText: string;
    section: string;
    page?: number;
    chunkId: string;
    verified: boolean;
  }>;
  readingMetrics: {
    wordCount: number;
    estimatedReadingMinutes: number;
    technicalTermDensity: number;
  };
}
