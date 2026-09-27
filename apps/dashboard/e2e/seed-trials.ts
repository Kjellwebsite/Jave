/**
 * End-to-end fixtures for the trials pages — TEST DATA ONLY. Fictional
 * competitors and one trial in every interesting state, all created through
 * the trials and adversarial services (audit, events and notifications are
 * genuine). Discord is not running here: the bot callbacks are invoked with
 * placeholder snowflakes so team channels read as provisioned.
 *
 * Runs after `seedDashboardFixtures` and must not disturb what those tests
 * assert: competitors joined long ago (they sort after the showcase members),
 * every notification this seed raises is marked read, and no rank lands on
 * a facet another suite expects to be empty.
 */
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import {
  adversarial,
  createContext,
  DAY,
  grantRoleUnchecked,
  type OrgRole,
  resolveUserActor,
  type ServiceContext,
  syncDiscordUser,
  systemActor,
  trials,
  updateSettings,
  withActor,
} from '@jave/core';
import {
  adversarialScenarios,
  createDatabase,
  members,
  notifications,
  users,
} from '@jave/database';
import { DEV_PERSONAS } from '../server/auth/dev-personas';

export const TRIAL_FIXTURES = {
  recruiting: 'Orbital Relay',
  evaluating: 'Signal Triage',
  adversarial: 'Red Flag Hunt',
  completed: 'Cold Harbor Entry',
  draft: 'Night Shift Protocol',
  cancelled: 'Lattice Survey',
} as const;

interface Competitor {
  discordId: string;
  username: string;
  displayName: string;
  role: Extract<OrgRole, 'verified' | 'trial'>;
  primaryDomain: 'mind' | 'create' | 'body' | 'life' | 'bio';
}

/** Joined well before every dashboard fixture, so directory ordering is unchanged. */
const COMPETITOR_JOINED_DAYS_AGO = 400;

const COMPETITORS: readonly Competitor[] = [
  {
    discordId: '130000000000000001',
    username: 'ada',
    displayName: 'Ada Kestrel',
    role: 'verified',
    primaryDomain: 'create',
  },
  {
    discordId: '130000000000000002',
    username: 'bram',
    displayName: 'Bram Osei',
    role: 'trial',
    primaryDomain: 'mind',
  },
  {
    discordId: '130000000000000003',
    username: 'cleo',
    displayName: 'Cleo Varga',
    role: 'verified',
    primaryDomain: 'life',
  },
  {
    discordId: '130000000000000004',
    username: 'dario',
    displayName: 'Dario Lunde',
    role: 'trial',
    primaryDomain: 'create',
  },
  {
    discordId: '130000000000000005',
    username: 'esme',
    displayName: 'Esme Quill',
    role: 'trial',
    primaryDomain: 'mind',
  },
  {
    discordId: '130000000000000006',
    username: 'fynn',
    displayName: 'Fynn Adler',
    role: 'verified',
    primaryDomain: 'body',
  },
  {
    discordId: '130000000000000007',
    username: 'greta',
    displayName: 'Greta Solberg',
    role: 'verified',
    primaryDomain: 'mind',
  },
  {
    discordId: '130000000000000008',
    username: 'hugo',
    displayName: 'Hugo Brandt',
    role: 'trial',
    primaryDomain: 'life',
  },
  {
    discordId: '130000000000000009',
    username: 'iris',
    displayName: 'Iris Navarro',
    role: 'verified',
    primaryDomain: 'create',
  },
  {
    discordId: '130000000000000010',
    username: 'jonas',
    displayName: 'Jonas Meyer',
    role: 'trial',
    primaryDomain: 'bio',
  },
];

const STATEMENT =
  'Shipped two production services this year and led the incident review for one of them.';
const BRIEF_PARAGRAPH =
  'Deliver a working result against the stated constraints. Document what you shipped, what you cut and why. Outcomes count; effort does not. AI tools are allowed.';

