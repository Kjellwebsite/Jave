'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, research, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import {
  EVIDENCE_LABELS,
  type EvidenceLevel,
  parseTagList,
  REVIEW_STATUSES,
  RESEARCH_STATUS_LABELS,
} from '@/lib/research-labels';
import { runAction } from '@/server/actions';

const LIBRARY_PATH = '/research';
const EVIDENCE_LEVELS = Object.keys(EVIDENCE_LABELS) as EvidenceLevel[];

function itemIdFrom(data: FormData): string {
  const itemId = formString(data, 'itemId');
  if (!isUuid(itemId)) throw new ValidationError('Unknown research item.');
  return itemId;
}

function refresh(itemId: string): void {
  revalidatePath(`${LIBRARY_PATH}/${itemId}`);
  revalidatePath(LIBRARY_PATH);
}

/** Add a reference by hand. Saves (or finds the existing item) and opens it. */
export async function addResearchAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'research.save',
    async (ctx) => {
      const tags = parseTagList(formString(data, 'tags'));
      const { item } = await research.saveResearchItem(
        ctx,
        {
          title: formOptional(data, 'title'),
          url: formOptional(data, 'url'),
          doi: formOptional(data, 'doi'),
          arxivId: formOptional(data, 'arxivId'),
          topic: formOptional(data, 'topic'),
          tags: tags.length > 0 ? tags : undefined,
          summary: formOptional(data, 'summary'),
        },
        { origin: 'manual' },
      );
      revalidatePath(LIBRARY_PATH);
      redirect(`${LIBRARY_PATH}/${item.id}`);
    },
    { fieldNames: ['title', 'url', 'doi', 'arxivId', 'topic', 'tags', 'summary'] },
  );
}

/** Reviewer decision on the version the reviewer saw (core refuses self-review and stale versions). */
export async function reviewResearchAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'research.review',
    async (ctx) => {
      const itemId = itemIdFrom(data);
      const version = Number(formString(data, 'expectedVersion'));
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new ValidationError('This form is out of date. Reload the item.');
      }
      const item = await research.reviewResearchItem(ctx, {
        itemId,
        expectedVersion: version,
        status: formEnum(data, 'status', REVIEW_STATUSES),
        evidenceLevel: formEnum(data, 'evidenceLevel', EVIDENCE_LEVELS),
        topic: formOptional(data, 'topic') ?? null,
        tags: parseTagList(formString(data, 'tags')),
        summary: formOptional(data, 'summary') ?? null,
        note: formOptional(data, 'note'),
      });
      refresh(itemId);
      return `REVIEW RECORDED — ${RESEARCH_STATUS_LABELS[item.status].toUpperCase()} — evidence: ${EVIDENCE_LABELS[item.evidenceLevel].toUpperCase()}.`;
    },
    { fieldNames: ['status', 'evidenceLevel', 'topic', 'tags', 'summary', 'note'] },
  );
}

export async function archiveResearchAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'research.archive',
    async (ctx) => {
      const itemId = itemIdFrom(data);
      await research.archiveResearchItem(ctx, { itemId, reason: formOptional(data, 'reason') });
      refresh(itemId);
      return 'ITEM ARCHIVED. Reviewers can restore it to NEEDS REVIEW.';
    },
    { fieldNames: ['reason'] },
  );
}

export async function requestSidusSyncAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('research.sidus_sync', async (ctx) => {
    const itemId = itemIdFrom(data);
    await research.requestSidusSync(ctx, { itemId });
    refresh(itemId);
    return 'SIDUS SYNC QUEUED. The bot pushes the item in the background.';
  });
}
