import { z } from 'zod';
import { sanitizeForDiscord } from '@jave/ai';
import { missions, missionType } from '@jave/database';
import { enqueueJob } from '../../jobs/queue';
import { InvalidStateError } from '../../kernel/errors';
import { truncate } from '../../kernel/redact';
import { requireUser } from '../../permissions/authorize';
import { requireContributor } from '../../research/model';
import { saveResearchItem } from '../../research/research.service';
import { saveResearchItemSchema } from '../../research/schemas';
import { getSettings } from '../../settings/settings.service';
import { DISCORD_AI_ANNOUNCE_JOB } from '../discord-jobs';
import { defineActionKind, type RegisteredActionKind } from './registry';

const PREVIEW_BODY_CHARS = 600;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const ANNOUNCE_MAX_ATTEMPTS = 5;
const MISSION_NUMBER_WIDTH = 4;

function lines(...entries: (string | number | false | null | undefined)[]): string {
  return entries.filter((entry): entry is string => typeof entry === 'string').join('\n');
}

/** Save a research item for the member who asked. They confirm their own. */
export const createResearchItemAction = defineActionKind({
  kind: 'create_research_item',
  description: 'Save a reference to the Sidus research library (status NEW, enters review).',
  capabilityToPropose: 'canUseAI',
  capabilityToConfirm: 'canUseAI',
  confirmableBy: 'requester',
  payloadSchema: saveResearchItemSchema,
  preview: (payload) =>
    lines(
      'SAVE TO RESEARCH LIBRARY',
      payload.title && `Title: ${payload.title}`,
      payload.authors?.length && `Authors: ${payload.authors.join(', ')}`,
      payload.doi && `DOI: ${payload.doi}`,
      payload.arxivId && `arXiv: ${payload.arxivId}`,
      payload.url && `Link: ${payload.url}`,
      payload.topic && `Topic: ${payload.topic}`,
      payload.tags?.length && `Tags: ${payload.tags.join(', ')}`,
      'Saved as NEW. A reviewer decides its status and evidence level.',
    ),
  authorizeExecution: async (ctx) => {
    await requireContributor(ctx);
  },
  execute: async (ctx, payload) => {
    const { item, duplicate } = await saveResearchItem(ctx, payload, { origin: 'ai' });
    return {
      status: 'executed',
      summary: duplicate
        ? `ALREADY IN LIBRARY — ${item.title}.`
        : `RESEARCH SAVED — ${item.title}. Status: NEW.`,
      data: { itemId: item.id, duplicate },
    };
  },
});

const createTaskSchema = z.object({
  title: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(10).max(4000),
  type: z.enum(missionType.enumValues).default('individual'),
});

/**
 * Draft a mission (status DRAFT, invisible to members until published).
 * Written directly to the `missions` table because the missions module had
 * no creation API at the time of writing; switch to it once it exists.
 */
export const createTaskAction = defineActionKind({
  kind: 'create_task',
  description: 'Create a mission in DRAFT for staff to refine and publish.',
  capabilityToPropose: 'canManageMissions',
  capabilityToConfirm: 'canManageMissions',
  confirmableBy: 'capability',
  payloadSchema: createTaskSchema,
  preview: (payload) =>
    lines(
      'DRAFT MISSION',
      `Title: ${payload.title}`,
      `Type: ${payload.type.toUpperCase()}`,
      `Brief: ${truncate(payload.brief, PREVIEW_BODY_CHARS)}`,
      'Created as DRAFT — not visible to members until published.',
    ),
  execute: async (ctx, payload) => {
    const actor = requireUser(ctx);
    const [mission] = await ctx.db
      .insert(missions)
      .values({
        title: payload.title,
        brief: payload.brief,
        type: payload.type,
        status: 'draft',
        createdByUserId: actor.userId,
        createdAt: ctx.clock.now(),
        updatedAt: ctx.clock.now(),
      })
      .returning({ id: missions.id, number: missions.number });
    return {
      status: 'executed',
      summary: `MISSION DRAFTED — #${String(mission!.number).padStart(MISSION_NUMBER_WIDTH, '0')} ${payload.title}. Status: DRAFT.`,
      data: { missionId: mission!.id, number: mission!.number },
    };
  },
});

const draftAnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(10).max(3500),
});

/** Post an announcement to the configured channel via the bot. Broadcasters only. */
export const draftAnnouncementAction = defineActionKind({
  kind: 'draft_announcement',
  description: 'Post an announcement to the announcements channel.',
  capabilityToPropose: 'canBroadcast',
  capabilityToConfirm: 'canBroadcast',
  confirmableBy: 'capability',
  payloadSchema: draftAnnouncementSchema,
  preview: (payload) =>
    lines(
      'ANNOUNCEMENT → announcements channel',
      payload.title.toUpperCase(),
      '',
      truncate(payload.body, PREVIEW_BODY_CHARS),
    ),
  execute: async (ctx, payload, meta) => {
    const { announcements } = await getSettings(ctx, 'channels');
    if (!announcements) {
      throw new InvalidStateError(
        'No announcements channel is configured. Set channels.announcements first.',
      );
    }
    const jobId = await enqueueJob(
      ctx,
      DISCORD_AI_ANNOUNCE_JOB,
      {
        proposalId: meta.proposalId,
        channelId: announcements,
        title: sanitizeForDiscord(payload.title.toUpperCase(), DISCORD_EMBED_TITLE_LIMIT),
        body: sanitizeForDiscord(payload.body, DISCORD_EMBED_DESCRIPTION_LIMIT),
      },
      { dedupeKey: `ai:announce:${meta.proposalId}`, maxAttempts: ANNOUNCE_MAX_ATTEMPTS },
    );
    return {
      status: 'queued',
      summary: 'ANNOUNCEMENT QUEUED — posting to the announcements channel.',
      data: { jobId, channelId: announcements },
    };
  },
});

export const ACTION_KINDS: Readonly<Record<string, RegisteredActionKind>> = {
  [createResearchItemAction.kind]: createResearchItemAction,
  [createTaskAction.kind]: createTaskAction,
  [draftAnnouncementAction.kind]: draftAnnouncementAction,
};

export const ACTION_KIND_NAMES = Object.keys(ACTION_KINDS);

export function getActionKind(kind: string): RegisteredActionKind | null {
  return Object.hasOwn(ACTION_KINDS, kind) ? (ACTION_KINDS[kind] ?? null) : null;
}
