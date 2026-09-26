/**
 * TEST FIXTURES ONLY — builders for the trials/adversarial bot tests. Every
 * trial is created and driven through the real core services, so audit,
 * jobs and notifications are genuine.
 */
import type { z } from 'zod';
import { type ServiceContext, trials, type UserActor, updateSettings } from '@jave/core';
import type { OrgRole } from '@jave/core';
import type { InteractionUser } from '../../interactions/types';
import type { FakeInteraction } from '../../testing/fake-interaction';
import type { BotHarness } from '../../testing/harness';

export const TRIALS_CATEGORY = '910000000000000100';
export const ANNOUNCEMENTS_CHANNEL = '910000000000000200';
export const OPERATIONS_ROLE = '910000000000000300';
export const CORE_ROLE = '910000000000000301';

/** PGlite per test on a shared machine: generous, never weaker assertions. */
export const SUITE = { timeout: 240_000 } as const;
export const HOOK_TIMEOUT_MS = 300_000;

export const STATEMENT = 'I ship working tools under pressure and want it verified here.';
export const SUBMISSION = 'Shipped the scheduler; three pilot users ran it end to end tonight.';

export const TRIAL_INPUT: z.input<typeof trials.createTrialSchema> = {
  title: 'Night Build',
  category: 'build',
  summary: 'Build something that works before sunrise. Outcomes count.',
  brief:
    'MISSION\nShip a working tool for a real user before the deadline. Outcomes count, effort does not.',
  rubric: [
    { key: 'shipped', label: 'Working product', weight: 3, description: 'Runs end to end.' },
    { key: 'value', label: 'User value', weight: 1 },
  ],
  facetKeys: ['create.projects'],
  durationMinutes: 120,
  teamSize: 2,
};

export interface Person {
  actor: UserActor;
  user: InteractionUser;
}

export async function configureDiscord(bot: BotHarness): Promise<void> {
  await updateSettings(bot.kit.system, 'channels', {
    trialsCategory: TRIALS_CATEGORY,
    announcements: ANNOUNCEMENTS_CHANNEL,
  });
  await updateSettings(bot.kit.system, 'roles', {
    discordRoleIds: { operations: OPERATIONS_ROLE, core: CORE_ROLE },
  });
}

export async function people(bot: BotHarness, count: number, roles: OrgRole[] = ['trial']) {
  const out: Person[] = [];
  for (let i = 0; i < count; i++) out.push(await bot.member({ roles }));
  return out;
}

export function as(bot: BotHarness, person: Person): ServiceContext {
  return bot.kit.as(person.actor);
}

export async function draftTrial(
  bot: BotHarness,
  manager: Person,
  overrides: Partial<z.input<typeof trials.createTrialSchema>> = {},
): Promise<string> {
  const trial = await trials.createTrial(as(bot, manager), { ...TRIAL_INPUT, ...overrides });
  return trial.id;
}

/** A recruiting trial with every listed person applied. */
export async function recruitingTrial(
  bot: BotHarness,
  manager: Person,
  applicants: readonly Person[],
  overrides: Partial<z.input<typeof trials.createTrialSchema>> = {},
): Promise<string> {
  const trialId = await draftTrial(bot, manager, overrides);
  await trials.openRecruitment(as(bot, manager), { trialId });
  for (const applicant of applicants)
    await trials.applyToTrial(as(bot, applicant), { trialId, statement: STATEMENT });
  return trialId;
}

/** Selected and assigned (seeded), not started. */
export async function assignedTrial(
  bot: BotHarness,
  manager: Person,
  participants: readonly Person[],
  overrides: Partial<z.input<typeof trials.createTrialSchema>> = {},
): Promise<{ trialId: string; assignment: trials.AssignmentResult }> {
  const trialId = await recruitingTrial(bot, manager, participants, overrides);
  await trials.selectParticipants(as(bot, manager), {
    trialId,
    mode: 'manual',
    memberIds: participants.map((p) => p.actor.memberId!),
  });
  const assignment = await trials.assignTeams(as(bot, manager), {
    trialId,
    strategy: 'random',
    seed: 'fixture',
  });
  return { trialId, assignment };
}

export async function activeTrial(
  bot: BotHarness,
  manager: Person,
  participants: readonly Person[],
  overrides: Partial<z.input<typeof trials.createTrialSchema>> = {},
) {
  const assigned = await assignedTrial(bot, manager, participants, overrides);
  await trials.startTrial(as(bot, manager), { trialId: assigned.trialId });
  return assigned;
}

/** Every text of every embed a message or reply carried — for leak assertions. */
export function allText(payloads: readonly { embeds?: unknown; components?: unknown; content?: string }[]) {
  return JSON.stringify(payloads);
}

/** The last reply-like payload of an interaction, as text (title, description, fields). */
export function replyText(interaction: FakeInteraction): string {
  return interaction.lastText();
}

/** Every payload an interaction produced (replies, follow-ups, updates, modals). */
export function everything(interaction: FakeInteraction): string {
  return JSON.stringify(interaction.responses);
}
