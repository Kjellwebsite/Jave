import type { Database } from '@jave/database';
import { HOUR } from '../kernel/clock';
import type { JobOutcome } from '../jobs/worker';
import { alignWriteTimes } from './align';
import { castMember } from './cast';
import { admitFirstCohort, admitSecondCohort, openApplicationQueue } from './chapters/applications';
import { holdKickoff, playTournament, scheduleUpcomingEvents } from './chapters/calendar';
import { runCurrentMissions, runEarlyMissions } from './chapters/missions';
import { runModeration } from './chapters/moderation';
import { foundOrganization } from './chapters/people';
import { writeProjects } from './chapters/projects';
import { recognizeWork } from './chapters/recognition';
import { buildLibrary } from './chapters/research';
import { runTicketDesk } from './chapters/tickets';
import { setUpPlatform } from './chapters/platform';
import { openRecruitingTrial, runActiveTrial, runFirstTrial } from './chapters/trials';
import { existingMemberCount } from './reset';
import { SeedRun } from './run';
import { Story } from './story';
import { countSeededRows, type SeedCounts } from './summary';

/**
 * DEVELOPMENT DATA — `pnpm db:seed`.
 *
 * Builds a coherent JAVELIN organization by replaying ~150 days of its
 * history through the real core services under a manual clock: members join
 * through the gateway path, apply, are reviewed and admitted, run trials,
 * ship projects, complete missions, attend events, open tickets, and trip
 * automod. Audit entries, rank history, domain events, achievements and
 * notifications are therefore genuine consequences, not fabricated rows.
 *
 * See docs/commands/core.md ("Development seed") for the cast, the story and
 * the few places where the seed stands in for Discord.
 */

export { CAST, CAST_KEYS, castMember, PERSONA_KEYS, snowflakeAt, type CastKey } from './cast';
export { isLocalHost, parseDatabaseTarget, seedRefusal, type SeedEnvironment } from './guards';
export { writeTimesAfter } from './align';
export { existingMemberCount, javeTables, resetDatabase } from './reset';
export { SEED_SKIP_REASON } from './bot-stand-in';
export type { SeedCounts } from './summary';

export const DEFAULT_RNG_SEED = 'javelin';

export interface SeedOptions {
  /** The seeded organization's "now". Defaults to the current hour. */
  anchor?: Date;
  rngSeed?: string;
}

export interface SeedReport {
  anchor: Date;
  counts: SeedCounts;
  /** Jobs still scheduled after the anchor (reminders, deadlines). */
  pendingJobs: number;
  /** Jobs that failed during the story. Empty on a healthy seed. */
  jobFailures: JobOutcome[];
}

/** Thrown when the target database already holds an organization. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

/** The current time, rounded down to the hour: stable within an hour. */
export function currentHour(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / HOUR) * HOUR);
}

/** The chapters of the story, each registering its beats on the shared timeline. */
const CHAPTERS: readonly ((story: Story) => void)[] = [
  foundOrganization,
  setUpPlatform,
  admitFirstCohort,
  runFirstTrial,
  writeProjects,
  runEarlyMissions,
  buildLibrary,
  holdKickoff,
  playTournament,
  admitSecondCohort,
  runTicketDesk,
  runModeration,
  runActiveTrial,
  openApplicationQueue,
  runCurrentMissions,
  scheduleUpcomingEvents,
  openRecruitingTrial,
  recognizeWork,
];

/**
 * Seed an empty, migrated database. Refuses (SeedRefusedError) when members
 * already exist: reset first (`resetDatabase`) to replace the organization.
 */
export async function seedDevelopmentData(
  db: Database,
  options: SeedOptions = {},
): Promise<SeedReport> {
  const existing = await existingMemberCount(db);
  if (existing > 0) {
    throw new SeedRefusedError(
      `the database already holds ${existing} members; the seed only runs on an empty organization (use --reset locally)`,
    );
  }
  const anchor = options.anchor ?? currentHour();
  const run = new SeedRun({
    db,
    anchor,
    rngSeed: options.rngSeed ?? DEFAULT_RNG_SEED,
    config: { founderDiscordIds: [castMember('founder').discordId] },
  });
  const story = new Story();
  for (const chapter of CHAPTERS) chapter(story);
  await story.play(run);
  await run.advanceTo(anchor);
  await alignWriteTimes(db, anchor);
  return {
    anchor,
    counts: await countSeededRows(db),
    pendingJobs: await run.pendingJobCount(),
    jobFailures: run.jobFailures,
  };
}
