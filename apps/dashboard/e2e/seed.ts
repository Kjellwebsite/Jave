/**
 * End-to-end fixtures — TEST DATA ONLY. Fictional members with claims,
 * verified ranks and history, plus a handful of organization records so every
 * dashboard page has something real to render. Writes go through the core
 * services wherever one exists, so audit, history and events are genuine.
 */
import { eq } from 'drizzle-orm';
import {
  addMemberNote,
  claimRank,
  createContext,
  DAY,
  notify,
  type OrgRole,
  resolveUserActor,
  type ServiceContext,
  setVerifiedRank,
  submitEvidence,
  syncDiscordUser,
  systemActor,
  grantRoleUnchecked,
  withActor,
} from '@jave/core';
import {
  achievementDefinitions,
  applications,
  contributions,
  createDatabase,
  memberAchievements,
  members,
  projectMembers,
  projects,
  securityEvents,
  tickets,
  trialResults,
  trials,
} from '@jave/database';
import { DEV_PERSONAS, provisionDevPersona } from '../server/auth/dev-personas';

interface MemberFixture {
  discordId: string;
  username: string;
  displayName: string;
  headline?: string;
  bio?: string;
  primaryDomain?: 'mind' | 'create' | 'body' | 'life' | 'bio';
  visibility: 'public' | 'members' | 'staff';
  roles: OrgRole[];
  joinedDaysAgo: number;
  guildStatus?: 'present' | 'departed' | 'never_joined';
  standing?: 'good' | 'restricted';
  showClaimsPublicly?: boolean;
  claims?: Record<string, string>;
  verified?: Record<string, string>;
}

export const SHOWCASE_HANDLE = 'mara';
export const GRANT_TARGET_HANDLE = 'jun';
export const RANK_TARGET_HANDLE = 'ilya';

const MEMBERS: readonly MemberFixture[] = [
  {
    discordId: '110000000000000011',
    username: 'mara',
    displayName: 'Mara Voss',
    headline: 'Flight software for small satellites. Ships on schedule.',
    bio: 'Leads the attitude-control stack for a student cubesat programme. Two launches, zero missed windows.',
    primaryDomain: 'create',
    visibility: 'public',
    roles: ['verified'],
    joinedDaysAgo: 240,
    claims: { 'body.physical': 'B', 'bio.optimization': 'B' },
    verified: {
      'mind.reasoning': 'S',
      'mind.research': 'A',
      'create.technical': 'S',
      'create.projects': 'S',
      'life.execution': 'A',
    },
  },
  {
    discordId: '110000000000000012',
    username: 'ilya',
    displayName: 'Ilya Brenner',
    headline: 'Distributed systems. Currently in trial.',
    primaryDomain: 'create',
    visibility: 'members',
    roles: ['trial'],
    joinedDaysAgo: 3,
    claims: { 'create.technical': 'A', 'mind.knowledge': 'B' },
  },
  {
    discordId: '110000000000000013',
    username: 'sana',
    displayName: 'Sana Okafor',
    headline: 'Computational biology. Peer-reviewed at nineteen.',
    primaryDomain: 'mind',
    visibility: 'public',
    roles: ['verified'],
    joinedDaysAgo: 120,
    claims: { 'mind.reasoning': 'A' },
    verified: { 'mind.research': 'A', 'mind.knowledge': 'B', 'bio.optimization': 'B' },
  },
  {
    discordId: '110000000000000014',
    username: 'theo',
    displayName: 'Theo Lindqvist',
    headline: 'Runs trials and evaluations.',
    primaryDomain: 'life',
    visibility: 'members',
    roles: ['operations'],
    joinedDaysAgo: 300,
    verified: { 'life.execution': 'A', 'life.business': 'B' },
  },
  {
    discordId: '110000000000000015',
    username: 'noor',
    displayName: 'Noor Haddad',
    primaryDomain: 'life',
    visibility: 'members',
    roles: ['applicant'],
    joinedDaysAgo: 2,
    claims: { 'life.business': 'B' },
  },
  {
    discordId: '110000000000000016',
    username: 'jun',
    displayName: 'Jun Park',
    headline: 'Track athlete. Learning embedded C.',
    primaryDomain: 'body',
    visibility: 'members',
    roles: [],
    joinedDaysAgo: 5,
    claims: { 'body.physical': 'A' },
  },
  {
    discordId: '110000000000000017',
    username: 'elena',
    displayName: 'Elena Duarte',
    headline: 'Founder, two-person hardware studio.',
    primaryDomain: 'life',
    visibility: 'members',
    roles: ['verified'],
    joinedDaysAgo: 60,
    showClaimsPublicly: false,
    claims: { 'create.creative': 'A' },
    verified: { 'life.business': 'A', 'create.projects': 'B' },
  },
  {
    discordId: '110000000000000018',
    username: 'kasimir',
    displayName: 'Kasimir Wolde',
    visibility: 'members',
    roles: [],
    joinedDaysAgo: 40,
    guildStatus: 'departed',
  },
  {
    discordId: '110000000000000019',
    username: 'ren',
    displayName: 'Ren Takeda',
    headline: 'Keeps the community safe.',
    visibility: 'members',
    roles: ['moderator'],
    joinedDaysAgo: 200,
  },
  {
    discordId: '110000000000000020',
    username: 'ayla',
    displayName: 'Ayla Moreau',
    visibility: 'members',
    roles: [],
    joinedDaysAgo: 15,
    standing: 'restricted',
  },
  {
    discordId: '110000000000000021',
    username: 'priya',
    displayName: 'Priya Raman',
    headline: 'Type designer and illustrator.',
    primaryDomain: 'create',
    visibility: 'public',
    roles: ['verified', 'supporter'],
    joinedDaysAgo: 90,
    verified: { 'create.creative': 'A', 'create.projects': 'C' },
  },
];

