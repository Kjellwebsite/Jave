'use server';

import { revalidatePath } from 'next/cache';
import { applications, isUuid, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { RECOMMENDATION_LABELS, recommendationFrom, scoreFrom } from '@/lib/applications';
import { fromDatetimeLocal } from '@/lib/datetime-local';
import { formEnum, formString } from '@/lib/form-data';
import { formatTimestamp } from '@/lib/time';
import { runAction } from '@/server/actions';
import { loadViewer } from '@/server/data/viewer';

const DECISIONS = ['accept', 'reject'] as const;

function applicationIdFrom(data: FormData): string {
  const applicationId = formString(data, 'applicationId');
  if (!isUuid(applicationId)) throw new ValidationError('Unknown application.');
  return applicationId;
}

function refresh(applicationId: string): void {
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath('/applications');
}

export async function claimApplicationAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('application.claim', async (ctx) => {
    const applicationId = applicationIdFrom(data);
    const summary = await applications.startReview(ctx, { applicationId });
    refresh(applicationId);
    return `CLAIMED — ${summary.number}. It is assigned to you.`;
  });
}

export async function reviewApplicationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'application.review',
    async (ctx) => {
      const applicationId = applicationIdFrom(data);
      const recommendation = recommendationFrom(data);
      if (!recommendation) {
        throw new ValidationError('Choose a recommendation.', [
          { path: 'recommendation', message: 'Choose a recommendation.' },
        ]);
      }
      const result = await applications.reviewApplication(ctx, {
        applicationId,
        recommendation,
        score: scoreFrom(data),
        note: formString(data, 'note'),
      });
      refresh(applicationId);
      const scored = result.score === null ? '' : ` · ${result.score}/5`;
      return `${result.updated ? 'REVIEW REPLACED' : 'REVIEW RECORDED'} — ${RECOMMENDATION_LABELS[result.recommendation].toUpperCase()}${scored}.`;
    },
    { fieldNames: ['recommendation', 'score', 'note'] },
  );
}

export async function scheduleInterviewAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'application.schedule_interview',
    async (ctx) => {
      const applicationId = applicationIdFrom(data);
      const viewer = await loadViewer(ctx);
      const interviewAt = fromDatetimeLocal(formString(data, 'interviewAt'), viewer.timeZone);
      if (!interviewAt) {
        throw new ValidationError('Choose a date and time.', [
          { path: 'interviewAt', message: 'Choose a date and time.' },
        ]);
      }
      const summary = await applications.scheduleInterview(ctx, {
        applicationId,
        interviewAt,
        applicantMessage: formString(data, 'applicantMessage'),
      });
      refresh(applicationId);
      return `INTERVIEW SET — ${summary.number} — ${formatTimestamp(interviewAt, viewer.timeZone)} ${viewer.timeZone}.`;
    },
    { fieldNames: ['interviewAt', 'applicantMessage'] },
  );
}

export async function decideApplicationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'application.decide',
    async (ctx) => {
      const applicationId = applicationIdFrom(data);
      const decision = formEnum(data, 'decision', DECISIONS);
      if (!decision) throw new ValidationError('Unknown decision.');
      const result = await applications.decideApplication(ctx, {
        applicationId,
        decision,
        reason: formString(data, 'reason'),
        applicantMessage: formString(data, 'applicantMessage'),
      });
      refresh(applicationId);
      if (decision === 'reject') return `APPLICATION NOT ACCEPTED — ${result.number}.`;
      return result.grantedRole
        ? `APPLICATION ACCEPTED — ${result.number} — ${result.grantedRole.toUpperCase()} granted.`
        : `APPLICATION ACCEPTED — ${result.number}.`;
    },
    { fieldNames: ['reason', 'applicantMessage'] },
  );
}
