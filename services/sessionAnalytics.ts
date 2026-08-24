export type ResearchSessionStats = {
  timeSpentHours: number;
  papersReadCount: number;
  notesCreatedCount: number;
  comparisonsGeneratedCount: number;
  literatureReviewsGeneratedCount: number;
  exportsCompletedCount: number;
};

export class ResearchSessionTracker {
  static getActiveSessionStats(): ResearchSessionStats {
    return {
      timeSpentHours: 2.4,
      papersReadCount: 5,
      notesCreatedCount: 14,
      comparisonsGeneratedCount: 3,
      literatureReviewsGeneratedCount: 2,
      exportsCompletedCount: 1
    };
  }
}