const FIXTURE_DURATION_MINUTES = 6 * 60;

const CUSTOM_RUBRIC = [
  { key: 'outcome', label: 'Outcome', description: 'Does it work, end to end?', weight: 3 },
  { key: 'judgement', label: 'Judgement', description: 'Right scope for the time.', weight: 2 },
  { key: 'clarity', label: 'Clarity', description: 'Could a stranger run it?', weight: 1 },
];

/** Placeholder snowflakes standing in for the channels the bot would create. */
const FAKE_CHANNEL_BASE = 140_000_000_000_000_000n;

let channelCounter = 0n;
function fakeSnowflake(): string {
  channelCounter += 1n;
  return String(FAKE_CHANNEL_BASE + channelCounter);
}

async function asUser(system: ServiceContext, userId: string): Promise<ServiceContext> {
  return withActor(system, await resolveUserActor(system, userId));
}

async function personaContext(system: ServiceContext, key: string): Promise<ServiceContext> {
  const persona = DEV_PERSONAS.find((candidate) => candidate.key === key);
  if (!persona) throw new Error(`unknown persona ${key}`);
  const [user] = await system.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, persona.discordId));
  if (!user) throw new Error(`persona ${key} is not provisioned`);
  return asUser(system, user.id);
}

interface Seeded {
  memberId: string;
  ctx: ServiceContext;
}

async function seedCompetitors(
  system: ServiceContext,
  granter: ServiceContext,
): Promise<Map<string, Seeded>> {
  const out = new Map<string, Seeded>();
  const joined = new Date(system.clock.now().getTime() - COMPETITOR_JOINED_DAYS_AGO * DAY);
  for (const competitor of COMPETITORS) {
    const { user, member } = await syncDiscordUser(
      system,
      {
        discordId: competitor.discordId,
        username: competitor.username,
        displayName: competitor.displayName,
      },
      { inGuild: true },
    );
    await system.db
      .update(members)
      .set({
        primaryDomain: competitor.primaryDomain,
        profileVisibility: 'members',
        onboardingState: 'completed',
        standing: 'good',
        guildStatus: 'present',
        joinedGuildAt: joined,
      })
      .where(eq(members.id, member.id));
    await grantRoleUnchecked(granter, {
      memberId: member.id,
      role: competitor.role,
      reason: 'e2e trial fixture',
    });
    out.set(competitor.username, { memberId: member.id, ctx: await asUser(system, user.id) });
  }
  return out;
}

function pick(people: Map<string, Seeded>, names: readonly string[]): Seeded[] {
  return names.map((name) => {
    const person = people.get(name);
    if (!person) throw new Error(`unknown competitor ${name}`);
    return person;
  });
}

async function customTrial(
  manager: ServiceContext,
  input: { title: string; category: trials.TrialCategory; summary: string; teamSize: number },
) {
  return trials.createTrial(manager, {
    title: input.title,
    category: input.category,
    summary: input.summary,
    brief: `${BRIEF_PARAGRAPH}\n\n${input.summary}`,
    rubric: CUSTOM_RUBRIC,
    facetKeys: ['create.projects', 'create.technical'],
    durationMinutes: FIXTURE_DURATION_MINUTES,
    teamSize: input.teamSize,
  });
}

async function recruitWith(manager: ServiceContext, trialId: string, applicants: Seeded[]) {
  await trials.openRecruitment(manager, { trialId });
  for (const applicant of applicants)
    await trials.applyToTrial(applicant.ctx, { trialId, statement: STATEMENT });
}

