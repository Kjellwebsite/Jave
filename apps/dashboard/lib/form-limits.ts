/**
 * Input limits the mission and achievement forms mirror in the browser
 * (minLength, maxLength, min, max). Client components cannot import the
 * services, so the numbers live here; the services re-validate every field,
 * and a unit test keeps these equal to the core constants.
 */
export const MISSION_FORM_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  briefMin: 10,
  briefMax: 4000,
  rewardNoteMax: 200,
  maxAssignees: 1000,
  durationHoursMax: 2160,
  submissionMax: 4000,
  evidenceTitleMax: 200,
  evidenceUrlMax: 2048,
  feedbackMin: 3,
  feedbackMax: 2000,
  assignBatchMax: 50,
  teamKeyMax: 32,
} as const;

export const ACHIEVEMENT_FORM_LIMITS = {
  keyMax: 64,
  titleMax: 64,
  summaryMax: 120,
  descriptionMax: 1000,
  categoryMax: 32,
  thresholdMax: 10_000,
  ordinalMax: 9999,
  reasonMin: 3,
  reasonMax: 500,
} as const;
