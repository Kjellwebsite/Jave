import { describe, expect, it } from 'vitest';
import { trials } from '@jave/core';
import { RUBRIC_LIMITS, TRIAL_LIMITS } from './trial-limits';

describe('trial form limits mirror the trials service', () => {
  it('text, sizing, timing and score limits', () => {
    expect(TRIAL_LIMITS).toEqual({
      titleMin: trials.LIMITS.titleMin,
      title: trials.LIMITS.title,
      summary: trials.LIMITS.summary,
      brief: trials.LIMITS.brief,
      minDuration: trials.MIN_DURATION_MINUTES,
      maxDuration: trials.MAX_DURATION_MINUTES,
      minTeamSize: trials.MIN_TEAM_SIZE,
      maxTeamSize: trials.MAX_TEAM_SIZE,
      maxParticipants: trials.MAX_PARTICIPANTS,
      maxFacets: trials.MAX_FACETS_PER_TRIAL,
      templateKey: trials.LIMITS.templateKey,
      seed: trials.LIMITS.seed,
      reasonMin: trials.LIMITS.reasonMin,
      reason: trials.LIMITS.reason,
      maxExtensionMinutes: trials.MAX_DEADLINE_EXTENSION_MINUTES,
      notes: trials.LIMITS.notes,
      rankReason: trials.LIMITS.rankReason,
      scoreMin: trials.SCORE_MIN,
      scoreMax: trials.SCORE_MAX,
    });
  });

  it('rubric limits', () => {
    expect(RUBRIC_LIMITS).toEqual({
      minCriteria: trials.RUBRIC_MIN_CRITERIA,
      maxCriteria: trials.RUBRIC_MAX_CRITERIA,
      maxWeight: trials.MAX_CRITERION_WEIGHT,
      keyLength: trials.LIMITS.criterionKey,
      labelLength: trials.LIMITS.criterionLabel,
      descriptionLength: trials.LIMITS.criterionDescription,
    });
  });
});
