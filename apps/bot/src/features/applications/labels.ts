import type { applications } from '@jave/core';
import { COLORS } from '../../ui/theme';

type ApplicationStatus = applications.ApplicationStatus;
type ApplicationRecommendation = applications.ApplicationRecommendation;

export const STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = {
  draft: 'DRAFT',
  submitted: 'SUBMITTED',
  review: 'IN REVIEW',
  interview: 'INTERVIEW',
  accepted: 'ACCEPTED',
  rejected: 'NOT ACCEPTED',
  withdrawn: 'WITHDRAWN',
};

export const STATUS_COLORS: Readonly<Record<ApplicationStatus, number>> = {
  draft: COLORS.steel,
  submitted: COLORS.info,
  review: COLORS.info,
  interview: COLORS.warning,
  accepted: COLORS.success,
  rejected: COLORS.danger,
  withdrawn: COLORS.steel,
};

export const RECOMMENDATION_LABELS: Readonly<Record<ApplicationRecommendation, string>> = {
  accept: 'ACCEPT',
  reject: 'REJECT',
  interview: 'INTERVIEW',
  abstain: 'ABSTAIN',
};

export const RECOMMENDATION_DESCRIPTIONS: Readonly<Record<ApplicationRecommendation, string>> = {
  accept: 'Admit to JAVELIN.',
  reject: 'Not this time.',
  interview: 'Talk to them before deciding.',
  abstain: 'No recommendation. Does not count toward a decision.',
};

/** Button labels for core's staff actions. */
export const STAFF_ACTION_LABELS: Readonly<Record<applications.StaffAction, string>> = {
  start_review: 'Claim',
  review: 'Review',
  schedule_interview: 'Interview',
  accept: 'Accept',
  reject: 'Reject',
};

export const STAFF_ACTION_STYLES: Readonly<
  Record<applications.StaffAction, 'primary' | 'secondary' | 'success' | 'danger'>
> = {
  start_review: 'primary',
  review: 'secondary',
  schedule_interview: 'secondary',
  accept: 'success',
  reject: 'danger',
};
