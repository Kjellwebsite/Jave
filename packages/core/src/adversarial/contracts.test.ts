import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, like, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, jobs, notifications, trialTeams } from '@jave/database';
import { createEventHandlers } from '../events/bus';
import { InvalidStateError } from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import { type JobHandlerMap, PermanentJobError } from '../jobs/worker';
import { createTestKit, type TestKit } from '../testing';
import { STOP_NOTICE } from './briefing';
import {
  loadBriefingDelivery,
  loadDebrief,
  loadStopNotice,
  markBriefingDelivered,
  markDebriefPosted,
  markStopNoticeDelivered,
} from './delivery.service';
import {
  ADVERSARIAL_ABORT_JOB,
  ADVERSARIAL_BRIEF_JOB,
  ADVERSARIAL_DEBRIEF_JOB,
  adversarialAbortPayloadSchema,
  adversarialBriefPayloadSchema,
  adversarialDebriefPayloadSchema,
} from './discord-jobs';
import { evaluateRole, revealRole } from './evaluation.service';
import { jobHandlers, subscribers } from './index';
import { addTrigger, recordObservation } from './observations.service';
import {
  abortRole,
  activateRole,
  authorizeRole,
  briefRole,
  concludeRole,
  raiseRedFlag,
} from './roles.service';
import { STOP_WORD } from './safety';
import { LIMITS } from './schemas';
import {
  type AdversarialFixture,
  INTEGRATION_TIMEOUT_MS,
  planDefault,
  runToActive,
  setTrialStatus,
  setupAdversarial,
  TEAM_A_CHANNEL,
} from './test-fixtures';

/**
 * Executes the Discord job contracts through the real job queue with a
 * simulated bot worker that follows each contract to the letter: parse the
 * payload, load through the loader, "send", report through the callback.
 * TEST DOUBLE — the real handlers live in apps/bot.
 */

interface SentMessage {
  kind: 'dm' | 'channel';
  to: string;
  text: string;
}

interface SimulatedDiscord {
  sent: SentMessage[];
  closedDms: Set<string>;
}

const FIRST_MESSAGE_ID = 500_000_000_000_000_000n;

/** Contract rule: a payload that fails its schema is permanent. */
function parsePayload<S extends z.ZodType>(schema: S, payload: unknown): z.infer<S> {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentJobError('invalid payload');
  return result.data;
}

