import 'server-only';
import { applications, type ServiceContext, verification } from '@jave/core';

/**
 * Readouts for the application and verification queues. Each count is a
 * page total from the same authorized list services the tables use, so the
 * tiles can never show more than the viewer may list.
 */

const COUNT_ONLY = { limit: 1 } as const;

export interface ApplicationQueueCounts {
  unclaimed: number;
  inReview: number;
  interview: number;
  assignedToMe: number;
}

export async function loadApplicationQueueCounts(
  ctx: ServiceContext,
): Promise<ApplicationQueueCounts> {
  const total = async (input: Parameters<typeof applications.listApplications>[1]) =>
    (await applications.listApplications(ctx, { ...input, ...COUNT_ONLY })).total;
  const [unclaimed, inReview, interview, assignedToMe] = await Promise.all([
    total({ status: 'submitted' }),
    total({ status: 'review' }),
    total({ status: 'interview' }),
    total({ status: ['submitted', 'review', 'interview'], assignedToMe: true }),
  ]);
  return { unclaimed, inReview, interview, assignedToMe };
}

export interface VerificationQueueCounts {
  pending: number;
  inReview: number;
  unassigned: number;
  assignedToMe: number;
}

export async function loadVerificationQueueCounts(
  ctx: ServiceContext,
): Promise<VerificationQueueCounts> {
  const open = [...verification.OPEN_STATUSES];
  const total = async (input: verification.ListVerificationsInput) =>
    (await verification.listVerifications(ctx, { ...input, ...COUNT_ONLY })).total;
  const [pending, inReview, unassigned, assignedToMe] = await Promise.all([
    total({ status: 'pending' }),
    total({ status: 'in_review' }),
    total({ status: open, unassigned: true }),
    total({ status: open, assignedToMe: true }),
  ]);
  return { pending, inReview, unassigned, assignedToMe };
}
