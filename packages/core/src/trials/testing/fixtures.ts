import { createEventHandlers } from '../../events/bus';
import { isJaveError } from '../../kernel/errors';
import type { JobHandlerMap } from '../../jobs/worker';
import type { UserActor } from '../../permissions/actor';
import type { OrgRole } from '../../permissions/roles';
import { updateSettings } from '../../settings/settings.service';
import type { TestKit } from '../../testing';
import { nextDiscordId } from '../../testing';
import { applyToTrial } from '../participation.service';
import { createTrial, openRecruitment } from '../admin.service';
import { assignTeams, type AssignmentResult, selectParticipants } from '../roster.service';
import { startTrial } from '../run.service';
import {
  getAnnouncementSpec,
  getArchiveSpec,
  getTeamBriefSpec,
  getTeamProvisioningSpec,
  getTeamWarningSpec,
  markAnnouncementPosted,
  markTeamBriefed,
  markTeamProvisioned,
  markTeamsArchived,
} from '../discord.service';
import {
  DISCORD_TRIALS_ANNOUNCE_JOB,
  DISCORD_TRIALS_ARCHIVE_JOB,
  DISCORD_TRIALS_BRIEF_JOB,
  DISCORD_TRIALS_PROVISION_JOB,
  DISCORD_TRIALS_TEARDOWN_JOB,
  DISCORD_TRIALS_WARNING_JOB,
  teardownJobSchema,
  warningJobSchema,
} from '../discord-jobs';
import { jobHandlers } from '../index';
import type { createTrialSchema } from '../schemas';
import type { z } from 'zod';

/**
 * MOCK / DEVELOPMENT ONLY — a stand-in for the bot's side of the Discord job
 * contracts. It follows each contract exactly (spec loader → Discord action →
 * callback) but records Discord actions instead of performing them, so the
 * whole lifecycle can be exercised against real Postgres.
 */
export interface FakeDiscordLog {
  posted: { kind: string; channelId: string; text: string }[];
  channels: Map<string, { name: string; members: string[]; deny: string[]; locked: boolean }>;
  deleted: string[];
}

export function createFakeDiscordLog(): FakeDiscordLog {
  return { posted: [], channels: new Map(), deleted: [] };
}

export function fakeDiscordHandlers(log: FakeDiscordLog): JobHandlerMap {
  return {
    [DISCORD_TRIALS_ANNOUNCE_JOB]: async (ctx, payload) => {
      const spec = await getAnnouncementSpec(ctx, { trialId: String(payload.trialId) });
      if (spec.action === 'skip') return { skipped: spec.reason };
      if (spec.action === 'post') {
        const messageId = nextDiscordId();
        log.posted.push({ kind: 'announce', channelId: spec.channelId, text: spec.card.heading });
        await markAnnouncementPosted(ctx, {
          trialId: spec.trialId,
          channelId: spec.channelId,
          messageId,
        });
        return { posted: messageId };
      }
      log.posted.push({
        kind: 'announce-edit',
        channelId: spec.channelId,
        text: spec.card.buttonLabel,
      });
      return { edited: spec.messageId };
    },
    [DISCORD_TRIALS_PROVISION_JOB]: async (ctx, payload) => {
      const spec = await getTeamProvisioningSpec(ctx, { teamId: String(payload.teamId) });
      if (spec.action === 'skip') return { skipped: spec.reason };
      const channelId = spec.existingChannelId ?? nextDiscordId();
      const roleId = spec.createRole ? (spec.existingRoleId ?? nextDiscordId()) : null;
      log.channels.set(channelId, {
        name: spec.channelName,
        members: spec.memberDiscordIds,
        deny: spec.denyDiscordIds,
        locked: false,
      });
      try {
        await markTeamProvisioned(ctx, { teamId: spec.teamId, channelId, roleId });
      } catch (error) {
        if (isJaveError(error) && error.code === 'NOT_FOUND') {
          log.channels.delete(channelId);
          log.deleted.push(channelId);
          return { orphaned: channelId };
        }
        throw error;
      }
      return { channelId, roleId };
    },
    [DISCORD_TRIALS_BRIEF_JOB]: async (ctx, payload) => {
      const spec = await getTeamBriefSpec(ctx, { teamId: String(payload.teamId) });
      if (spec.action === 'skip') return { skipped: spec.reason };
      if (spec.action === 'wait') throw new Error(spec.reason);
      log.posted.push({ kind: 'brief', channelId: spec.channelId, text: spec.heading });
      await markTeamBriefed(ctx, { teamId: spec.teamId });
      return { briefed: spec.teamId };
    },
    [DISCORD_TRIALS_WARNING_JOB]: async (ctx, payload) => {
      const data = warningJobSchema.parse(payload);
      const spec = await getTeamWarningSpec(ctx, data);
      if (spec.action === 'skip') return { skipped: spec.reason };
      log.posted.push({ kind: 'warning', channelId: spec.channelId, text: spec.message });
      return { warned: spec.channelId };
    },
    [DISCORD_TRIALS_ARCHIVE_JOB]: async (ctx, payload) => {
      const spec = await getArchiveSpec(ctx, { trialId: String(payload.trialId) });
      if (spec.action === 'skip') return { skipped: spec.reason };
      for (const team of spec.teams) {
        const channel = log.channels.get(team.channelId);
        if (channel) channel.locked = true;
        log.posted.push({ kind: 'archive', channelId: team.channelId, text: spec.closingMessage });
      }
      await markTeamsArchived(ctx, {
        trialId: spec.trialId,
        teamIds: spec.teams.map((team) => team.teamId),
      });
      return { archived: spec.teams.length };
    },
    [DISCORD_TRIALS_TEARDOWN_JOB]: async (_ctx, payload) => {
      const data = teardownJobSchema.parse(payload);
      if (data.channelId) {
        log.channels.delete(data.channelId);
        log.deleted.push(data.channelId);
      }
      return { deleted: data.channelId };
    },
  };
}

