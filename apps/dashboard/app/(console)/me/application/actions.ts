'use server';

import { revalidatePath } from 'next/cache';
import { applications, ConflictError, isJaveError, JaveError, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import {
  DRAFT_TEXT_FIELDS,
  draftPatchFrom,
  WITHDRAW_EXPECTATION_FIELDS,
  withdrawalCostLine,
} from '@/lib/applications';
import { formEnum, formString } from '@/lib/form-data';
import { formatTimestamp } from '@/lib/time';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';

const PATH = '/me/application';
const DRAFT_FIELD_NAMES = ['domainKey', ...DRAFT_TEXT_FIELDS];
const REQUIREMENT_KEYS = new Set(Object.keys(applications.REQUIREMENT_MESSAGES));

/**
 * Applicant self-service. Every action acts on the caller's own application
 * (core resolves it from the session). The only ids a form carries bind a
 * withdrawal to what its confirmation showed; core compares them with the
 * caller's own open application and never looks anything up by them.
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
const SUBMIT_FIX_MESSAGE = 'Nothing was saved or submitted. Fix the marked answers.';
/** Leads a refused submission: the answers were stored even though staff did not get them. */
const NOT_SUBMITTED = 'Draft saved, not submitted.';

/** Stores what the form holds; validation issues keep their field names for inline errors. */
async function saveDraft(
  ctx: UserContext,
  data: FormData,
  fixMessage: string,
): Promise<applications.ApplicantApplicationView> {
  return applications.updateDraft(ctx, draftPatchFrom(data)).catch((error: unknown) => {
    if (error instanceof ValidationError && error.issues.length > 0)
      throw new ValidationError(fixMessage, error.issues);
    throw error;
  });
}

export async function saveDraftAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'me.application.save',
    async (ctx) => {
      const draft = await saveDraft(ctx, data, DRAFT_FIX_MESSAGE);
      revalidatePath(PATH);
      return draft.readiness.ready
        ? 'DRAFT SAVED — ready to submit.'
        : `DRAFT SAVED — ${draft.readiness.missing.length} requirement${draft.readiness.missing.length === 1 ? '' : 's'} left before you can submit.`;
    },
    { fieldNames: DRAFT_FIELD_NAMES },
  );
}

function isMissingRequirements(error: unknown): error is ValidationError {
  return (
    error instanceof ValidationError &&
    error.issues.length > 0 &&
    error.issues.every((issue) => REQUIREMENT_KEYS.has(issue.path))
  );
}

/**
 * Saves what the form holds, then submits it: an edit made since the last
 * save is part of the submission instead of being lost when the answers
 * lock. If the submission is refused, the saved draft stays and says why.
 */
export async function submitDraftAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'me.application.submit',
    async (ctx) => {
      await saveDraft(ctx, data, SUBMIT_FIX_MESSAGE);
      revalidatePath(PATH);
      try {
        const submitted = await applications.submitApplication(ctx);
        return `APPLICATION SUBMITTED — ${submitted.number}. It is in the review queue.`;
      } catch (error) {
        if (isMissingRequirements(error)) {
          throw new ValidationError(
            `${NOT_SUBMITTED} ${error.issues.map((issue) => issue.message).join(' ')}`,
          );
        }
        if (error instanceof ValidationError)
          throw new ValidationError(`${NOT_SUBMITTED} ${error.userMessage}`, error.issues);
        if (isJaveError(error))
          throw new JaveError(error.code, `${NOT_SUBMITTED} ${error.userMessage}`, error.details);
        throw error;
      }
    },
    { fieldNames: DRAFT_FIELD_NAMES },
  );
}

export async function withdrawApplicationAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'me.application.withdraw',
    async (ctx) => {
      const reason = formString(data, 'reason').trim();
      const expectedApplicationId = formString(data, WITHDRAW_EXPECTATION_FIELDS.applicationId);
      const expectedStatus = formEnum(
        data,
        WITHDRAW_EXPECTATION_FIELDS.status,
        applications.OPEN_STATUSES,
      );
      if (!expectedApplicationId || !expectedStatus) {
        throw new ValidationError('Reload the page and confirm again.');
      }
      let withdrawn: applications.ApplicantApplicationView;
      try {
        withdrawn = await applications.withdrawApplication(ctx, {
          ...(reason ? { reason } : {}),
          expectedApplicationId,
          expectedStatus,
        });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        // The page re-renders with the current cost; the dialog says what changed.
        revalidatePath(PATH);
        const [now, viewer] = await Promise.all([
          applications.getMyApplication(ctx),
          loadViewer(ctx),
        ]);
        throw new ConflictError(
          `${error.userMessage} ${withdrawalCostLine(now.withdrawalCooldownEndsAt, viewer.timeZone)} Confirm again to withdraw.`,
        );
      }
      revalidatePath(PATH);
      const [status, viewer] = await Promise.all([
        applications.getMyApplication(ctx),
        loadViewer(ctx),
      ]);
      const next = status.cooldownEndsAt
        ? ` You can submit again from ${formatTimestamp(status.cooldownEndsAt, viewer.timeZone)}.`
        : '';
      return `WITHDRAWN — ${withdrawn.number}.${next}`;
    },
    { fieldNames: ['reason'] },
  );
}
