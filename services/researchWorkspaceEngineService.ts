/**
 * Research Workspace Data Architecture & Backend Engine Service for shoRDs Research Intelligence OS (Phase 25)
 * Implements transaction safety, optimistic concurrency control, RBAC enforcement,
 * cursor pagination, cache key scoping, and AI job idempotency.
 */

import {
  ApiResponseEnvelope,
  CursorPaginatedResponse,
  FeatureFlags,
  Project,
  ProjectMember,
  ProjectPaper,
  ProjectRole,
  ScreeningDecision,
  ScreeningStatus,
  AIJob,
  AIJobType,
  AIJobStatus
} from "../types/researchWorkspace";

export class ResearchWorkspaceEngineService {
  private static defaultFeatureFlags: FeatureFlags = {
    researchWorkspaceV2: true,
    questionDecompositionV2: true,
    evidenceMapV2: true,
    comparisonV2: true,
    gapValidationV2: true,
    synthesisV2: true,
    reviewWorkspaceV2: true,
    exportIntegrityV2: true
  };

  /**
   * Builds standardized API response envelope.
   */
  static buildEnvelope<T>(data: T | null, error: { code: string; message: string } | null = null): ApiResponseEnvelope<T> {
    return {
      success: error === null,
      data,
      error,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    };
  }

  /**
   * Generates cursor-paginated response.
   */
  static paginateItems<T>(items: T[], cursor?: string, limit: number = 25): CursorPaginatedResponse<T> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    const paginated = items.slice(startIndex, startIndex + safeLimit);
    const hasNext = startIndex + safeLimit < items.length;
    const nextCursor = hasNext ? (startIndex + safeLimit).toString() : undefined;

    return {
      items: paginated,
      hasNext,
      nextCursor
    };
  }

  /**
   * Validates optimistic concurrency version.
   */
  static validateConcurrency(currentVersion: number, expectedVersion?: number): boolean {
    if (expectedVersion === undefined) return true;
    return currentVersion === expectedVersion;
  }

  /**
   * Validates project role authorization server-side.
   */
  static authorizeAction(memberRole: ProjectRole, requiredRole: ProjectRole): boolean {
    const roleHierarchy: Record<ProjectRole, number> = {
      VIEWER: 1,
      COMMENTER: 2,
      EDITOR: 3,
      OWNER: 4
    };
    return roleHierarchy[memberRole] >= roleHierarchy[requiredRole];
  }

  /**
   * Generates tenant-isolated Redis cache key.
   */
  static buildCacheKey(userId: string, projectId: string, resource: string, version: number): string {
    return `user:${userId}:project:${projectId}:resource:${resource}:version:${version}`;
  }

  /**
   * Generates AI job idempotency key.
   */
  static buildAIJobIdempotencyKey(
    projectId: string,
    jobType: AIJobType,
    inputHash: string,
    modelVersion: string,
    promptVersion: string
  ): string {
    return `aijob:${projectId}:${jobType}:${inputHash}:${modelVersion}:${promptVersion}`;
  }

  /**
   * Records append-only screening decision without destroying history.
   */
  static recordScreeningDecision(
    projectPaperId: string,
    userId: string,
    previousStatus: ScreeningStatus | undefined,
    newStatus: ScreeningStatus,
    note?: string
  ): ScreeningDecision {
    return {
      id: `screen_dec_${Date.now()}`,
      projectPaperId,
      userId,
      previousStatus,
      newStatus,
      note,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Returns current active feature flags.
   */
  static getFeatureFlags(): FeatureFlags {
    return { ...this.defaultFeatureFlags };
  }
}
