import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  achievementDefinitions,
  applications,
  events,
  memberAchievements,
  memberCapabilities,
  memberRoles,
  members,
  missionAssignments,
  missions,
  modCases,
  notifications,
  projects,
  rankHistory,
  rankTiers,
  researchItems,
  securityEvents,
  ticketMessages,
  tickets,
  tournamentMatches,
  trialParticipants,
  trialResults,
  trials,
  trialTeams,
  users,
  verifications,
} from '@jave/database';
import { createTestDatabase, type TestDatabase } from '@jave/database/testing';
import { STARTER_ACHIEVEMENTS } from '../achievements';
import { PROGRESSION_ROLES } from '../permissions/roles';
import {
  CAST,
  type CastKey,
  castMember,
  existingMemberCount,
  javeTables,
  PERSONA_KEYS,
  resetDatabase,
  SeedRefusedError,
  seedDevelopmentData,
  type SeedReport,
  writeTimesAfter,
} from './index';

/**
 * The whole development seed against a fresh database. One run feeds every
 * assertion: it replays ~150 days through the real services and job queue,
 * which takes a while on PGlite under load.
 */
const SEED_TIMEOUT_MS = 900_000;
const ANCHOR = new Date('2026-03-01T12:00:00.000Z');

/** The dashboard's dev-login personas (apps/dashboard/server/auth/dev-personas.ts). */
const DEV_LOGIN_PERSONAS = [
  { discordId: '100000000000000001', username: 'dev_founder', role: 'founder' },
  { discordId: '100000000000000002', username: 'dev_core', role: 'core' },
  { discordId: '100000000000000003', username: 'dev_operations', role: 'operations' },
  { discordId: '100000000000000004', username: 'dev_moderator', role: 'moderator' },
  { discordId: '100000000000000005', username: 'dev_verified', role: 'verified' },
  { discordId: '100000000000000006', username: 'dev_member', role: 'member' },
] as const;

