'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, ValidationError, verification } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';

const DECISIONS = ['approve', 'reject'] as const;

function verificationIdFrom(data: FormData): string {
  const verificationId = formString(data, 'verificationId');
  if (!isUuid(verificationId)) throw new ValidationError('Unknown verification.');
  return verificationId;
}

function refresh(verificationId: string): void {
  revalidatePath(`/verification/${verificationId}`);
  revalidatePath('/verification');
}

export async function startVerificationReviewAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('verification.start_review', async (ctx) => {
    const verificationId = verificationIdFrom(data);
    const started = await verification.startReview(ctx, { verificationId });
    refresh(verificationId);
    return `IN REVIEW — ${started.reference}. Assigned to you.`;
  });
}

export async function decideVerificationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'verification.decide',
    async (ctx) => {
      const verificationId = verificationIdFrom(data);
      const decision = formEnum(data, 'decision', DECISIONS);
      if (!decision) throw new ValidationError('Unknown decision.');
      const grantedRank = decision === 'approve' ? formOptional(data, 'grantedRank') : undefined;
      const decided = await verification.decideVerification(ctx, {
        verificationId,
        decision,
        note: formString(data, 'note'),
        ...(grantedRank ? { grantedRank } : {}),
      });
      refresh(verificationId);
      if (decision === 'reject') return `VERIFICATION REJECTED — ${decided.reference}.`;
      return decided.grantedRank
        ? `VERIFICATION APPROVED — ${decided.reference} — verified at ${decided.grantedRank}.`
        : `VERIFICATION APPROVED — ${decided.reference}.`;
    },
    { fieldNames: ['note', 'grantedRank'] },
  );
}

export async function revokeVerificationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'verification.revoke',
    async (ctx) => {
      const verificationId = verificationIdFrom(data);
      const revoked = await verification.revokeVerification(ctx, {
        verificationId,
        reason: formString(data, 'reason'),
      });
      refresh(verificationId);
      return `VERIFICATION REVOKED — ${revoked.reference}.`;
    },
    { fieldNames: ['reason'] },
  );
}
