/**
 * End-to-end ticket fixtures — TEST DATA ONLY. A realistic support queue
 * written through the tickets services (so events, audit, SLA and card jobs
 * are genuine): unassigned, claimed, overdue, waiting and closed tickets,
 * thread messages as the bot records them, an internal note, and a stored
 * AI summary from a fixture summarizer (MOCK / DEVELOPMENT ONLY).
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import {
  createContext,
  HOUR,
  ManualClock,
  MINUTE,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  tickets,
  updateSettings,
  withActor,
} from '@jave/core';
import { createDatabase, type Database, notifications, users } from '@jave/database';
import { DEV_PERSONAS } from '../server/auth/dev-personas';

export const E2E_TICKET_CHANNEL_ID = '300000000000000201';
export const E2E_TICKET_ARCHIVE_ID = '300000000000000202';

/** Subjects the Playwright specs look for. */
export const TICKET_FIXTURES = {
  claimed: 'Deploy pipeline fails on the build step',
  overdue: 'Harassment in the voice channel',
  waiting: 'Partnership proposal: robotics league',
  closed: 'Profile shows the wrong domain',
  requester: 'Cannot see my trial results',
  unassigned: 'Evidence upload rejected',
  escalate: 'Calendar invite links are broken',
  dueSoon: 'Locked out after changing my Discord name',
} as const;

const DISCORD = {
  founder: '100000000000000001',
  operations: '100000000000000003',
  verified: '100000000000000005',
  mara: '110000000000000011',
  sana: '110000000000000013',
  theo: '110000000000000014',
  elena: '110000000000000017',
  ren: '110000000000000019',
  sol: '110000000000000022',
  ilya: '110000000000000012',
} as const;
type Person = keyof typeof DISCORD;

/** Fake Discord ids for recorded threads and messages (test data only). */
let snowflake = 900_000_000_000_000_000n;
function nextSnowflake(): string {
  snowflake += 1n;
  return snowflake.toString();
}

/** MOCK / DEVELOPMENT ONLY: a fixed summary standing in for an AI provider. */
const FIXTURE_SUMMARY: tickets.TicketSummarizer = async () =>
  [
    '- The build step exits with code 137 since yesterday: the runner is killed for memory.',
    '- The requester shared the failing log; the last green build was on Monday.',
    '- Staff suspect the new asset pipeline doubled peak memory.',
    '- Next: raise the runner limit to 4 GB or split the asset step, then re-run.',
  ].join('\n');

interface FixtureUser {
  id: string;
  discordId: string;
  username: string;
  displayName: string | null;
}

interface Seeder {
  clock: ManualClock;
  system: ServiceContext;
  user(person: Person): FixtureUser;
  as(person: Person): Promise<ServiceContext>;
}

async function seeder(db: Database, start: Date): Promise<Seeder> {
  const clock = new ManualClock(start);
  const system = createContext({ db, clock, actor: systemActor('e2e-tickets-seed') });
  const people = new Map<Person, FixtureUser>();
  for (const [person, discordId] of Object.entries(DISCORD) as [Person, string][]) {
    const [row] = await db
      .select({
        id: users.id,
        discordId: users.discordId,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.discordId, discordId));
    if (!row) throw new Error(`fixture user ${person} missing: seed the dashboard fixtures first`);
    people.set(person, row);
  }
  const user = (person: Person) => people.get(person)!;
  return {
    clock,
    system,
    user,
    as: async (person) => withActor(system, await resolveUserActor(system, user(person).id)),
  };
}

/** The bot's side of a thread: create it, then record messages as they arrive. */
async function provisionThread(s: Seeder, ticketId: string): Promise<string> {
  const threadId = nextSnowflake();
  await tickets.markThreadCreated(s.system, { ticketId, threadId, cardMessageId: nextSnowflake() });
  return threadId;
}

/** A thread message as the bot's listener reports it (same identity the user already has). */
async function post(s: Seeder, threadId: string, person: Person, body: string, afterMs: number) {
  s.clock.advance(afterMs);
  const author = s.user(person);
  await tickets.recordMessage(s.system, {
    threadId,
    discordMessageId: nextSnowflake(),
    author: {
      discordId: author.discordId,
      username: author.username,
      displayName: author.displayName,
    },
    body,
    sentAt: s.clock.now(),
  });
}

