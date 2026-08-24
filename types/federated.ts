import { Paper } from "./models";

export type ResearchSource = {
  id: string;
  name: string;
  apiEndpoint: string;
  authRequired: boolean;
  rateLimit: string;
  supportedFields: string[];
  fullTextAvailable: boolean;
  licenseInfo: string;
  healthStatus: "operational" | "degraded" | "offline";
  updateSchedule: string;
};

export type CanonicalPaper = {
  id: string;
  title: string;
  authors: string[];
  doi?: string;
  year: number;
  abstract: string;
  publication: string;
  publisher: string;
  pdf_url?: string;
  html_url?: string;
  license: string;
  keywords: string[];
  citation_count: number;
  research_field: string;
  institution: string;
  source: string;
  primary_url?: string;
  is_open_access: boolean;
  arxiv_id?: string;
  pmcid?: string;
};

export type SearchFilters = {
  openAccessOnly?: boolean;
  yearRange?: [number, number];
  sortBy?: "relevance" | "recency" | "oldest" | "citations";
  researchField?: string;
  institution?: string;
  journal?: string;
};

export type FigureAsset = {
  id: string;
  high_res_url: string;
  caption: string;
  paper_section: string;
  ai_explanation: string;
  extracted_variables: string[];
  zoom_supported: boolean;
  comparison_supported: boolean;
};

export type AudioPodcastOutput = {
  audio_url: string;
  script: Record<string, string>;
  duration_seconds: number;
  narrators: string[];
  provider: string;
};

export type VideoSummaryOutput = {
  video_url: string;
  slides: Array<{
    slide_id: number;
    heading: string;
    type: string;
    duration: number;
    figure_url?: string;
  }>;
  total_duration_seconds: number;
  has_narration: boolean;
  resolution: string;
};

export type shoRDsStack = {
  stack_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  summary_short: string;
  full_explanation: string;
  roadmap: Array<{ step: number; title: string; desc: string }>;
  quiz: Array<{ question: string; options: string[]; correct_index: number; explanation: string }>;
  flashcards: Array<{ front: string; back: string }>;
  figures: FigureAsset[];
  audio_podcast: AudioPodcastOutput;
  video_summary: VideoSummaryOutput;
  primary_url?: string;
  pdf_url?: string;
  is_open_access: boolean;
};
