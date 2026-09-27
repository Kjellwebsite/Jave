'use server';

import { revalidatePath } from 'next/cache';
import { applications, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { DRAFT_TEXT_FIELDS, draftPatchFrom } from '@/lib/applications';
import { formString } from '@/lib/form-data';
import { formatTimestamp } from '@/lib/time';
import { runAction } from '@/server/actions';
import { loadViewer } from '@/server/data/viewer';

const PATH = '/me/application';
const DRAFT_FIELD_NAMES = ['domainKey', ...DRAFT_TEXT_FIELDS];
const REQUIREMENT_KEYS = new Set(Object.keys(applications.REQUIREMENT_MESSAGES));

/**
 * Applicant self-service. Every action acts on the caller's own application
 * (core resolves it from the session); no id from the form is trusted.
 */

export async function startApplicationAction(_: ActionState): Promise<ActionState> {
  return runAction('me.application.start', async (ctx) => {
    const { application } = await applications.getOrCreateDraft(ctx);
    revalidatePath(PATH);
    return `DRAFT OPEN — ${application.number}. Only you can see it.`;
  });
}

/** Field-level problems keep their inline messages; the form states one calm summary. */
const DRAFT_FIX_MESSAGE = 'Nothing was saved. Fix the marked answers and save again.';

export async function saveDraftAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'me.application.save',
    async (ctx) => {
      const draft = await applications
        .updateDraft(ctx, draftPatchFrom(data))
        .catch((error: unknown) => {
          if (error instanceof ValidationError && error.issues.length > 0)
            throw new ValidationError(DRAFT_FIX_MESSAGE, error.issues);
          throw error;
        });
      revalidatePath(PATH);
      return draft.readiness.ready
        ? 'DRAFT SAVED — ready to submit.'
        : `DRAFT SAVED — ${draft.readiness.missing.length} requirement${draft.readiness.missing.length === 1 ? '' : 's'} left before you can submit.`;
    },
    { fieldNames: DRAFT_FIELD_NAMES },
  );
}

export async function submitApplicationAction(_: ActionState): Promise<ActionState> {
  return runAction('me.application.submit', async (ctx) => {
    try {
      const submitted = await applications.submitApplication(ctx);
      revalidatePath(PATH);
      return `APPLICATION SUBMITTED — ${submitted.number}. It is in the review queue.`;
    } catch (error) {
      if (
        error instanceof ValidationError &&
        error.issues.length > 0 &&
        error.issues.every((issue) => REQUIREMENT_KEYS.has(issue.path))
      ) {
        throw new ValidationError(
          `Not ready to submit. ${error.issues.map((issue) => issue.message).join(' ')}`,
        );
      }
      throw error;
    }
  });
}

export async function withdrawApplicationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'me.application.withdraw',
    async (ctx) => {
      const reason = formString(data, 'reason').trim();
      const withdrawn = await applications.withdrawApplication(ctx, reason ? { reason } : {});
      revalidatePath(PATH);
      const status = await applications.getMyApplication(ctx);
      const viewer = await loadViewer(ctx);
      const next = status.cooldownEndsAt
        ? ` You can submit again from ${formatTimestamp(status.cooldownEndsAt, viewer.timeZone)}.`
        : '';
      return `WITHDRAWN — ${withdrawn.number}.${next}`;
    },
    { fieldNames: ['reason'] },
  );
}
