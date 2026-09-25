import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, members, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import {
  type BriefingView,
  type DebriefView,
  renderBriefingText,
  renderDebriefText,
  STOP_NOTICE,
} from './briefing';
import { assertSystemActor, AUDIT_TARGET_ROLE, loadRole, loadTrial } from './guards';
import { alertStaff, notifyStaffUser } from './notify';
import {
  loadBriefingSchema,
  markBriefingDeliveredSchema,
  markDebriefPostedSchema,
  markStopNoticeDeliveredSchema,
  roleIdSchema,
} from './schemas';
import { OPERATIVE_STOPPABLE_STATUSES, type RoleRecord } from './state';
import { loadBriefingView, loadDebriefView } from './views';

/**
 * Loaders and callbacks for the Discord job contracts (see discord-jobs.ts).
 * System actor only: they run in the bot's worker. Loaders refuse (with a
 * non-retryable error) whenever the message must no longer be sent.
 */

async function operativeDiscordId(ctx: ServiceContext, role: RoleRecord): Promise<string> {
  const [row] = await ctx.db
    .select({ discordId: users.discordId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.id, role.operativeMemberId));
  if (!row) throw new NotFoundError('Operative');
  return row.discordId;
}

export interface BriefingDelivery {
  roleId: string;
  /** The current revision: what `briefing` and `text` contain. */
  revision: number;
  /**
   * The job's revision is outdated: send nothing, the job for the current
   * revision delivers it. Exactly one job exists per revision, so even jobs
   * running concurrently send the briefing once.
   */
  superseded: boolean;
  /** The current revision already reached the operative (e.g. a retried job): send nothing. */
  alreadyDelivered: boolean;
  operativeDiscordId: string;
  briefing: BriefingView;
  text: string;
}

/**
 * discord.adversarial.brief — refuses unless the role is briefed or active,
 * and refuses revisions that do not exist (forged payloads).
 */
export async function loadBriefingDelivery(
  ctx: ServiceContext,
  input: z.input<typeof loadBriefingSchema>,
): Promise<BriefingDelivery> {
  assertSystemActor(ctx);
  const data = parseInput(loadBriefingSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (!OPERATIVE_STOPPABLE_STATUSES.includes(role.status))
    throw new InvalidStateError(`Role is ${role.status}; the briefing must not be sent.`);
  if (data.revision > role.briefingRevision)
    throw new InvalidStateError('Unknown briefing revision.');
  const briefing = await loadBriefingView(ctx, role);
  return {
    roleId: role.id,
    revision: role.briefingRevision,
    superseded: data.revision < role.briefingRevision,
    alreadyDelivered: role.briefingDelivery === 'sent',
    operativeDiscordId: await operativeDiscordId(ctx, role),
    briefing,
    text: renderBriefingText(briefing),
  };
}

/** Callback for discord.adversarial.brief. Stale revisions are ignored. Idempotent. */
export async function markBriefingDelivered(
  ctx: ServiceContext,
  input: z.input<typeof markBriefingDeliveredSchema>,
): Promise<{ recorded: boolean }> {
  assertSystemActor(ctx);
  const data = parseInput(markBriefingDeliveredSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (data.revision < role.briefingRevision || role.briefingDelivery === 'sent')
    return { recorded: false };
  const trial = await loadTrial(ctx, role.trialId);
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(adversarialRoles)
      .set({ briefingDelivery: data.outcome, briefingDeliveredAt: now, updatedAt: now })
      .where(
        and(
          eq(adversarialRoles.id, role.id),
          eq(adversarialRoles.briefingRevision, data.revision),
          or(
            isNull(adversarialRoles.briefingDelivery),
            ne(adversarialRoles.briefingDelivery, 'sent'),
          ),
        ),
      )
      .returning({ id: adversarialRoles.id });
    if (!updated) return { recorded: false };
    await recordAudit(tx, {
      action: 'adversarial.briefing_delivered',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { revision: data.revision, outcome: data.outcome },
    });
    if (data.outcome === 'undeliverable') {
      await notifyStaffUser(tx, {
        userId: role.createdByUserId,
        roleId: role.id,
        trialId: role.trialId,
        fact: `briefing-undeliverable:${data.revision}`,
        title: `BRIEFING NOT DELIVERED — TRIAL #${trial.number}`,
        body: 'The operative does not accept DMs. They can read the briefing on the dashboard; confirm they have it before activating.',
      });
    }
    return { recorded: true };
  });
}

export interface StopNoticeDelivery {
  roleId: string;
  operativeDiscordId: string;
  title: string;
  body: string;
  alreadyDelivered: boolean;
}

