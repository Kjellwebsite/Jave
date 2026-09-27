'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, moderation, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { EVENT_STATUS_LABELS } from '@/lib/moderation-labels';
import { runAction } from '@/server/actions';

const REVIEW_STATUSES = ['acknowledged', 'dismissed', 'actioned'] as const;
const RAID_STATES = ['on', 'off'] as const;

function uuidField(data: FormData, name: string, label: string): string {
  const value = formString(data, name);
  if (!isUuid(value)) throw new ValidationError(`Unknown ${label}.`);
  return value;
}

function refreshModeration(...paths: string[]): void {
  revalidatePath('/moderation');
  for (const path of paths) revalidatePath(path);
}

/** Strike a case from the record; a restriction still in force is lifted in Discord. */
export async function revokeCaseAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'moderation.revoke_case',
    async (ctx) => {
      const caseId = uuidField(data, 'caseId', 'case');
      const result = await moderation.revokeCase(ctx, {
        caseId,
        reason: formString(data, 'reason'),
      });
      refreshModeration(`/moderation/cases/${caseId}`);
      if (result.reversal) refreshModeration(`/moderation/cases/${result.reversal.id}`);
      return result.reversal
        ? `CASE REVOKED — ${result.case.reference} — lifted through ${result.reversal.reference}.`
        : `CASE REVOKED — ${result.case.reference}.`;
    },
    { fieldNames: ['reason'] },
  );
}

/** Acknowledge, dismiss or mark a security event actioned (canViewSecurityEvents). */
export async function reviewSecurityEventAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'moderation.review_security_event',
    async (ctx) => {
      const securityEventId = uuidField(data, 'securityEventId', 'security event');
      const status = formEnum(data, 'status', REVIEW_STATUSES);
      if (!status) throw new ValidationError('Choose a review outcome.');
      const view = await moderation.reviewSecurityEvent(ctx, {
        securityEventId,
        status,
        note: formOptional(data, 'note'),
      });
      refreshModeration(`/moderation/security/${securityEventId}`);
      return `${view.reference} — ${EVENT_STATUS_LABELS[status].toUpperCase()}.`;
    },
    { fieldNames: ['note'] },
  );
}

/** Switch raid mode (canManageSecurity). The bot mirrors it in Discord. */
export async function setRaidModeAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'moderation.set_raid_mode',
    async (ctx) => {
      const state = formEnum(data, 'state', RAID_STATES);
      if (!state) throw new ValidationError('Choose on or off.');
      const result = await moderation.setRaidMode(ctx, {
        enabled: state === 'on',
        reason: formString(data, 'reason'),
      });
      refreshModeration();
      if (!result.changed) return `RAID MODE — already ${state.toUpperCase()}.`;
      return state === 'on'
        ? 'RAID MODE — ON — new joins are quarantined for review.'
        : 'RAID MODE — OFF — new joins are no longer held.';
    },
    { fieldNames: ['reason'] },
  );
}
