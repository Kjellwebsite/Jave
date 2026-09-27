/**
 * End-to-end fixtures for referrals and analytics — TEST DATA ONLY.
 * Fictional joiners over the last six weeks, mirrored invites, campaigns and
 * referrals in every lifecycle state, then daily analytics snapshots.
 *
 * Invites, campaigns, attributions, code claims and snapshots go through the
 * core services. Two things cannot, on a real clock, and are written
 * directly: lifecycle states that take days to earn (RETAINED, VALID, LEFT,
 * flags), and the members.present gauge for past days (the snapshot job only
 * records gauges for yesterday; history is reconstructed from the fixtures'
 * own join/leave times).
 *
 * The invitees keep staff-only profiles. The seed is shared by every spec,
 * and the member directory lists the newest joiners first: visible to members,
 * these recent joins would push the base fixtures other specs page through as
 * a member off the first page. Staff, the only audience of the referral and
 * analytics pages, see them all. No invitee name contains a token other specs
 * search for (Sol, Mara, Voss, Jun).
 */
import { eq, inArray } from 'drizzle-orm';
import {
  analytics,
  createContext,
  DAY,
  ensureMember,
  HOUR,
  invites,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  upsertDiscordUser,
  withActor,
} from '@jave/core';
import {
  analyticsSnapshots,
  createDatabase,
  guildMemberEvents,
  members,
  referrals,
  users,
} from '@jave/database';

type Status = 'joined' | 'retained' | 'valid' | 'left' | 'invalid';

interface ReferralFixture {
  username: string;
  displayName: string;
  /** Invite code the member joined through; null = source unknown. */
  code: string | null;
  vanity?: boolean;
  joinedDaysAgo: number;
  status: Status;
  flags?: string[];
  score?: number;
  statusReason?: string;
}

/** Referral codes and campaign keys the specs refer to. */
export const REFERRAL_FIXTURES = {
  activeCampaign: 'autumn-trials',
  endedCampaign: 'robotics-fair',
  idleCampaign: 'spring-open',
  flaggedInvitees: ['Nova Reyes', 'Nova Reyez'],
} as const;

const GUILD_CHANNEL = '400000000000000001';
const FIRST_INVITEE_ID = 130_000_000_000_000_001n;
const RETENTION_DAYS = 7;
const VALIDATION_DAYS = 8;
const FAST_LEAVE_HOURS = 5;
const SNAPSHOT_HISTORY_DAYS = 30;
/** Two days of simulated worker downtime, so charts show missing days honestly. */
const MISSING_SNAPSHOT_DAYS = [11, 12];

const INVITES = [
  { code: 'maracore', inviter: '110000000000000011', uses: 12 },
  { code: 'sanalab', inviter: '110000000000000013', uses: 6 },
  { code: 'fair2026', inviter: '110000000000000017', uses: 9 },
  { code: 'theoops', inviter: '110000000000000014', uses: 3 },
  { code: 'priyaink', inviter: '110000000000000021', uses: 2 },
] as const;
const VANITY_CODE = 'javelin';
/** Theo (seed.ts) owns the referral code the claim flow credits. */
const CODE_OWNER_DISCORD_ID = '110000000000000014';
const VANITY_USES = 40;