/** Core trial jobs + event dispatch + the MOCK Discord bot. */
export function trialHandlers(log: FakeDiscordLog): JobHandlerMap {
  return { ...jobHandlers, ...createEventHandlers([]), ...fakeDiscordHandlers(log) };
}

export const TRIALS_CATEGORY_ID = '900000000000000100';
export const ANNOUNCEMENTS_CHANNEL_ID = '900000000000000200';
export const OPERATIONS_DISCORD_ROLE_ID = '900000000000000300';

/** Channel + role mapping the provisioning specs rely on. */
export async function configureDiscord(kit: TestKit): Promise<void> {
  await updateSettings(kit.system, 'channels', {
    trialsCategory: TRIALS_CATEGORY_ID,
    announcements: ANNOUNCEMENTS_CHANNEL_ID,
  });
  await updateSettings(kit.system, 'roles', {
    discordRoleIds: { operations: OPERATIONS_DISCORD_ROLE_ID },
  });
}

export const STATEMENT = 'I ship working software under pressure and I want to prove it here.';

export const CUSTOM_TRIAL: z.input<typeof createTrialSchema> = {
  title: 'Night Build',
  category: 'build',
  summary: 'Build something that works before sunrise.',
  brief:
    'MISSION\nShip a working tool for a real user before the deadline. Outcomes count, effort does not.',
  rubric: [
    { key: 'shipped', label: 'Working product', weight: 3 },
    { key: 'value', label: 'User value', weight: 1 },
  ],
  facetKeys: ['create.projects'],
  durationMinutes: 120,
  teamSize: 2,
};

export async function members(
  kit: TestKit,
  count: number,
  roles: OrgRole[] = ['trial'],
): Promise<UserActor[]> {
  const out: UserActor[] = [];
  for (let i = 0; i < count; i++) out.push(await kit.member({ roles }));
  return out;
}

/** A recruiting trial with `applicants` applied. */
export async function recruitingTrial(
  kit: TestKit,
  manager: UserActor,
  applicants: readonly UserActor[],
  overrides: Partial<z.input<typeof createTrialSchema>> = {},
): Promise<string> {
  const trial = await createTrial(kit.as(manager), { ...CUSTOM_TRIAL, ...overrides });
  await openRecruitment(kit.as(manager), { trialId: trial.id });
  for (const applicant of applicants)
    await applyToTrial(kit.as(applicant), { trialId: trial.id, statement: STATEMENT });
  return trial.id;
}

/** An active trial: every listed member selected, teams assigned (seeded), clock started. */
export async function runningTrial(
  kit: TestKit,
  manager: UserActor,
  participants: readonly UserActor[],
  overrides: Partial<z.input<typeof createTrialSchema>> = {},
): Promise<{ trialId: string; assignment: AssignmentResult }> {
  const trialId = await recruitingTrial(kit, manager, participants, overrides);
  await selectParticipants(kit.as(manager), {
    trialId,
    mode: 'manual',
    memberIds: participants.map((p) => p.memberId!),
  });
  const assignment = await assignTeams(kit.as(manager), {
    trialId,
    strategy: 'random',
    seed: 'fixture',
  });
  await startTrial(kit.as(manager), { trialId });
  return { trialId, assignment };
}

/**
 * PGlite runs real Postgres compiled to WASM. On the shared, heavily loaded
 * build machine, creating a database alone can exceed the package defaults,
 * so these suites raise their own timeouts — assertions are never weakened.
 */
export const PGLITE_SUITE = { timeout: 240_000 } as const;
export const PGLITE_HOOK_TIMEOUT_MS = 300_000;
