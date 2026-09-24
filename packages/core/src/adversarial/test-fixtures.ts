import { eq } from 'drizzle-orm';
import {
  adversarialScenarios,
  trialParticipants,
  trials,
  trialTeams,
  trialTemplates,
} from '@jave/database';
import type { Database } from '@jave/database';
import { HOUR } from '../kernel/clock';
import type { ServiceContext } from '../kernel/context';
import type { UserActor } from '../permissions/actor';
import type { OrgRole } from '../permissions/roles';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import { authorizeRole, activateRole, briefRole, planRole } from './roles.service';
import { seedStarterScenarios } from './scenarios.service';
import type { RoleRecord, TrialStatus } from './state';

/**
 * Test fixtures: a trial built with direct inserts into the trials schema
 * (the trials module is developed separately), two teams, staff actors and
 * participants. For tests only.
 */

/**
 * Integration tests run real Postgres (PGlite) per test on a machine shared by
 * many engineers; under heavy load a full lifecycle exceeds the 20 s default.
 */
export const INTEGRATION_TIMEOUT_MS = 180_000;

export const TEAM_A_CHANNEL = '300000000000000001';
export const TEAM_B_CHANNEL = '300000000000000002';

export interface FixtureOptions {
  trialStatus?: TrialStatus;
  trialAdversarialEnabled?: boolean;
  killSwitch?: boolean;
  template?: 'allows' | 'forbids' | 'none';
  deadlineAt?: Date | null;
  operativeRoles?: OrgRole[];
}