const REFERRALS: readonly ReferralFixture[] = [
  {
    username: 'lina_k',
    displayName: 'Lina Kovac',
    code: 'maracore',
    joinedDaysAgo: 34,
    status: 'valid',
  },
  {
    username: 'omar_s',
    displayName: 'Omar Saleh',
    code: 'maracore',
    joinedDaysAgo: 27,
    status: 'valid',
  },
  {
    username: 'hana_w',
    displayName: 'Hana Weiss',
    code: 'maracore',
    joinedDaysAgo: 19,
    status: 'valid',
  },
  {
    username: 'tomas_r',
    displayName: 'Tomás Rivera',
    code: 'maracore',
    joinedDaysAgo: 9,
    status: 'retained',
  },
  {
    username: 'yuki_n',
    displayName: 'Yuki Nakamura',
    code: 'maracore',
    joinedDaysAgo: 4,
    status: 'joined',
  },
  {
    username: 'drift_07',
    displayName: 'Drift Seven',
    code: 'maracore',
    joinedDaysAgo: 16,
    status: 'left',
    flags: ['fast_leave'],
    score: 30,
    statusReason: 'left_guild',
  },
  {
    username: 'ines_p',
    displayName: 'Inês Pereira',
    code: 'sanalab',
    joinedDaysAgo: 31,
    status: 'valid',
  },
  {
    username: 'aarav_m',
    displayName: 'Aarav Mehta',
    code: 'sanalab',
    joinedDaysAgo: 22,
    status: 'valid',
  },
  {
    username: 'nova_reyes',
    displayName: 'Nova Reyes',
    code: 'sanalab',
    joinedDaysAgo: 10,
    status: 'retained',
    flags: ['join_burst', 'new_account'],
    score: 45,
  },
  {
    username: 'felix_b',
    displayName: 'Felix Brandt',
    code: 'sanalab',
    joinedDaysAgo: 2,
    status: 'joined',
  },
  {
    username: 'zara_q',
    displayName: 'Zara Quinn',
    code: 'fair2026',
    joinedDaysAgo: 25,
    status: 'valid',
  },
  {
    username: 'milo_d',
    displayName: 'Milo Dimitrov',
    code: 'fair2026',
    joinedDaysAgo: 24,
    status: 'retained',
  },
  {
    username: 'ada_l',
    displayName: 'Ada Lindgren',
    code: 'fair2026',
    joinedDaysAgo: 23,
    status: 'retained',
  },
  {
    username: 'blink_22',
    displayName: 'Blink Twentytwo',
    code: 'fair2026',
    joinedDaysAgo: 21,
    status: 'left',
    flags: ['fast_leave'],
    score: 30,
    statusReason: 'left_guild',
  },
  {
    username: 'echo_echo',
    displayName: 'Echo Echo',
    code: 'fair2026',
    joinedDaysAgo: 20,
    status: 'invalid',
    flags: ['rejoin'],
    score: 35,
    statusReason: 'staff_invalidated',
  },
  {
    username: 'nova_reyez',
    displayName: 'Nova Reyez',
    code: 'theoops',
    joinedDaysAgo: 8,
    status: 'retained',
    flags: ['similar_usernames', 'new_account'],
    score: 45,
  },
  {
    username: 'caleb_o',
    displayName: 'Caleb Osei',
    code: 'theoops',
    joinedDaysAgo: 3,
    status: 'joined',
  },
  {
    username: 'rin_h',
    displayName: 'Rin Hayashi',
    code: VANITY_CODE,
    vanity: true,
    joinedDaysAgo: 29,
    status: 'valid',
  },
  {
    username: 'max_f',
    displayName: 'Max Fischer',
    code: VANITY_CODE,
    vanity: true,
    joinedDaysAgo: 14,
    status: 'retained',
  },
  {
    username: 'lea_v',
    displayName: 'Léa Vidal',
    code: VANITY_CODE,
    vanity: true,
    joinedDaysAgo: 6,
    status: 'joined',
  },
  {
    username: 'suri_a',
    displayName: 'Suri Amani',
    code: VANITY_CODE,
    vanity: true,
    joinedDaysAgo: 1,
    status: 'joined',
  },
  {
    username: 'kai_t',
    displayName: 'Kai Torres',
    code: null,
    joinedDaysAgo: 18,
    status: 'retained',
  },
  {
    username: 'wren_j',
    displayName: 'Wren Jansen',
    code: null,
    joinedDaysAgo: 13,
    status: 'left',
    statusReason: 'left_guild',
  },
];

/**
 * Joined from an unknown source, then credited to Theo's referral code through
 * the claim flow. (Priya cannot hold a code: the moderation fixtures quarantine her.)
 */
const CODE_CLAIMANT = { username: 'ivo_g', displayName: 'Ivo Grant', joinedDaysAgo: 5 };

function inviteeDiscordId(index: number): string {
  return (FIRST_INVITEE_ID + BigInt(index)).toString();
}

async function actorFor(system: ServiceContext, discordId: string): Promise<ServiceContext> {
  const [user] = await system.db.select().from(users).where(eq(users.discordId, discordId));
  if (!user) throw new Error(`fixture user ${discordId} missing`);
  return withActor(system, await resolveUserActor(system, user.id));
}

async function joinInvitee(
  system: ServiceContext,
  index: number,
  fixture: { username: string; displayName: string },
  joinedAt: Date,
) {
  const user = await upsertDiscordUser(system, {
    discordId: inviteeDiscordId(index),
    username: fixture.username,
    displayName: fixture.displayName,
  });
  const member = await ensureMember(system, user, { inGuild: true, joinedAt });
  // Staff-only profiles: see the file header.
  await system.db
    .update(members)
    .set({ onboardingState: 'completed', profileVisibility: 'staff' })
    .where(eq(members.id, member.id));
  await system.db
    .insert(guildMemberEvents)
    .values({ userId: user.id, type: 'join', accountAgeDays: 400, occurredAt: joinedAt });
  return { user, member };
}

/** Lifecycle states that take days to earn, written directly (see the file header). */
async function applyLifecycle(
  system: ServiceContext,
  referralId: string,
  memberId: string,
  userId: string,
  fixture: ReferralFixture,
  joinedAt: Date,
) {
  const retainedAt =
    fixture.status === 'retained' || fixture.status === 'valid'
      ? new Date(joinedAt.getTime() + RETENTION_DAYS * DAY)
      : null;
  const validatedAt =
    fixture.status === 'valid' ? new Date(joinedAt.getTime() + VALIDATION_DAYS * DAY) : null;
  const leftAt =
    fixture.status === 'left' ? new Date(joinedAt.getTime() + FAST_LEAVE_HOURS * HOUR) : null;
  await system.db
    .update(referrals)
    .set({
      status: fixture.status,
      statusReason: fixture.statusReason ?? null,
      retainedAt,
      validatedAt,
      leftAt,
      anomalyFlags: fixture.flags ?? [],
      anomalyScore: fixture.score ?? 0,
    })
    .where(eq(referrals.id, referralId));
  if (leftAt) {
    await system.db.insert(guildMemberEvents).values({ userId, type: 'leave', occurredAt: leftAt });
    await system.db
      .update(members)
      .set({ guildStatus: 'departed', leftGuildAt: leftAt })
      .where(eq(members.id, memberId));
  }
}

