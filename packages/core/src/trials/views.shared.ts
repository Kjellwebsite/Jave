import type { RubricCriterion } from '@jave/database';
import { type TrialCategory, type TrialStatus, trialRef } from './constants';
import type { TrialRecord } from './repository';
import { type TrialTiming, trialTiming } from './timing';

/**
 * Public, member-safe summary of a trial. Built field by field from an explicit
 * whitelist — never by spreading the row — so staff-only columns (adversarial
 * flag, assignment seed, Discord IDs) can never leak through it.
 */
export interface TrialSummaryView {
  id: string;
  number: number;
  ref: string;
  title: string;
  category: TrialCategory;
  summary: string;
  status: TrialStatus;
  teamSize: number;
  maxParticipants: number | null;
  durationMinutes: number;
  facetKeys: string[];
  recruitmentClosesAt: Date | null;
  scheduledStartAt: Date | null;
  startedAt: Date | null;
  deadlineAt: Date | null;
  submissionsClosedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  timing: TrialTiming;
}

export function toSummaryView(trial: TrialRecord, now: Date): TrialSummaryView {
  return {
    id: trial.id,
    number: trial.number,
    ref: trialRef(trial),
    title: trial.title,
    category: trial.category,
    summary: trial.summary,
    status: trial.status,
    teamSize: trial.teamSize,
    maxParticipants: trial.maxParticipants,
    durationMinutes: trial.durationMinutes,
    facetKeys: trial.facetKeys,
    recruitmentClosesAt: trial.recruitmentClosesAt,
    scheduledStartAt: trial.scheduledStartAt,
    startedAt: trial.startedAt,
    deadlineAt: trial.deadlineAt,
    submissionsClosedAt: trial.submissionsClosedAt,
    completedAt: trial.completedAt,
    cancelledAt: trial.cancelledAt,
    timing: trialTiming(trial, now),
  };
}

export interface RubricView {
  key: string;
  label: string;
  description: string;
  weight: number;
  /** Share of the total weight, 0–100, rounded. */
  weightPercent: number;
}

const PERCENT = 100;

export function toRubricView(rubric: readonly RubricCriterion[]): RubricView[] {
  const total = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  return rubric.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    description: criterion.description,
    weight: criterion.weight,
    weightPercent: total > 0 ? Math.round((criterion.weight / total) * PERCENT) : 0,
  }));
}
