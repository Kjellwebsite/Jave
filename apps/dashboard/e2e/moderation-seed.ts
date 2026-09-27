/**
 * End-to-end moderation fixtures — TEST DATA ONLY. Every record is written
 * through the moderation services (cases, automod, join screening, member
 * reports, reviews), so audit entries, events and Discord jobs are genuine.
 * The Discord jobs stay queued: no bot runs during end-to-end tests.
 */
import { notInArray } from 'drizzle-orm';
import {
  createContext,
  findUserByDiscordId,
  HOUR,
  moderation,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  withActor,
} from '@jave/core';
import { createDatabase, notifications } from '@jave/database';

/** Dev personas (server/auth/dev-personas.ts) and fixture members (seed.ts), by Discord ID. */
const PEOPLE = {
  moderator: '100000000000000004',
  core: '100000000000000002',
  mara: '110000000000000011',
  ilya: '110000000000000012',
  sana: '110000000000000013',
  noor: '110000000000000015',
  jun: '110000000000000016',
  kasimir: '110000000000000018',
  priya: '110000000000000021',
} as const;

const GENERAL_CHANNEL = '120000000000000001';
const BUILD_LOG_CHANNEL = '120000000000000002';
const RESEARCH_CHANNEL = '120000000000000003';
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n;
const SPAM_MENTIONS = 7;
const SUSPICIOUS_ACCOUNT_AGE_MS = 2 * HOUR;
const ONE_DAY_SECONDS = 86_400;

let sequence = 0n;

/** A Discord ID whose embedded creation time is `at` (messages, fresh accounts). */
function snowflakeAt(at: Date): string {
  sequence += 1n;
  return (
    ((BigInt(at.getTime()) - DISCORD_EPOCH_MS) << SNOWFLAKE_TIMESTAMP_SHIFT) +
    sequence
  ).toString();
}

async function userId(system: ServiceContext, discordId: string): Promise<string> {
  const user = await findUserByDiscordId(system, discordId);
  if (!user) throw new Error(`moderation fixture: unknown Discord user ${discordId}`);
  return user.id;
}

async function as(system: ServiceContext, discordId: string): Promise<ServiceContext> {
  return withActor(system, await resolveUserActor(system, await userId(system, discordId)));
}

/**
 * Cases, security events and reviews for /moderation. Staff alerts and
 * member notices these produce are removed afterwards so other specs can
 * count the founder's inbox.
 */
export async function seedModerationFixtures(system: ServiceContext): Promise<void> {
  const before = (await system.db.select({ id: notifications.id }).from(notifications)).map(
    (row) => row.id,
  );
  const now = system.clock.now();
  const mod = await as(system, PEOPLE.moderator);
  const core = await as(system, PEOPLE.core);

  const warning = await moderation.warnMember(mod, {
    targetDiscordId: PEOPLE.jun,
    reason: 'Posted referral links in #general after a reminder.',
  });
  await moderation.markCaseSynced(system, { caseId: warning.id, status: 'applied' });

  const timeout = await moderation.timeoutMember(mod, {
    targetDiscordId: PEOPLE.ilya,
    reason: 'Flooded #build-log with duplicate status messages.',
    durationSeconds: ONE_DAY_SECONDS,
  });
  await moderation.markCaseSynced(system, {
    caseId: timeout.id,
    status: 'failed',
    error: "Missing Permissions: the bot's role sits below the member's highest role.",
  });

  await moderation.screenMessage(system, {
    author: { discordId: PEOPLE.noor, username: 'noor', displayName: 'Noor Haddad' },
    channelId: GENERAL_CHANNEL,
    messageId: snowflakeAt(now),
    content: 'Free Nitro for everyone @everyone claim at discord.gg/raidhub before it runs out',
    mentionCount: SPAM_MENTIONS,
    mentionsEveryone: true,
  });

  await moderation.banMember(core, {
    targetDiscordId: PEOPLE.kasimir,
    reason: 'Ban evasion: returned on an alternate account during a timeout.',
    deleteMessageDays: 1,
  });

  await moderation.quarantineMember(mod, {
    targetDiscordId: PEOPLE.priya,
    reason: 'Account reported as compromised; sending phishing links by DM.',
  });

  await moderation.addModNote(mod, {
    targetDiscordId: PEOPLE.mara,
    reason: "Offered to mentor this season's trial cohort on flight software.",
  });

  await moderation.reportMessage(await as(system, PEOPLE.mara), {
    authorDiscordId: PEOPLE.jun,
    channelId: BUILD_LOG_CHANNEL,
    messageId: snowflakeAt(now),
    content: 'DM me for a guaranteed trial pass. 20 USD, paid up front.',
  });

  await moderation.screenJoin(system, {
    discordUser: {
      discordId: snowflakeAt(new Date(now.getTime() - SUSPICIOUS_ACCOUNT_AGE_MS)),
      username: 'javelin_support_desk',
      displayName: 'JAVELIN Support',
    },
  });

  const blocked = await moderation.recordSecurityEvent(system, {
    targetDiscordId: PEOPLE.sana,
    trigger: 'blocked_link',
    riskScore: 50,
    signals: [{ key: 'blocked_link', weight: 50, detail: 'arxiv-mirror.example' }],
    channelId: RESEARCH_CHANNEL,
    messageIds: [snowflakeAt(now)],
    excerpt: 'Preprint is up: arxiv-mirror.example/abs/2609.01234',
    actionTaken: 'message_deleted',
  });
  await moderation.reviewSecurityEvent(mod, {
    securityEventId: blocked.id,
    status: 'dismissed',
    note: 'Legitimate preprint mirror. Added to the allowlist.',
  });

  await system.db.delete(notifications).where(notInArray(notifications.id, before));
}

/**
 * Seeds the moderation fixtures on their own connection. Run it after every
 * other fixture: the quarantine it applies (Priya) refuses her later writes,
 * such as the ticket the ticket fixtures open for her.
 */
export async function seedModerationFixturesAt(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-moderation' });
  try {
    await seedModerationFixtures(
      createContext({ db: database.db, actor: systemActor('e2e-moderation-seed') }),
    );
  } finally {
    await database.close();
  }
}