async function seedCampaigns(core: ServiceContext, now: Date) {
  const active = await invites.createCampaign(core, {
    key: REFERRAL_FIXTURES.activeCampaign,
    name: 'Autumn trials recruitment',
    description: 'Recruitment push for the autumn trial season.',
    startsAt: new Date(now.getTime() - 40 * DAY),
    endsAt: new Date(now.getTime() + 30 * DAY),
  });
  const ended = await invites.createCampaign(core, {
    key: REFERRAL_FIXTURES.endedCampaign,
    name: 'Robotics fair booth',
    startsAt: new Date(now.getTime() - 30 * DAY),
    endsAt: new Date(now.getTime() - 15 * DAY),
  });
  await invites.createCampaign(core, {
    key: REFERRAL_FIXTURES.idleCampaign,
    name: 'Spring open call',
    active: false,
  });
  await invites.attachInviteToCampaign(core, { code: 'maracore', campaignId: active.id });
  await invites.attachInviteToCampaign(core, { code: 'fair2026', campaignId: ended.id });
}

/** Daily snapshots for the last 30 days (flows through the job; see header for the gauge). */
async function seedSnapshots(system: ServiceContext, now: Date) {
  const days = analytics.daysEndingWith(analytics.previousDay(now), SNAPSHOT_HISTORY_DAYS);
  const missing = new Set(MISSING_SNAPSHOT_DAYS.map((ago) => days[days.length - ago]));
  const yesterday = days.at(-1)!;
  for (const day of days.slice(0, -1)) {
    if (!missing.has(day)) await analytics.runAnalyticsSnapshot(system, { day });
  }
  await analytics.runAnalyticsSnapshot(system);

  const people = await system.db
    .select({ joinedAt: members.joinedGuildAt, leftAt: members.leftGuildAt })
    .from(members)
    .where(inArray(members.guildStatus, ['present', 'departed']));
  const history = days
    .filter((day) => day !== yesterday && !missing.has(day))
    .map((day) => {
      const end = analytics.dayWindow(day).end.getTime();
      const present = people.filter(
        (p) =>
          p.joinedAt !== null &&
          p.joinedAt.getTime() < end &&
          (p.leftAt === null || p.leftAt.getTime() >= end),
      ).length;
      return { day, metric: 'members.present', dimension: '', value: present };
    });
  if (history.length > 0) await system.db.insert(analyticsSnapshots).values(history);
}

/**
 * Runs last (after the dashboard, moderation and ticket fixtures), so the
 * daily snapshots it records cover every fixture.
 */
export async function seedReferralFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-referrals' });
  try {
    await seed(createContext({ db: database.db, actor: systemActor('e2e-referrals-seed') }));
  } finally {
    await database.close();
  }
}

async function seed(system: ServiceContext): Promise<void> {
  const now = system.clock.now();
  await invites.syncInvites(system, [
    ...INVITES.map((invite) => ({
      code: invite.code,
      inviterDiscordId: invite.inviter,
      channelId: GUILD_CHANNEL,
      uses: invite.uses,
      maxUses: 0,
      createdAt: new Date(now.getTime() - 45 * DAY),
    })),
    { code: VANITY_CODE, inviterDiscordId: null, uses: VANITY_USES, vanity: true },
  ]);
  const core = await actorFor(system, '100000000000000002');
  await seedCampaigns(core, now);

  for (const [index, fixture] of REFERRALS.entries()) {
    const joinedAt = new Date(now.getTime() - fixture.joinedDaysAgo * DAY);
    const { user, member } = await joinInvitee(system, index, fixture, joinedAt);
    const { referral } = await invites.attributeJoin(system, {
      inviteeUserId: user.id,
      usedCode: fixture.code,
      vanity: fixture.vanity ?? false,
      joinedAt,
    });
    await applyLifecycle(system, referral.id, member.id, user.id, fixture, joinedAt);
  }

  const claimantJoin = new Date(now.getTime() - CODE_CLAIMANT.joinedDaysAgo * DAY);
  const claimant = await joinInvitee(system, REFERRALS.length, CODE_CLAIMANT, claimantJoin);
  await invites.attributeJoin(system, {
    inviteeUserId: claimant.user.id,
    usedCode: null,
    joinedAt: claimantJoin,
  });
  const theo = await actorFor(system, CODE_OWNER_DISCORD_ID);
  const code = await invites.createReferralCode(theo, {});
  await invites.claimReferralCode(await actorFor(system, inviteeDiscordId(REFERRALS.length)), {
    code: code.code,
  });

  await seedSnapshots(system, now);
}
