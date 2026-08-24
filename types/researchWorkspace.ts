/**
 * Strongly-Typed Domain Entities for shoRDs Research Intelligence OS (Phase 25)
 * Strict typing across all research workspace entities, project state machines,
 * screening decisions, evidence models, comparisons, AI jobs, and audit logs.
 */

export type ProjectStatus =
  | "NEW"
  | "DISCOVERY"
  | "SCREENING"
  | "EVIDENCE_COLLECTION"
  | "SYNTHESIS"
  | "WRITING"
  | "REVIEW"
  | "COMPLETED"
  | "ARCHIVED";

export type ScreeningStatus =
  | "UNREVIEWED"
  | "RELEVANT"
  | "MAYBE"
  | "NOT_RELEVANT"
  | "READ"
  | "CITED";

export type QuestionStatus = "ACTIVE" | "ANSWERED" | "INSUFFICIENT_DATA" | "ARCHIVED";

export type EvidenceRelation = "SUPPORTING" | "CONTRADICTING" | "INSUFFICIENT";

export type EvidenceGroupType =
  | "THEME"
  | "METHOD"
  | "DATASET"
  | "FINDING"
  | "LIMITATION"
  | "CONTRADICTION"
  | "RESEARCH_GAP"
  | "CUSTOM";

export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "NEEDS_REVIEW";

export type ResearchGapClassification =
  | "EXPLICIT_AUTHOR_GAP"
  | "CROSS_PAPER_OBSERVATION"
  | "UNRESOLVED_CONTRADICTION"
  | "INSUFFICIENT_EVIDENCE";

export type ResearchGapStatus = "CANDIDATE" | "EVIDENCE_REQUIRED" | "VERIFIED" | "REJECTED";

export type SynthesisStatus = "QUEUED" | "IN_PROGRESS" | "READY" | "FAILED" | "STALE";

export type DraftStatus = "DRAFTING" | "IN_REVIEW" | "APPROVED" | "EXPORTED";

export type DraftSource = "USER" | "AI" | "MIXED";

export type DraftClaimStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "UNSUPPORTED"
  | "CONFLICTING"
  | "NEEDS_REVIEW";

export type AIJobType =
  | "SYNTHESIS_GENERATION"
  | "DRAFT_ASSISTANCE"
  | "CLAIM_VERIFICATION"
  | "GAP_DETECTION"
  | "THEME_EXTRACTION";

export type AIJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type ProjectRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export type ReviewIssueSeverity = "INFO" | "WARNING" | "REVIEW_REQUIRED" | "BLOCKING";

export interface User {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: string;
}

export interface ProjectPaper {
  id: string;
  projectId: string;
  paperId: string;
  addedBy: string;
  screeningStatus: ScreeningStatus;
  screeningNote?: string;
  addedAt: string;
  updatedAt: string;
  version: number;
}

export interface ScreeningDecision {
  id: string;
  projectPaperId: string;
  userId: string;
  previousStatus?: ScreeningStatus;
  newStatus: ScreeningStatus;
  note?: string;
  createdAt: string;
}

export interface ResearchQuestion {
  id: string;
  projectId: string;
  text: string;
  version: number;
  isPrimary: boolean;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSubQuestion {
  id: string;
  researchQuestionId: string;
  text: string;
  position: number;
  status: QuestionStatus;
}

export interface QuestionEvidence {
  id: string;
  questionId: string;
  evidenceChunkId: string;
  relation: EvidenceRelation;
}

export interface EvidenceChunk {
  chunkId: string;
  paperId: string;
  text: string;
  section: string;
  page: number;
  paragraphIndex: number;
  sourceType: string;
}

export interface EvidenceNotebookEntry {
  id: string;
  projectId: string;
  evidenceChunkId: string;
  userId: string;
  note?: string;
  tags: string[];
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceGroup {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  type: EvidenceGroupType;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Comparison {
  id: string;
  projectId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonColumn {
  id: string;
  comparisonId: string;
  key: string;
  label: string;
  dataType: string;
  position: number;
}

export interface ComparisonCell {
  id: string;
  comparisonId: string;
  paperId: string;
  columnId: string;
  value: string;
  evidenceChunkIds: string[];
  verificationStatus: VerificationStatus;
}

export interface ResearchGap {
  id: string;
  projectId: string;
  title: string;
  description: string;
  classification: ResearchGapClassification;
  status: ResearchGapStatus;
  evidenceChunkIds: string[];
  paperIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Contradiction {
  id: string;
  projectId: string;
  topic: string;
  paperAId: string;
  claimA: string;
  evidenceChunkAId: string;
  paperBId: string;
  claimB: string;
  evidenceChunkBId: string;
  neutralNotice: string;
  createdAt: string;
}

export interface Synthesis {
  id: string;
  projectId: string;
  type: string;
  status: SynthesisStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SynthesisClaim {
  id: string;
  synthesisId: string;
  text: string;
  evidenceChunkIds: string[];
  verificationStatus: VerificationStatus;
}

export interface Draft {
  id: string;
  projectId: string;
  title: string;
  status: DraftStatus;
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSection {
  id: string;
  draftId: string;
  parentSectionId?: string;
  title: string;
  position: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftVersion {
  id: string;
  draftId: string;
  version: number;
  createdBy: string;
  source: DraftSource;
  createdAt: string;
}

export interface DraftClaim {
  id: string;
  draftSectionId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  evidenceChunkIds: string[];
  citationIds: string[];
  status: DraftClaimStatus;
}

export interface Citation {
  id: string;
  projectId: string;
  paperId: string;
  inTextFormat: string;
  style: string;
  verifiedAt: string;
}

export interface Reference {
  id: string;
  projectId: string;
  paperId: string;
  title: string;
  authors: string[];
  year: number;
  venue?: string;
  doi?: string;
  isVerified: boolean;
}

export interface ReviewIssue {
  id: string;
  projectId: string;
  severity: ReviewIssueSeverity;
  category: string;
  description: string;
  isResolved: boolean;
  createdAt: string;
}

export interface ExportJob {
  id: string;
  projectId: string;
  format: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  outputUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export interface AIJob {
  id: string;
  projectId: string;
  userId: string;
  type: AIJobType;
  status: AIJobStatus;
  inputHash: string;
  modelVersion: string;
  promptVersion: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  errorCode?: string;
}

export interface AIArtifact {
  id: string;
  jobId: string;
  projectId: string;
  artifactType: string;
  content: string;
  sourceEvidenceIds: string[];
  modelVersion: string;
  promptVersion: string;
  createdAt: string;
}

export interface ProjectActivity {
  id: string;
  projectId: string;
  userId: string;
  action: string;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}

export interface CursorPaginatedResponse<T> {
  items: T[];
  hasNext: boolean;
  nextCursor?: string;
}

export interface FeatureFlags {
  researchWorkspaceV2: boolean;
  questionDecompositionV2: boolean;
  evidenceMapV2: boolean;
  comparisonV2: boolean;
  gapValidationV2: boolean;
  synthesisV2: boolean;
  reviewWorkspaceV2: boolean;
  exportIntegrityV2: boolean;
}