/** Recruit, select everyone, assign seeded teams, provision channels, start. */
async function runningTrial(
  manager: ServiceContext,
  system: ServiceContext,
  trialId: string,
  competitors: Seeded[],
  seed: string,
) {
  await recruitWith(manager, trialId, competitors);
  await trials.selectParticipants(manager, {
    mode: 'manual',
    trialId,
    memberIds: competitors.map((c) => c.memberId),
  });
  const assignment = await trials.assignTeams(manager, { trialId, strategy: 'balanced', seed });
  for (const team of assignment.teams)
    await trials.markTeamProvisioned(system, { teamId: team.id, channelId: fakeSnowflake() });
  await trials.startTrial(manager, { trialId });
  for (const team of assignment.teams) await trials.markTeamBriefed(system, { teamId: team.id });
  return assignment;
}

function memberOf(team: trials.AssignmentResult['teams'][number], people: Seeded[]): Seeded {
  const member = people.find((person) => team.memberIds.includes(person.memberId));
  if (!member) throw new Error('team without a seeded member');
  return member;
}

async function submitFor(member: Seeded, trialId: string, summary: string, links: string[] = []) {
  await trials.submit(member.ctx, { trialId, summary, links });
}

export async function seedTrialFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-trials' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-seed-trials') });
  try {
    const before = await system.db.select({ id: notifications.id }).from(notifications);
    const founder = await personaContext(system, 'founder');
    const core = await personaContext(system, 'core');
    const operations = await personaContext(system, 'operations');
    await updateSettings(founder, 'trials', { adversarialEnabled: true });
    const people = await seedCompetitors(system, founder);
    await trials.seedStarterTemplates(operations);
    await adversarial.seedStarterScenarios(core);

    // Recruiting: six applicants, four of them selected; no teams yet.
    const recruiting = await customTrial(operations, {
      title: TRIAL_FIXTURES.recruiting,
      category: 'build',
      summary: 'Build a relay that survives a lossy uplink. Teams of two, six hours.',
      teamSize: 2,
    });
    await recruitWith(
      operations,
      recruiting.id,
      pick(people, ['ada', 'bram', 'cleo', 'dario', 'esme', 'fynn']),
    );
    await trials.selectParticipants(operations, {
      mode: 'manual',
      trialId: recruiting.id,
      memberIds: pick(people, ['ada', 'bram', 'cleo', 'dario']).map((p) => p.memberId),
    });

    // Evaluating: two teams submitted (one twice), nothing scored yet.
    const evaluatingPeople = pick(people, ['greta', 'hugo', 'iris', 'jonas']);
    const evaluating = await customTrial(operations, {
      title: TRIAL_FIXTURES.evaluating,
      category: 'research',
      summary: 'Separate signal from noise in a fictional incident dataset. Teams of two.',
      teamSize: 2,
    });
    const evaluatingTeams = await runningTrial(
      operations,
      system,
      evaluating.id,
      evaluatingPeople,
      'e2e-signal',
    );
    const [firstTeam, secondTeam] = evaluatingTeams.teams;
    await submitFor(
      memberOf(firstTeam!, evaluatingPeople),
      evaluating.id,
      'First cut: triage pipeline with a ranked list of 14 candidate signals.',
    );
    await submitFor(
      memberOf(firstTeam!, evaluatingPeople),
      evaluating.id,
      'Final: 6 confirmed signals, false-positive rate measured at 4%, runbook attached.',
      ['https://example.org/signal-triage/report'],
    );
    await submitFor(
      memberOf(secondTeam!, evaluatingPeople),
      evaluating.id,
      'Heuristic filter with manual review notes; 3 signals confirmed.',
    );
    await trials.closeSubmissions(operations, { trialId: evaluating.id });

    // Active with a hidden role (staff-only): planned by CORE, awaiting a second person.
    const templates = await trials.listTemplates(operations);
    const redFlag = templates.find((template) => template.key === 'security-red-flag-hunt');
    if (!redFlag) throw new Error('starter template missing');
    const activePeople = pick(people, ['ada', 'bram', 'cleo', 'dario']);
    const active = await trials.createTrial(core, {
      templateId: redFlag.id,
      title: TRIAL_FIXTURES.adversarial,
      teamSize: 2,
      adversarialEnabled: true,
    });
    const activeTeams = await runningTrial(core, system, active.id, activePeople, 'e2e-redflag');
    // The operative must be VERIFIED (or staff) and selected on the team.
    const operative = people.get('ada')!;
    const operativeTeam = activeTeams.teams.find((team) =>
      team.memberIds.includes(operative.memberId),
    )!;
    await submitFor(
      memberOf(operativeTeam, activePeople),
      active.id,
      'Two findings so far: an exposed debug route and a stale sandbox token in the fixture repo.',
    );
    const [scenario] = await system.db
      .select({ id: adversarialScenarios.id })
      .from(adversarialScenarios)
      .where(eq(adversarialScenarios.key, 'urgent-token-request'));
    const role = await adversarial.planRole(core, {
      trialId: active.id,
      teamId: operativeTeam.id,
      operativeMemberId: operative.memberId,
      scenarioId: scenario!.id,
    });
    await adversarial.addTrigger(core, {
      roleId: role.id,
      label: 'Urgent request',
      description: 'Post the fictional urgent token request from the scenario in the team channel.',
    });

    // Completed: published results; one rank consequence applied, one pending.
    const completedPeople = pick(people, ['greta', 'hugo', 'esme', 'fynn']);
    const completed = await customTrial(operations, {
      title: TRIAL_FIXTURES.completed,
      category: 'strategy',
      summary: 'A market-entry brief for a fictional sensor company. Teams of two.',
      teamSize: 2,
    });
    await trials.updateTrial(operations, {
      trialId: completed.id,
      facetKeys: ['life.business', 'mind.reasoning'],
    });
    const completedTeams = await runningTrial(
      operations,
      system,
      completed.id,
      completedPeople,
      'e2e-harbor',
    );
    const scores = [
      { outcome: 9, judgement: 8, clarity: 8 },
      { outcome: 5, judgement: 6, clarity: 7 },
    ];
    for (const team of completedTeams.teams)
      await submitFor(
        memberOf(team, completedPeople),
        completed.id,
        'Entry brief: segment sizing, channel test plan and a go / no-go recommendation.',
      );
    await trials.closeSubmissions(operations, { trialId: completed.id });
    for (const [index, team] of completedTeams.teams.entries())
      await trials.evaluate(operations, {
        trialId: completed.id,
        teamId: team.id,
        scores: scores[index]!,
        notes: 'Scored against the published rubric.',
      });
    await trials.publishResults(operations, { trialId: completed.id });
    // The first passing competitor gets the consequence; the teammate's stays pending.
    const [firstWinner] = completedTeams.teams[0]!.memberIds;
    await trials.applyRankConsequence(core, {
      trialId: completed.id,
      memberId: firstWinner!,
      reason: 'Published trial result, primary facet.',
    });

    // Draft and cancelled, for the list.
    await customTrial(operations, {
      title: TRIAL_FIXTURES.draft,
      category: 'crisis',
      summary: 'Hold a failing service together through a simulated night shift.',
      teamSize: 3,
    });
    const cancelled = await customTrial(operations, {
      title: TRIAL_FIXTURES.cancelled,
      category: 'investigation',
      summary: 'Survey a lattice of fictional sensors for tampering. Teams of three.',
      teamSize: 3,
    });
    await trials.openRecruitment(operations, { trialId: cancelled.id });
    await trials.cancelTrial(operations, {
      trialId: cancelled.id,
      reason: 'Sensor dataset withdrawn by its owner; rescheduled for next season.',
    });

    // Fixture notifications are history, not news: the dashboard suites count unread items.
    const seen = before.map((row) => row.id);
    await system.db
      .update(notifications)
      .set({ readAt: system.clock.now() })
      .where(
        and(
          isNull(notifications.readAt),
          seen.length > 0 ? notInArray(notifications.id, seen) : undefined,
        ),
      );
  } finally {
    await database.close();
  }
}
