import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  achievementDefinitions,
  applicationReviews,
  applications,
  auditLogs,
  contributions,
  type Database,
  domainEvents,
  eventRsvps,
  events,
  memberAchievements,
  memberCapabilities,
  members,
  missionAssignments,
  missions,
  modCases,
  notifications,
  projectMilestones,
  projects,
  rankHistory,
  researchItems,
  securityEvents,
  ticketMessages,
  tickets,
  tournamentMatches,
  trialEvaluations,
  trialResults,
  trials,
  verifications,
} from '@jave/database';

/** Row counts per seeded table, for the CLI summary and the tests. */
const COUNTED_TABLES = {
  members,
  memberCapabilities,
  rankHistory,
  applications,
  applicationReviews,
  trials,
  trialEvaluations,
  trialResults,
  missions,
  missionAssignments,
  projects,
  projectMilestones,
  contributions,
  events,
  eventRsvps,
  tournamentMatches,
  tickets,
  ticketMessages,
  modCases,
  securityEvents,
  achievementDefinitions,
  memberAchievements,
  researchItems,
  verifications,
  notifications,
  domainEvents,
  auditLogs,
} satisfies Record<string, PgTable>;

export type SeedCounts = Record<keyof typeof COUNTED_TABLES, number>;

export async function countSeededRows(db: Database): Promise<SeedCounts> {
  const counts: Partial<SeedCounts> = {};
  for (const [name, table] of Object.entries(COUNTED_TABLES)) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    counts[name as keyof SeedCounts] = row?.count ?? 0;
  }
  return counts as SeedCounts;
}