export async function seedTicketFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-tickets' });
  const now = new Date();
  try {
    const s = await seeder(database.db, new Date(now.getTime() - 6 * HOUR));
    await updateSettings(s.system, 'channels', {
      tickets: E2E_TICKET_CHANNEL_ID,
      ticketArchive: E2E_TICKET_ARCHIVE_ID,
    });

    // Claimed, answered, with an internal note and a stored AI summary.
    const claimed = await tickets.openTicket(await s.as('mara'), {
      category: 'technical',
      priority: 'high',
      subject: TICKET_FIXTURES.claimed,
      body: 'The deploy job exits with code 137 on the build step since yesterday. Log attached in the thread.',
    });
    const claimedThread = await provisionThread(s, claimed.id);
    await post(
      s,
      claimedThread,
      'mara',
      'Here is the failing run: exit 137 right after the asset step.',
      4 * MINUTE,
    );
    s.clock.advance(20 * MINUTE);
    await tickets.claimTicket(await s.as('ren'), { ticketId: claimed.id });
    await post(
      s,
      claimedThread,
      'ren',
      'Looking at it now. Which runner size does the job use?',
      2 * MINUTE,
    );
    await post(s, claimedThread, 'mara', 'The default one, 2 GB.', 9 * MINUTE);
    s.clock.advance(3 * MINUTE);
    await tickets.addInternalNote(await s.as('ren'), {
      ticketId: claimed.id,
      body: 'Asset pipeline change on Monday doubled peak memory. Check with Theo before raising limits.',
    });
    await tickets.summarizeTicket(await s.as('ren'), claimed.id, FIXTURE_SUMMARY);

    // Urgent report, unassigned and past its first-response target.
    s.clock.set(new Date(now.getTime() - 95 * MINUTE));
    const overdue = await tickets.openTicket(await s.as('sana'), {
      category: 'report',
      priority: 'urgent',
      subject: TICKET_FIXTURES.overdue,
      body: 'Repeated slurs in the study voice channel tonight. I can share timestamps.',
    });
    await provisionThread(s, overdue.id);

    // Waiting on the requester.
    s.clock.set(new Date(now.getTime() - 26 * HOUR));
    const waiting = await tickets.openTicket(await s.as('elena'), {
      category: 'partnership',
      priority: 'low',
      subject: TICKET_FIXTURES.waiting,
      body: 'We run a student robotics league and would like to co-host a build trial.',
    });
    const waitingThread = await provisionThread(s, waiting.id);
    s.clock.advance(3 * HOUR);
    await tickets.claimTicket(await s.as('theo'), { ticketId: waiting.id });
    await tickets.setWaiting(await s.as('theo'), {
      ticketId: waiting.id,
      reason: 'Send the proposed dates and the expected number of teams.',
    });
    await post(s, waitingThread, 'theo', 'Thanks. Dates and team count, then we can plan.', MINUTE);

    // Closed after an answer. (Not Priya: the moderation fixtures quarantine her,
    // and quarantined members cannot open tickets.)
    s.clock.set(new Date(now.getTime() - 3 * 24 * HOUR));
    const closed = await tickets.openTicket(await s.as('sol'), {
      category: 'general',
      priority: 'normal',
      subject: TICKET_FIXTURES.closed,
      body: 'My public profile lists LIFE as my primary domain. It should be CREATE.',
    });
    const closedThread = await provisionThread(s, closed.id);
    s.clock.advance(40 * MINUTE);
    await post(s, closedThread, 'theo', 'Fixed. The domain is set from your profile settings.', 0);
    s.clock.advance(10 * MINUTE);
    await tickets.closeTicket(await s.as('theo'), {
      ticketId: closed.id,
      reason: 'Primary domain corrected to CREATE.',
    });

    // The verified dev persona's own ticket (requester flows).
    s.clock.set(new Date(now.getTime() - 5 * HOUR));
    const own = await tickets.openTicket(await s.as('verified'), {
      category: 'trial',
      priority: 'normal',
      subject: TICKET_FIXTURES.requester,
      body: 'My trial finished last week but the results page is still empty.',
    });
    const ownThread = await provisionThread(s, own.id);
    s.clock.advance(35 * MINUTE);
    await tickets.claimTicket(await s.as('operations'), { ticketId: own.id });
    await post(
      s,
      ownThread,
      'operations',
      'Results publish after the second evaluator signs off. Expect them by Friday.',
      MINUTE,
    );
    s.clock.advance(MINUTE);
    await tickets.addInternalNote(await s.as('operations'), {
      ticketId: own.id,
      body: 'Second evaluator is Theo; nudged him.',
    });

    // Fresh, unassigned tickets for claiming and bulk triage.
    s.clock.set(new Date(now.getTime() - 50 * MINUTE));
    const unassigned = await tickets.openTicket(await s.as('ilya'), {
      category: 'technical',
      priority: 'normal',
      subject: TICKET_FIXTURES.unassigned,
      body: 'Uploading a PDF as evidence fails with a generic error.',
    });
    await provisionThread(s, unassigned.id);
    s.clock.set(new Date(now.getTime() - 30 * MINUTE));
    const escalate = await tickets.openTicket(await s.as('ilya'), {
      category: 'operations',
      priority: 'low',
      subject: TICKET_FIXTURES.escalate,
      body: 'The calendar invite for Thursday links to a 404.',
    });
    await provisionThread(s, escalate.id);

    // High priority, unanswered, inside the last quarter of its target.
    s.clock.set(new Date(now.getTime() - 205 * MINUTE));
    const dueSoon = await tickets.openTicket(await s.as('elena'), {
      category: 'technical',
      priority: 'high',
      subject: TICKET_FIXTURES.dueSoon,
      body: 'Since renaming my Discord account I cannot sign in to the dashboard.',
    });
    await provisionThread(s, dueSoon.id);

    // The worker's SLA sweep, as the bot would run it: the urgent report is now a recorded miss.
    s.clock.set(now);
    await tickets.runSlaSweep(s.system);

    // The dev personas have already seen these alerts, so the inbox specs keep
    // their own fixed unread counts.
    await database.db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          like(notifications.type, 'ticket.%'),
          inArray(
            notifications.recipientUserId,
            database.db
              .select({ id: users.id })
              .from(users)
              .where(
                inArray(
                  users.discordId,
                  DEV_PERSONAS.map((persona) => persona.discordId),
                ),
              ),
          ),
        ),
      );
  } finally {
    await database.close();
  }
}
