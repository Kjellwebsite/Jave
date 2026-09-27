/**
 * Input limits for the trials and adversarial forms, as browser hints
 * (`maxLength`, `min`, `max`). Client-safe: Client Components cannot import
 * `@jave/core`, so the values are mirrored here and `trial-limits.test.ts`
 * fails the build if they drift from the services, which validate again.
 */
export const TRIAL_LIMITS = {
  titleMin: 3,
  title: 120,
  summary: 280,
  brief: 8000,
  minDuration: 15,
  maxDuration: 14 * 24 * 60,
  minTeamSize: 1,
  maxTeamSize: 12,
  maxParticipants: 500,
  maxFacets: 3,
  templateKey: 64,
  seed: 64,
  reasonMin: 3,
  reason: 500,
  maxExtensionMinutes: 7 * 24 * 60,
  notes: 4000,
  rankReason: 2000,
  scoreMin: 0,
  scoreMax: 10,
} as const;

export const RUBRIC_LIMITS = {
  minCriteria: 1,
  maxCriteria: 10,
  maxWeight: 100,
  keyLength: 48,
  labelLength: 60,
  descriptionLength: 400,
} as const;