describe('development seed', () => {
  let database: TestDatabase;
  let report: SeedReport;

  beforeAll(async () => {
    database = await createTestDatabase();
    report = await seedDevelopmentData(database.db, { anchor: ANCHOR });
  }, SEED_TIMEOUT_MS);
  afterAll(async () => {
    await database?.close();
  });

  const db = () => database.db;

  async function memberOf(discordId: string) {
    const [row] = await db()
      .select({ member: members, user: users })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(users.discordId, discordId));
    return row!;
  }

  async function rolesOf(memberId: string): Promise<string[]> {
    const rows = await db()
      .select({ role: memberRoles.role })
      .from(memberRoles)
      .where(and(eq(memberRoles.memberId, memberId), isNull(memberRoles.revokedAt)));
    return rows.map((row) => row.role).sort();
  }

  it('completes with every background job healthy', () => {
    expect(report.jobFailures).toEqual([]);
    expect(report.anchor).toEqual(ANCHOR);
  });

  it('builds an organization of realistic size', () => {
    const { counts } = report;
    expect(counts.members).toBeGreaterThanOrEqual(25);
    expect(counts.members).toBeLessThanOrEqual(30);
    expect(counts.applications).toBeGreaterThanOrEqual(10);
    expect(counts.trials).toBeGreaterThanOrEqual(2);
    expect(counts.trialResults).toBeGreaterThan(0);
    expect(counts.projects).toBeGreaterThanOrEqual(6);
    expect(counts.contributions).toBeGreaterThan(0);
    expect(counts.eventRsvps).toBeGreaterThan(10);
    expect(counts.tournamentMatches).toBeGreaterThan(0);
    expect(counts.ticketMessages).toBeGreaterThan(counts.tickets);
    expect(counts.modCases).toBeGreaterThan(0);
    expect(counts.securityEvents).toBeGreaterThan(0);
    expect(counts.researchItems).toBeGreaterThan(0);
    expect(counts.notifications).toBeGreaterThan(50);
    expect(counts.rankHistory).toBeGreaterThan(counts.members);
  });

  it('seeds the dev-login personas with their roles, so dev login lands in the organization', async () => {
    for (const persona of DEV_LOGIN_PERSONAS) {
      const { member, user } = await memberOf(persona.discordId);
      expect(user.username).toBe(persona.username);
      expect(member.guildStatus).toBe('present');
      expect(member.onboardingState).toBe('completed');
      expect(await rolesOf(member.id)).toContain(persona.role);
    }
    expect(PERSONA_KEYS.map((key) => castMember(key).discordId)).toEqual(
      DEV_LOGIN_PERSONAS.map((persona) => persona.discordId),
    );
  });

  it('covers every role, with progression roles mutually exclusive', async () => {
    const held = await db()
      .select({ memberId: memberRoles.memberId, role: memberRoles.role })
      .from(memberRoles)
      .where(isNull(memberRoles.revokedAt));
    const roles = new Set(held.map((row) => row.role));
    for (const role of [
      'founder',
      'core',
      'operations',
      'moderator',
      'verified',
      'trial',
      'applicant',
      'member',
      'supporter',
    ]) {
      expect(roles, role).toContain(role);
    }
    const progression = new Map<string, number>();
    for (const row of held) {
      if (!PROGRESSION_ROLES.includes(row.role)) continue;
      progression.set(row.memberId, (progression.get(row.memberId) ?? 0) + 1);
    }
    expect(Math.max(...progression.values())).toBe(1);
  });

  it('holds claimed and verified capabilities, and nobody verified their own rank', async () => {
    const [claimed] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(memberCapabilities)
      .where(isNotNull(memberCapabilities.claimedRank));
    const [verified] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(memberCapabilities)
      .where(isNotNull(memberCapabilities.verifiedRank));
    expect(claimed!.count).toBeGreaterThan(20);
    expect(verified!.count).toBeGreaterThan(10);

    const selfVerified = await db()
      .select({ id: rankHistory.id })
      .from(rankHistory)
      .innerJoin(members, eq(members.id, rankHistory.memberId))
      .where(and(eq(rankHistory.track, 'verified'), eq(rankHistory.actorUserId, members.userId)));
    expect(selfVerified).toEqual([]);
    const sources = await db()
      .selectDistinct({ source: rankHistory.source })
      .from(rankHistory)
      .where(eq(rankHistory.track, 'verified'));
    expect(sources.map((row) => row.source).sort()).toEqual(
      expect.arrayContaining(['evaluator', 'trial', 'verification']),
    );
  });

  it('has applications in every state, the member persona holding a draft', async () => {
    const rows = await db().select({ status: applications.status }).from(applications);
    const statuses = new Set(rows.map((row) => row.status));
    for (const status of [
      'draft',
      'submitted',
      'review',
      'interview',
      'accepted',
      'rejected',
      'withdrawn',
    ] as const) {
      expect(statuses, status).toContain(status);
    }
    const { user } = await memberOf(castMember('member').discordId);
    const [draft] = await db()
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.userId, user.id));
    expect(draft!.status).toBe('draft');
  });

  it('has a completed trial with results and consequences, an active one and a recruiting one', async () => {
    const rows = await db().select({ id: trials.id, status: trials.status }).from(trials);
    expect(rows.map((row) => row.status).sort()).toEqual(['active', 'completed', 'recruiting']);
    const completed = rows.find((row) => row.status === 'completed')!;
    const results = await db()
      .select()
      .from(trialResults)
      .where(eq(trialResults.trialId, completed.id));
    const outcomeOf = async (key: CastKey) => {
      const { member } = await memberOf(castMember(key).discordId);
      return results.find((result) => result.memberId === member.id)?.outcome;
    };
    expect(await outcomeOf('ilya')).toBe('distinction');
    for (const key of ['verified', 'noor', 'leo'] as const)
      expect(await outcomeOf(key)).toBe('pass');
    expect(await outcomeOf('priya')).toBe('fail');
    const passing = results.filter((r) => r.outcome === 'pass' || r.outcome === 'distinction');
    for (const result of passing) expect(result.rankHistoryId).not.toBeNull();
    const ilya = await memberOf(castMember('ilya').discordId);
    expect(await rolesOf(ilya.member.id)).toContain('verified');
    const priya = await memberOf(castMember('priya').discordId);
    expect(await rolesOf(priya.member.id)).toContain('trial');
  });

  it('deals the same rosters on every run', async () => {
    const rosterOf = async (status: 'completed' | 'active') => {
      const [trial] = await db()
        .select({ id: trials.id })
        .from(trials)
        .where(eq(trials.status, status));
      const rows = await db()
        .select({
          ordinal: trialTeams.ordinal,
          role: trialParticipants.teamRole,
          username: users.username,
        })
        .from(trialParticipants)
        .innerJoin(trialTeams, eq(trialTeams.id, trialParticipants.teamId))
        .innerJoin(members, eq(members.id, trialParticipants.memberId))
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(trialParticipants.trialId, trial!.id));
      const teams = new Map<number, { lead: string; members: string[] }>();
      for (const row of rows) {
        const team = teams.get(row.ordinal) ?? { lead: '', members: [] };
        if (row.role === 'lead') team.lead = row.username;
        team.members.push(row.username);
        teams.set(row.ordinal, team);
      }
      return [...teams.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, team]) => ({ lead: team.lead, members: team.members.sort() }));
    };
    expect(await rosterOf('completed')).toEqual([
      { lead: 'ilya', members: ['dev_verified', 'ilya', 'priya'] },
      { lead: 'leo', members: ['leo', 'noor'] },
    ]);
    expect(await rosterOf('active')).toEqual([
      { lead: 'jun', members: ['elif', 'jun'] },
      { lead: 'mateo', members: ['mateo', 'priya'] },
    ]);
  });

  it('has missions and projects in every state', async () => {
    const missionRows = await db().select({ status: missions.status }).from(missions);
    expect(new Set(missionRows.map((row) => row.status))).toEqual(
      new Set(['draft', 'open', 'closed']),
    );
    const assignmentRows = await db()
      .select({ status: missionAssignments.status })
      .from(missionAssignments);
    expect(new Set(assignmentRows.map((row) => row.status))).toEqual(
      new Set(['assigned', 'accepted', 'submitted', 'verified']),
    );
    const projectRows = await db().select({ status: projects.status }).from(projects);
    expect(new Set(projectRows.map((row) => row.status))).toEqual(
      new Set(['idea', 'planning', 'building', 'testing', 'shipped', 'archived']),
    );
  });

  it('has past and upcoming events and a tournament played to a champion', async () => {
    const rows = await db().select().from(events);
    expect(rows.filter((row) => row.startsAt < ANCHOR).map((row) => row.status)).toEqual(
      expect.arrayContaining(['completed']),
    );
    expect(rows.filter((row) => row.startsAt > ANCHOR).length).toBeGreaterThanOrEqual(2);
    const tournament = rows.find((row) => row.kind === 'tournament')!;
    expect(tournament.status).toBe('completed');
    const matches = await db()
      .select({ status: tournamentMatches.status })
      .from(tournamentMatches)
      .where(eq(tournamentMatches.eventId, tournament.id));
    expect(matches.every((match) => match.status === 'completed' || match.status === 'bye')).toBe(
      true,
    );
  });

  it('has tickets open, claimed, waiting and closed, with messages and internal notes', async () => {
    const rows = await db().select({ id: tickets.id, status: tickets.status }).from(tickets);
    expect(new Set(rows.map((row) => row.status))).toEqual(
      new Set(['open', 'claimed', 'waiting', 'closed']),
    );
    const internal = await db()
      .select({ id: ticketMessages.id })
      .from(ticketMessages)
      .where(eq(ticketMessages.isInternal, true));
    expect(internal.length).toBeGreaterThan(0);
  });

  it('records moderation: a quarantined member, cases applied, security events triaged and open', async () => {
    const ben = await memberOf(castMember('ben').discordId);
    expect(ben.member.standing).toBe('quarantined');
    const cases = await db().select().from(modCases);
    expect(cases.some((row) => row.revokedAt !== null)).toBe(true);
    expect(cases.filter((row) => row.discordSync === 'pending')).toEqual([]);
    const statuses = new Set(
      (await db().select({ status: securityEvents.status }).from(securityEvents)).map(
        (row) => row.status,
      ),
    );
    expect(statuses).toContain('open');
    expect(statuses).toContain('actioned');
  });

  it('seeds the starter achievements and unlocks them from real outcomes', async () => {
    const definitions = await db()
      .select({ key: achievementDefinitions.key })
      .from(achievementDefinitions);
    expect(definitions.map((row) => row.key)).toEqual(
      expect.arrayContaining(STARTER_ACHIEVEMENTS.map((starter) => starter.key)),
    );
    const mara = await memberOf(castMember('mara').discordId);
    const held = await db()
      .select({ key: memberAchievements.achievementKey })
      .from(memberAchievements)
      .where(eq(memberAchievements.memberId, mara.member.id));
    expect(held.map((row) => row.key)).toEqual(
      expect.arrayContaining(['builder', 'project_shipped', 'team_leader']),
    );
  });

  it('fills the library and the verification queue', async () => {
    const research = await db().select({ status: researchItems.status }).from(researchItems);
    expect(new Set(research.map((row) => row.status))).toEqual(
      new Set(['needs_review', 'reviewed', 'verified']),
    );
    const requests = await db().select({ status: verifications.status }).from(verifications);
    expect(requests.map((row) => row.status).sort()).toEqual(['approved', 'pending']);
  });

  it('leaves recent notifications unread and older ones read', async () => {
    const founder = await memberOf(castMember('founder').discordId);
    const inbox = await db()
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.recipientUserId, founder.user.id));
    expect(inbox.some((row) => row.readAt !== null)).toBe(true);
    expect(inbox.some((row) => row.readAt === null)).toBe(true);
  });

  it('dates everything at or before the anchor, from the story clock', async () => {
    expect(await writeTimesAfter(db(), ANCHOR)).toEqual([]);
    const cast = await db()
      .select({ createdAt: members.createdAt, joinedAt: members.joinedGuildAt })
      .from(members);
    for (const row of cast) expect(row.createdAt).toEqual(row.joinedAt);
    const founder = await memberOf(castMember('founder').discordId);
    expect(founder.member.joinedGuildAt!.getTime()).toBeLessThan(ANCHOR.getTime());
    expect(CAST.every((member) => member.joinedDaysAgo >= 1)).toBe(true);
  });

  it('refuses to seed an organization twice', async () => {
    await expect(seedDevelopmentData(database.db, { anchor: ANCHOR })).rejects.toBeInstanceOf(
      SeedRefusedError,
    );
  });

  it(
    'resets to an empty organization with its reference data, and replays the same story',
    async () => {
      const tables = await resetDatabase(db());
      expect(tables).toBe(javeTables().length);
      expect(await existingMemberCount(db())).toBe(0);
      const [tiers] = await db()
        .select({ count: sql<number>`count(*)::int` })
        .from(rankTiers);
      expect(tiers!.count).toBeGreaterThan(0);

      const replay = await seedDevelopmentData(db(), { anchor: ANCHOR });
      expect(replay.jobFailures).toEqual([]);
      expect(replay.counts).toEqual(report.counts);
    },
    SEED_TIMEOUT_MS,
  );
});
