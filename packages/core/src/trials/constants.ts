import { trialCategory, trialStatus } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { formatNumber } from '../kernel/ids';
import type { OrgRole } from '../permissions/roles';

export const TRIAL_CATEGORIES = trialCategory.enumValues;
export type TrialCategory = (typeof TRIAL_CATEGORIES)[number];

export const TRIAL_STATUSES = trialStatus.enumValues;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

/** Human reference: TRIAL-0042. */
export const TRIAL_REF_PREFIX = 'TRIAL';

export function trialRef(trial: { number: number }): string {
  return formatNumber(TRIAL_REF_PREFIX, trial.number);
}

/** Text caps. Every user- or staff-supplied string is bounded. */
export const LIMITS = {
  titleMin: 3,
  title: 120,
  summaryMin: 10,
  summary: 280,
  briefMin: 50,
  brief: 8000,
  statement: 1500,
  statementMin: 20,
  submissionSummary: 4000,
  submissionSummaryMin: 20,
  submissionLinks: 10,
  submissionVersions: 20,
  url: 2048,
  notes: 4000,
  reason: 500,
  reasonMin: 3,
  rankReason: 2000,
  criterionKey: 48,
  criterionLabelMin: 2,
  criterionLabel: 60,
  criterionDescription: 400,
  templateKey: 64,
  seed: 64,
  selectionList: 500,
  teamName: 64,
  evidenceTitle: 200,
} as const;

export const RUBRIC_MIN_CRITERIA = 1;
export const RUBRIC_MAX_CRITERIA = 10;
export const MAX_CRITERION_WEIGHT = 100;

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
/** Scores are stored and compared at two decimal places. */
export const SCORE_DECIMALS = 2;

export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 14 * 24 * 60;
export const MAX_DEADLINE_EXTENSION_MINUTES = 7 * 24 * 60;
export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 12;
export const MAX_PARTICIPANTS = 500;
export const MAX_FACETS_PER_TRIAL = 3;

/** Roles that may apply to a trial. Everyone else (MEMBER, APPLICANT, SUPPORTER) may not. */
export const ELIGIBLE_ROLES: readonly OrgRole[] = [
  'trial',
  'verified',
  'founder',
  'core',
  'operations',
  'moderator',
];

/** Roles preferred as team lead (established members over those still on trial). */
export const LEAD_PRIORITY_ROLES: readonly OrgRole[] = [
  'verified',
  'founder',
  'core',
  'operations',
  'moderator',
];

export const TEAM_NAME_PREFIX = 'UNIT';
export const NATO_ALPHABET = [
  'ALPHA',
  'BRAVO',
  'CHARLIE',
  'DELTA',
  'ECHO',
  'FOXTROT',
  'GOLF',
  'HOTEL',
  'INDIA',
  'JULIETT',
  'KILO',
  'LIMA',
  'MIKE',
  'NOVEMBER',
  'OSCAR',
  'PAPA',
  'QUEBEC',
  'ROMEO',
  'SIERRA',
  'TANGO',
  'UNIFORM',
  'VICTOR',
  'WHISKEY',
  'XRAY',
  'YANKEE',
  'ZULU',
] as const;

/** Non-Discord background work owned by this module. */
export const TRIAL_JOBS = {
  deadlineWarning: 'trials.deadline_warning',
  closeSubmissions: 'trials.close_submissions',
  autoStart: 'trials.auto_start',
  sweepOverdue: 'trials.sweep_overdue',
} as const;

/** Safety net: how often active trials past their close time are swept into evaluation. */
export const SWEEP_INTERVAL_MS = 10 * MINUTE;

/** Job retry budget for time-critical trial jobs. */
export const TRIAL_JOB_MAX_ATTEMPTS = 8;

/** Recruitment-card phases: each is a distinct card state worth re-rendering. */
export const ANNOUNCE_PHASE = {
  open: 'open',
  closes: 'closes',
  refresh: 'refresh',
  closed: 'closed',
  final: 'final',
} as const;

/** Dedupe keys: one live job / one notification per underlying fact. */
export const dedupeKeys = {
  announce: (trialId: string, phase: string) => `trial:${trialId}:announce:${phase}`,
  provision: (teamId: string) => `trial-team:${teamId}:provision`,
  brief: (teamId: string) => `trial-team:${teamId}:brief`,
  teardown: (teamId: string) => `trial-team:${teamId}:teardown`,
  warningJob: (trialId: string, minutes: number, deadlineMs: number) =>
    `trial:${trialId}:warning:${minutes}:${deadlineMs}`,
  discordWarning: (teamId: string, minutes: number, deadlineMs: number) =>
    `trial-team:${teamId}:warning:${minutes}:${deadlineMs}`,
  close: (trialId: string, deadlineMs: number) => `trial:${trialId}:close:${deadlineMs}`,
  autoStart: (trialId: string, startMs: number) => `trial:${trialId}:auto-start:${startMs}`,
  archive: (trialId: string) => `trial:${trialId}:archive`,
  notifyTeam: (trialId: string, teamId: string, memberId: string) =>
    `trial:${trialId}:team:${teamId}:${memberId}`,
  notifyWaitlisted: (trialId: string, memberId: string) =>
    `trial:${trialId}:waitlisted:${memberId}`,
  notifyRemoved: (trialId: string, memberId: string) => `trial:${trialId}:removed:${memberId}`,
  notifyStarting: (trialId: string, memberId: string) => `trial:${trialId}:starting:${memberId}`,
  notifyWarning: (trialId: string, minutes: number, deadlineMs: number, memberId: string) =>
    `trial:${trialId}:deadline:${minutes}:${deadlineMs}:${memberId}`,
  notifyExtended: (trialId: string, deadlineMs: number, memberId: string) =>
    `trial:${trialId}:extended:${deadlineMs}:${memberId}`,
  notifyClosed: (trialId: string, memberId: string) => `trial:${trialId}:closed:${memberId}`,
  notifyEvaluators: (trialId: string) => `trial:${trialId}:evaluate`,
  notifyResult: (trialId: string, memberId: string) => `trial:${trialId}:result:${memberId}`,
  notifyCancelled: (trialId: string, memberId: string) => `trial:${trialId}:cancelled:${memberId}`,
} as const;