export interface AdversarialFixture {
  kit: TestKit;
  founder: UserActor;
  planner: UserActor;
  authorizer: UserActor;
  operations: UserActor;
  moderator: UserActor;
  operative: UserActor;
  teammates: UserActor[];
  otherTeamMember: UserActor;
  trialId: string;
  trialNumber: number;
  teamAId: string;
  teamBId: string;
  scenarioId: string;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture: missing ${what}`);
  return value;
}

async function addParticipant(
  kit: TestKit,
  input: { trialId: string; teamId: string; roles: OrgRole[] },
): Promise<UserActor> {
  const actor = await kit.member({ roles: input.roles });
  await kit.db.insert(trialParticipants).values({
    trialId: input.trialId,
    memberId: required(actor.memberId ?? undefined, 'memberId'),
    status: 'selected',
    teamId: input.teamId,
    teamRole: 'member',
    selectedAt: kit.clock.now(),
  });
  return actor;
}

export async function setupAdversarial(
  kit: TestKit,
  options: FixtureOptions = {},
): Promise<AdversarialFixture> {
  const founder = await kit.member({ roles: ['founder'] });
  const planner = await kit.member({ roles: ['core'] });
  const authorizer = await kit.member({ roles: ['core'] });
  const operations = await kit.member({ roles: ['operations'] });
  const moderator = await kit.member({ roles: ['moderator'] });

  if (options.killSwitch ?? true)
    await updateSettings(kit.as(founder), 'trials', { adversarialEnabled: true });

  let templateId: string | null = null;
  if (options.template && options.template !== 'none') {
    const [template] = await kit.db
      .insert(trialTemplates)
      .values({
        key: `template-${options.template}`,
        title: 'Security sprint',
        category: 'security',
        summary: 'A timed security sprint.',
        brief: 'Build and defend.',
        durationMinutes: 120,
        rubric: [],
        allowsAdversarial: options.template === 'allows',
      })
      .returning({ id: trialTemplates.id });
    templateId = required(template, 'template').id;
  }

  const now = kit.clock.now();
  const [trial] = await kit.db
    .insert(trials)
    .values({
      templateId,
      title: 'Security sprint',
      category: 'security',
      brief: 'Ship a small service in the sandbox.',
      rubric: [],
      status: options.trialStatus ?? 'active',
      durationMinutes: 240,
      adversarialEnabled: options.trialAdversarialEnabled ?? true,
      startedAt: now,
      deadlineAt:
        options.deadlineAt === undefined ? new Date(now.getTime() + 4 * HOUR) : options.deadlineAt,
    })
    .returning({ id: trials.id, number: trials.number });
  const { id: trialId, number: trialNumber } = required(trial, 'trial');

  const [teamA, teamB] = await kit.db
    .insert(trialTeams)
    .values([
      { trialId, name: 'Team A', ordinal: 1, discordChannelId: TEAM_A_CHANNEL },
      { trialId, name: 'Team B', ordinal: 2, discordChannelId: TEAM_B_CHANNEL },
    ])
    .returning({ id: trialTeams.id });
  const teamAId = required(teamA, 'team A').id;
  const teamBId = required(teamB, 'team B').id;

  const operative = await addParticipant(kit, {
    trialId,
    teamId: teamAId,
    roles: options.operativeRoles ?? ['verified'],
  });
  const teammates = [
    await addParticipant(kit, { trialId, teamId: teamAId, roles: ['verified'] }),
    await addParticipant(kit, { trialId, teamId: teamAId, roles: ['trial'] }),
  ];
  const otherTeamMember = await addParticipant(kit, {
    trialId,
    teamId: teamBId,
    roles: ['verified'],
  });

  await seedStarterScenarios(kit.system);
  const [scenario] = await kit.db
    .select({ id: adversarialScenarios.id })
    .from(adversarialScenarios)
    .where(eq(adversarialScenarios.key, 'urgent-token-request'));

  return {
    kit,
    founder,
    planner,
    authorizer,
    operations,
    moderator,
    operative,
    teammates,
    otherTeamMember,
    trialId,
    trialNumber,
    teamAId,
    teamBId,
    scenarioId: required(scenario, 'scenario').id,
  };
}

export function memberIdOf(actor: UserActor): string {
  return required(actor.memberId ?? undefined, 'memberId');
}

export async function planDefault(fx: AdversarialFixture): Promise<RoleRecord> {
  return planRole(fx.kit.as(fx.planner), {
    trialId: fx.trialId,
    teamId: fx.teamAId,
    operativeMemberId: memberIdOf(fx.operative),
    scenarioId: fx.scenarioId,
  });
}

/** plan → authorize → brief → activate. */
export async function runToActive(fx: AdversarialFixture): Promise<RoleRecord> {
  const planned = await planDefault(fx);
  await authorizeRole(fx.kit.as(fx.authorizer), { roleId: planned.id, sandboxAttested: true });
  await briefRole(fx.kit.as(fx.planner), { roleId: planned.id });
  return activateRole(fx.kit.as(fx.planner), { roleId: planned.id });
}

/**
 * Deterministic race: `interloper` runs to completion right before `ctx` opens
 * its first transaction — the window between a service's pre-checks and its
 * writes. (PGlite serializes transactions, so Promise.all alone rarely hits it.)
 */
export function interleaveBeforeTransaction(
  ctx: ServiceContext,
  interloper: () => Promise<unknown>,
): ServiceContext {
  let fired = false;
  const db = new Proxy(ctx.db, {
    get(target, property, receiver) {
      if (property !== 'transaction' || fired) return Reflect.get(target, property, receiver);
      const transaction = target.transaction.bind(target);
      return async (...args: Parameters<Database['transaction']>) => {
        fired = true;
        await interloper();
        return transaction(...args);
      };
    },
  });
  return { ...ctx, db };
}

export async function setTrialStatus(
  kit: TestKit,
  trialId: string,
  status: TrialStatus,
): Promise<void> {
  const now = kit.clock.now();
  await kit.db
    .update(trials)
    .set({
      status,
      ...(status === 'evaluating' ? { submissionsClosedAt: now } : {}),
      ...(status === 'completed' ? { completedAt: now } : {}),
      ...(status === 'cancelled' ? { cancelledAt: now } : {}),
    })
    .where(eq(trials.id, trialId));
}
