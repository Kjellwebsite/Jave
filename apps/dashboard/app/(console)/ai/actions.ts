'use server';

import { revalidatePath } from 'next/cache';
import { ai, isUuid, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { kindLabel } from '@/lib/ai-labels';
import { formOptional, formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';
import { getAiDeps } from '@/server/ai';

const AI_PATH = '/ai';
const SURFACE = 'dashboard';

function proposalIdFrom(data: FormData): string {
  const proposalId = formString(data, 'proposalId');
  if (!isUuid(proposalId)) throw new ValidationError('Unknown proposal.');
  return proposalId;
}

/** CONFIRM → EXECUTE → REPORT. Core checks the kind's capability, expiry and the previewed hash. */
export async function confirmProposalAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('ai.confirm_proposal', async (ctx) => {
    const report = await ai.confirmProposal(ctx, { proposalId: proposalIdFrom(data) });
    revalidatePath(AI_PATH);
    return report.summary;
  });
}

export async function rejectProposalAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ai.reject_proposal',
    async (ctx) => {
      const proposal = await ai.rejectProposal(ctx, {
        proposalId: proposalIdFrom(data),
        reason: formOptional(data, 'reason'),
      });
      revalidatePath(AI_PATH);
      return `PROPOSAL REJECTED — ${kindLabel(proposal.kind).toUpperCase()}. Nothing was executed.`;
    },
    { fieldNames: ['reason'] },
  );
}

/** SUGGEST → PREVIEW: the model drafts, core stores a pending proposal. */
export async function draftAnnouncementAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'ai.draft_announcement',
    async (ctx) => {
      await ai.draftAnnouncement(ctx, getAiDeps(), {
        brief: formString(data, 'brief'),
        surface: SURFACE,
      });
      revalidatePath(AI_PATH);
      return 'PROPOSAL READY — ANNOUNCEMENT. Review the preview below; nothing has been posted.';
    },
    { fieldNames: ['brief'] },
  );
}

export async function draftMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'ai.draft_task',
    async (ctx) => {
      await ai.draftTask(ctx, getAiDeps(), { brief: formString(data, 'brief'), surface: SURFACE });
      revalidatePath(AI_PATH);
      return 'PROPOSAL READY — DRAFT MISSION. Review the preview below; nothing has been created.';
    },
    { fieldNames: ['brief'] },
  );
}