function simulatedBot(discord: SimulatedDiscord): JobHandlerMap {
  let nextMessageId = FIRST_MESSAGE_ID;
  return {
    [ADVERSARIAL_BRIEF_JOB]: async (ctx, payload) => {
      const { roleId, revision } = parsePayload(adversarialBriefPayloadSchema, payload);
      const delivery = await loadBriefingDelivery(ctx, { roleId, revision });
      if (delivery.superseded || delivery.alreadyDelivered) return;
      const reachable = !discord.closedDms.has(delivery.operativeDiscordId);
      if (reachable)
        discord.sent.push({ kind: 'dm', to: delivery.operativeDiscordId, text: delivery.text });
      await markBriefingDelivered(ctx, {
        roleId,
        revision: delivery.revision,
        outcome: reachable ? 'sent' : 'undeliverable',
      });
    },
    [ADVERSARIAL_ABORT_JOB]: async (ctx, payload) => {
      const { roleId } = parsePayload(adversarialAbortPayloadSchema, payload);
      const notice = await loadStopNotice(ctx, { roleId });
      if (notice.alreadyDelivered) return;
      const reachable = !discord.closedDms.has(notice.operativeDiscordId);
      if (reachable)
        discord.sent.push({
          kind: 'dm',
          to: notice.operativeDiscordId,
          text: `${notice.title}\n${notice.body}`,
        });
      await markStopNoticeDelivered(ctx, {
        roleId,
        outcome: reachable ? 'sent' : 'undeliverable',
      });
    },
    [ADVERSARIAL_DEBRIEF_JOB]: async (ctx, payload) => {
      const { roleId } = parsePayload(adversarialDebriefPayloadSchema, payload);
      const debrief = await loadDebrief(ctx, { roleId });
      if (debrief.alreadyPosted) return;
      if (!debrief.channelId) {
        await markDebriefPosted(ctx, { roleId, outcome: 'undeliverable' });
        return;
      }
      discord.sent.push({ kind: 'channel', to: debrief.channelId, text: debrief.text });
      nextMessageId += 1n;
      await markDebriefPosted(ctx, {
        roleId,
        outcome: 'sent',
        channelId: debrief.channelId,
        messageId: nextMessageId.toString(),
      });
    },
  };
}

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial Discord job contracts (simulated bot)', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  let discord: SimulatedDiscord;
  let handlers: JobHandlerMap;

  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
    discord = { sent: [], closedDms: new Set() };
    handlers = { ...jobHandlers, ...createEventHandlers(subscribers), ...simulatedBot(discord) };
  });
  afterEach(async () => {
    await kit.close();
  });

  async function roleRow(roleId: string) {
    const [row] = await kit.db
      .select()
      .from(adversarialRoles)
      .where(eq(adversarialRoles.id, roleId));
    return row!;
  }

  /** Discord jobs that neither completed nor were deliberately cancelled. */
  async function unfinishedDiscordJobs() {
    return kit.db
      .select({ type: jobs.type, status: jobs.status, lastError: jobs.lastError })
      .from(jobs)
      .where(
        and(
          like(jobs.type, 'discord.adversarial.%'),
          notInArray(jobs.status, ['completed', 'cancelled']),
        ),
      );
  }

  async function inbox(userId: string, type: string) {
    const rows = await kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId));
    return rows.filter((row) => row.type === type);
  }

  it('briefing, updated briefing and debrief flow through the queue end to end', async () => {
    const role = await planDefault(fx);
    await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    await kit.drain(handlers);

    expect(discord.sent).toHaveLength(1);
    const briefing = discord.sent[0]!;
    expect(briefing).toMatchObject({ kind: 'dm', to: fx.operative.discordId });
    for (const section of [role.objective, 'GUARDRAILS', 'OPERATING RULES', STOP_WORD])
      expect(briefing.text).toContain(section);
    expect((await roleRow(role.id)).briefingDelivery).toBe('sent');

    // A second authorizer changes the plan after the briefing: revision 2 is DMed.
    await addTrigger(kit.as(fx.founder), {
      roleId: role.id,
      label: 'Token ask',
      description: 'Ask for the sandbox deploy key in the team channel.',
    });
    await kit.drain(handlers);
    expect(discord.sent).toHaveLength(2);
    expect(discord.sent[1]!.text).toContain('Revision 2');
    expect(discord.sent[1]!.text).toContain('Token ask');

    await activateRole(kit.as(fx.planner), { roleId: role.id });
    await recordObservation(kit.as(fx.planner), {
      roleId: role.id,
      outcome: 'reported',
      description: 'Declined and reported the request to staff.',
    });
    await concludeRole(kit.as(fx.planner), { roleId: role.id });
    await evaluateRole(kit.as(fx.authorizer), {
      roleId: role.id,
      summary: 'Reported within minutes.',
      debrief: 'You reported the request instead of complying. That is the standard.',
    });
    await setTrialStatus(kit, fx.trialId, 'completed');
    await revealRole(kit.as(fx.planner), { roleId: role.id });
    await kit.drain(handlers);

    const post = discord.sent.find((message) => message.kind === 'channel');
    expect(post).toMatchObject({ to: TEAM_A_CHANNEL });
    expect(post!.text).toContain('EXERCISE REVEALED');
    expect(post!.text).toContain(fx.operative.displayName);
    expect(post!.text).toContain('SECURITY CULTURE — 7/10');
    const revealed = await roleRow(role.id);
    expect(revealed.debriefDelivery).toBe('sent');
    expect(revealed.debriefChannelId).toBe(TEAM_A_CHANNEL);
    expect(revealed.debriefMessageId).not.toBeNull();
    expect(await unfinishedDiscordJobs()).toEqual([]);
  });

  it('RED FLAG before delivery: only the STOP is sent, never the stale briefing or the note', async () => {
    const role = await planDefault(fx);
    await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    await raiseRedFlag(kit.as(fx.operative), {
      roleId: role.id,
      note: 'A teammate seemed genuinely distressed.',
    });
    await kit.drain(handlers);

    expect(discord.sent).toHaveLength(1);
    const stop = discord.sent[0]!;
    expect(stop).toMatchObject({ kind: 'dm', to: fx.operative.discordId });
    expect(stop.text).toContain(STOP_NOTICE.title);
    expect(stop.text).not.toContain('distressed');
    expect((await roleRow(role.id)).stopNoticeDelivery).toBe('sent');
    expect(await unfinishedDiscordJobs()).toEqual([]);
  });

  it('closed DMs: the planner learns the briefing failed; an undeliverable STOP alerts managers', async () => {
    discord.closedDms.add(fx.operative.discordId);
    const role = await runToActive(fx);
    await kit.drain(handlers);
    expect((await roleRow(role.id)).briefingDelivery).toBe('undeliverable');
    const plannerInbox = await inbox(fx.planner.userId, 'adversarial.staff');
    expect(plannerInbox.map((n) => n.title)).toContain(
      `BRIEFING NOT DELIVERED — TRIAL #${fx.trialNumber}`,
    );

    await abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'Operative unreachable.' });
    await kit.drain(handlers);
    expect(discord.sent).toEqual([]);
    expect((await roleRow(role.id)).stopNoticeDelivery).toBe('undeliverable');
    for (const manager of [fx.founder, fx.authorizer]) {
      const alerts = await inbox(manager.userId, 'adversarial.alert');
      expect(alerts.map((n) => n.title)).toContain(`STOP NOT DELIVERED — TRIAL #${fx.trialNumber}`);
    }
    expect(await unfinishedDiscordJobs()).toEqual([]);
  });

  it('a missing team channel is reported undeliverable; participants still have the debrief', async () => {
    const role = await runToActive(fx);
    await concludeRole(kit.as(fx.planner), { roleId: role.id });
    await evaluateRole(kit.as(fx.authorizer), {
      roleId: role.id,
      score: 6,
      justification: 'Resisted in voice chat; not captured as observations.',
      summary: 'Held the line without escalating.',
      debrief: 'You held the line. Next time, also report the request to staff.',
    });
    await kit.db
      .update(trialTeams)
      .set({ discordChannelId: null })
      .where(eq(trialTeams.id, fx.teamAId));
    await setTrialStatus(kit, fx.trialId, 'completed');
    await revealRole(kit.as(fx.planner), { roleId: role.id });
    await kit.drain(handlers);

    expect(discord.sent.filter((message) => message.kind === 'channel')).toEqual([]);
    expect((await roleRow(role.id)).debriefDelivery).toBe('undeliverable');
    const plannerInbox = await inbox(fx.planner.userId, 'adversarial.staff');
    expect(plannerInbox.map((n) => n.title)).toContain(
      `DEBRIEF NOT POSTED — TRIAL #${fx.trialNumber}`,
    );
    for (const mate of fx.teammates)
      expect(await inbox(mate.userId, 'adversarial.revealed')).toHaveLength(1);
  });

  it('a late job for an older revision sends the newest briefing once, never twice', async () => {
    const role = await planDefault(fx);
    await authorizeRole(kit.as(fx.authorizer), { roleId: role.id, sandboxAttested: true });
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    // The revision 1 job has not run yet when the plan changes to revision 2.
    await addTrigger(kit.as(fx.founder), {
      roleId: role.id,
      label: 'Token ask',
      description: 'Ask for the sandbox deploy key in the team channel.',
    });
    await kit.drain(handlers);

    expect(discord.sent).toHaveLength(1);
    expect(discord.sent[0]!.text).toContain('Revision 2');
    expect((await roleRow(role.id)).briefingDelivery).toBe('sent');
    expect(await unfinishedDiscordJobs()).toEqual([]);

    const stale = await loadBriefingDelivery(kit.system, { roleId: role.id, revision: 1 });
    expect(stale).toMatchObject({ revision: 2, superseded: true, alreadyDelivered: true });
    await expect(
      loadBriefingDelivery(kit.system, { roleId: role.id, revision: 3 }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: an over-long RED FLAG note is cut, never blocking the STOP', async () => {
    const role = await runToActive(fx);
    const result = await raiseRedFlag(kit.as(fx.operative), {
      roleId: role.id,
      note: `Stop now. ${'x'.repeat(50_000)}`,
    });
    expect(result).toMatchObject({ status: 'aborted', alreadyStopped: false });
    const row = await roleRow(role.id);
    expect(row.abortReason!.length).toBeLessThanOrEqual(LIMITS.stopText + STOP_WORD.length + 32);
    await expect(
      abortRole(kit.as(fx.planner), { roleId: role.id, reason: 'r'.repeat(50_000) }),
    ).rejects.toThrow(/aborted/);
  });

  it('BREAK: replayed, stale or forged jobs send nothing and dead-letter', async () => {
    const role = await runToActive(fx);
    await kit.drain(handlers);
    await concludeRole(kit.as(fx.planner), { roleId: role.id });
    const sentBefore = discord.sent.length;

    // Replay of a briefing after the exercise ended, a STOP nobody owes,
    // a debrief before any reveal, and a malformed payload.
    await enqueueJob(
      kit.system,
      ADVERSARIAL_BRIEF_JOB,
      { roleId: role.id, revision: 1 },
      { dedupeKey: 'replay-brief' },
    );
    await enqueueJob(kit.system, ADVERSARIAL_ABORT_JOB, { roleId: role.id }, { dedupeKey: 'x-1' });
    await enqueueJob(
      kit.system,
      ADVERSARIAL_DEBRIEF_JOB,
      { roleId: role.id },
      { dedupeKey: 'x-2' },
    );
    await enqueueJob(
      kit.system,
      ADVERSARIAL_DEBRIEF_JOB,
      { roleId: 'not-a-uuid' },
      { dedupeKey: 'x-3' },
    );
    await kit.drain(handlers);

    expect(discord.sent).toHaveLength(sentBefore);
    const leftovers = await unfinishedDiscordJobs();
    expect(leftovers).toHaveLength(4);
    expect(leftovers.every((job) => job.status === 'dead')).toBe(true);
    const row = await roleRow(role.id);
    expect(row.stopNoticeDelivery).toBeNull();
    expect(row.debriefDelivery).toBeNull();
  });
});