/** discord.adversarial.abort — the STOP text is fixed; the abort reason is never included. */
export async function loadStopNotice(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<StopNoticeDelivery> {
  assertSystemActor(ctx);
  const data = parseInput(roleIdSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (role.abortedAt === null || role.stopNoticeDelivery === null)
    throw new InvalidStateError('No STOP notice is owed for this role.');
  return {
    roleId: role.id,
    operativeDiscordId: await operativeDiscordId(ctx, role),
    title: STOP_NOTICE.title,
    body: STOP_NOTICE.body,
    alreadyDelivered: role.stopNoticeDelivery === 'sent',
  };
}

/** Callback for discord.adversarial.abort. An undeliverable STOP raises a critical alert. */
export async function markStopNoticeDelivered(
  ctx: ServiceContext,
  input: z.input<typeof markStopNoticeDeliveredSchema>,
): Promise<{ recorded: boolean }> {
  assertSystemActor(ctx);
  const data = parseInput(markStopNoticeDeliveredSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (role.stopNoticeDelivery === null || role.stopNoticeDelivery === 'sent')
    return { recorded: false };
  const trial = await loadTrial(ctx, role.trialId);
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [updated] = await tx.db
      .update(adversarialRoles)
      .set({ stopNoticeDelivery: data.outcome, stopNoticeDeliveredAt: now, updatedAt: now })
      .where(
        and(
          eq(adversarialRoles.id, role.id),
          isNotNull(adversarialRoles.stopNoticeDelivery),
          ne(adversarialRoles.stopNoticeDelivery, 'sent'),
        ),
      )
      .returning({ id: adversarialRoles.id });
    if (!updated) return { recorded: false };
    await recordAudit(tx, {
      action: 'adversarial.stop_notice_delivered',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { outcome: data.outcome },
    });
    if (data.outcome === 'undeliverable') {
      await alertStaff(tx, {
        roleId: role.id,
        trialId: role.trialId,
        fact: 'stop-undeliverable',
        title: `STOP NOT DELIVERED — TRIAL #${trial.number}`,
        body: 'The STOP notice could not reach the operative by DM. Contact them directly now.',
      });
    }
    return { recorded: true };
  });
}

export interface DebriefDelivery {
  roleId: string;
  channelId: string | null;
  alreadyPosted: boolean;
  debrief: DebriefView;
  text: string;
}

/** discord.adversarial.debrief — refuses unless the role was revealed. */
export async function loadDebrief(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<DebriefDelivery> {
  assertSystemActor(ctx);
  const data = parseInput(roleIdSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (role.status !== 'revealed')
    throw new InvalidStateError('The debrief is posted only after the reveal.');
  const loaded = await loadDebriefView(ctx, role);
  if (!loaded) throw new InvalidStateError('No debrief exists for this role.');
  return {
    roleId: role.id,
    channelId: loaded.channelId,
    alreadyPosted: role.debriefDelivery === 'sent',
    debrief: loaded.view,
    text: renderDebriefText(loaded.view),
  };
}

/** Callback for discord.adversarial.debrief. Idempotent. */
export async function markDebriefPosted(
  ctx: ServiceContext,
  input: z.input<typeof markDebriefPostedSchema>,
): Promise<{ recorded: boolean }> {
  assertSystemActor(ctx);
  const data = parseInput(markDebriefPostedSchema, input);
  const role = await loadRole(ctx, data.roleId);
  if (role.status !== 'revealed' || role.debriefDelivery === 'sent') return { recorded: false };
  const trial = await loadTrial(ctx, role.trialId);
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const posted = data.outcome === 'sent';
    const [updated] = await tx.db
      .update(adversarialRoles)
      .set({
        debriefDelivery: data.outcome,
        debriefChannelId: posted ? (data.channelId ?? null) : null,
        debriefMessageId: posted ? (data.messageId ?? null) : null,
        debriefPostedAt: posted ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(adversarialRoles.id, role.id),
          or(
            isNull(adversarialRoles.debriefDelivery),
            ne(adversarialRoles.debriefDelivery, 'sent'),
          ),
        ),
      )
      .returning({ id: adversarialRoles.id });
    if (!updated) return { recorded: false };
    await recordAudit(tx, {
      action: 'adversarial.debrief_posted',
      targetType: AUDIT_TARGET_ROLE,
      targetId: role.id,
      context: { outcome: data.outcome, channelId: data.channelId ?? null },
    });
    if (!posted) {
      await notifyStaffUser(tx, {
        userId: role.createdByUserId,
        roleId: role.id,
        trialId: role.trialId,
        fact: 'debrief-undeliverable',
        title: `DEBRIEF NOT POSTED — TRIAL #${trial.number}`,
        body: 'The team channel is unavailable. Participants received the debrief as a notification.',
      });
    }
    return { recorded: true };
  });
}