const ACHIEVEMENTS = [
  {
    key: 'builder',
    title: 'Builder',
    description: '3 projects shipped.',
    rarity: 'notable' as const,
  },
  {
    key: 'distinction',
    title: 'Distinction',
    description: 'Passed a trial with distinction.',
    rarity: 'rare' as const,
  },
  {
    key: 'singular',
    title: 'Singular',
    description: 'Verified S in two domains.',
    rarity: 'singular' as const,
  },
];

const TRIAL_RUBRIC = [
  { key: 'execution', label: 'Execution', description: 'Delivered what was promised.', weight: 1 },
];

async function asMember(system: ServiceContext, userId: string): Promise<ServiceContext> {
  return withActor(system, await resolveUserActor(system, userId));
}

export async function seedDashboardFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-seed' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-seed') });
  const now = system.clock.now();
  try {
    const personaUsers = new Map<string, string>();
    for (const persona of DEV_PERSONAS) {
      const user = await provisionDevPersona(system, persona);
      personaUsers.set(persona.key, user.id);
    }
    const founder = await asMember(system, personaUsers.get('founder')!);
    const operations = await asMember(system, personaUsers.get('operations')!);

    const memberIds = new Map<string, { memberId: string; userId: string }>();
    for (const fixture of MEMBERS) {
      const { user, member } = await syncDiscordUser(
        system,
        {
          discordId: fixture.discordId,
          username: fixture.username,
          displayName: fixture.displayName,
        },
        { inGuild: fixture.guildStatus !== 'never_joined' },
      );
      memberIds.set(fixture.username, { memberId: member.id, userId: user.id });
      await system.db
        .update(members)
        .set({
          headline: fixture.headline ?? null,
          bio: fixture.bio ?? null,
          primaryDomain: fixture.primaryDomain ?? null,
          profileVisibility: fixture.visibility,
          showClaimsPublicly: fixture.showClaimsPublicly ?? true,
          onboardingState: 'completed',
          standing: fixture.standing ?? 'good',
          guildStatus: fixture.guildStatus ?? 'present',
          joinedGuildAt: new Date(now.getTime() - fixture.joinedDaysAgo * DAY),
          leftGuildAt: fixture.guildStatus === 'departed' ? new Date(now.getTime() - DAY) : null,
        })
        .where(eq(members.id, member.id));
      for (const role of fixture.roles) {
        await grantRoleUnchecked(founder, { memberId: member.id, role, reason: 'e2e fixture' });
      }
      const self = await asMember(system, user.id);
      for (const [facetKey, rank] of Object.entries(fixture.claims ?? {})) {
        await claimRank(self, { facetKey, rank });
      }
      for (const [facetKey, rank] of Object.entries(fixture.verified ?? {})) {
        await claimRank(self, { facetKey, rank });
        await setVerifiedRank(founder, {
          memberId: member.id,
          facetKey,
          rank,
          reason: `Demonstrated ${facetKey.split('.')[1]} at ${rank} level in reviewed work.`,
        });
      }
    }

    const mara = memberIds.get(SHOWCASE_HANDLE)!;
    const maraCtx = await asMember(system, mara.userId);
    await submitEvidence(maraCtx, {
      kind: 'project',
      title: 'Attitude control flight log',
      url: 'https://example.org/flight-log',
      description: 'Telemetry from the second launch.',
      facetKey: 'create.technical',
    });
    await addMemberNote(
      operations,
      memberIds.get(RANK_TARGET_HANDLE)!.memberId,
      'Strong systems instincts. Pair with Mara on the next build trial.',
    );

    const shipped = await system.db
      .insert(projects)
      .values(
        ['Attitude control stack', 'Ground station scheduler', 'Telemetry decoder'].map(
          (title, index) => ({
            slug: `project-${index + 1}`,
            title,
            ownerMemberId: mara.memberId,
            status: 'shipped' as const,
            domainKey: 'create',
            shippedAt: new Date(now.getTime() - (index + 1) * 20 * DAY),
          }),
        ),
      )
      .returning({ id: projects.id });
    await system.db.insert(projects).values({
      slug: 'project-4',
      title: 'Orbit visualiser',
      ownerMemberId: mara.memberId,
      status: 'building',
    });
    await system.db.insert(projectMembers).values(
      shipped.map((project) => ({
        projectId: project.id,
        memberId: mara.memberId,
        role: 'owner' as const,
      })),
    );
    await system.db.insert(contributions).values(
      Array.from({ length: 12 }, (_, index) => ({
        memberId: mara.memberId,
        projectId: shipped[index % shipped.length]!.id,
        kind: 'code' as const,
        title: `Contribution ${index + 1}`,
        status: 'verified' as const,
        verifiedAt: now,
      })),
    );

    const completed = await system.db
      .insert(trials)
      .values(
        ['Cold-start build', 'Adversarial review', 'Incident command'].map((title) => ({
          title,
          category: 'build' as const,
          brief: 'Fixture trial.',
          rubric: TRIAL_RUBRIC,
          status: 'completed' as const,
          durationMinutes: 180,
          completedAt: new Date(now.getTime() - 30 * DAY),
        })),
      )
      .returning({ id: trials.id });
    await system.db.insert(trials).values({
      title: 'Signal under noise',
      category: 'research',
      brief: 'Fixture trial.',
      rubric: TRIAL_RUBRIC,
      status: 'active',
      durationMinutes: 240,
      startedAt: now,
    });
    await system.db.insert(trialResults).values(
      completed.map((trial, index) => ({
        trialId: trial.id,
        memberId: mara.memberId,
        outcome: index === 0 ? ('distinction' as const) : ('pass' as const),
        finalScore: index === 0 ? 9.1 : 7.4,
        publishedAt: new Date(now.getTime() - 29 * DAY),
      })),
    );

    await system.db.insert(achievementDefinitions).values(
      ACHIEVEMENTS.map((achievement, index) => ({
        ...achievement,
        category: 'record',
        criteria: { type: 'manual' as const },
        ordinal: index,
      })),
    );
    await system.db.insert(memberAchievements).values(
      ACHIEVEMENTS.map((achievement) => ({
        memberId: mara.memberId,
        achievementKey: achievement.key,
        verification: 'verified' as const,
        verifiedAt: now,
      })),
    );

    await system.db.insert(applications).values({
      userId: memberIds.get('noor')!.userId,
      status: 'submitted',
      domainKey: 'life',
      motivation: 'Fixture application.',
      submittedAt: now,
    });
    await system.db.insert(tickets).values({
      category: 'general',
      subject: 'Access to the research channel',
      openerUserId: memberIds.get(GRANT_TARGET_HANDLE)!.userId,
    });
    await system.db.insert(securityEvents).values({
      userId: memberIds.get('kasimir')!.userId,
      riskScore: 72,
      trigger: 'spam_rate',
      evidence: { signals: [{ key: 'message_rate', weight: 40, detail: '14 messages in 10s' }] },
    });

    const founderUserId = personaUsers.get('founder')!;
    await notify(system, {
      recipientUserId: founderUserId,
      type: 'security.alert',
      title: 'SECURITY EVENT',
      body: 'Spam-rate trigger on Kasimir Wolde — risk 72. Awaiting triage.',
      dedupeKey: 'e2e:security',
    });
    await notify(system, {
      recipientUserId: founderUserId,
      type: 'application.received',
      title: 'APPLICATION RECEIVED',
      body: 'Noor Haddad applied in LIFE. Needs a first review.',
      url: '/members',
      dedupeKey: 'e2e:application',
    });
    await notify(system, {
      recipientUserId: founderUserId,
      type: 'system.announcement',
      title: 'TRIAL SEASON OPEN',
      body: 'Recruitment for the autumn trials is open until 10 October.',
      dedupeKey: 'e2e:announcement',
    });
  } finally {
    await database.close();
  }
}
