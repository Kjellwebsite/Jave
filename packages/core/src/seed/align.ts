import { is, sql, type SQL } from 'drizzle-orm';
import { getTableConfig, PgTable, PgTimestamp } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  type Database,
  evidence,
  memberCapabilities,
  memberRoles,
  members,
  missionAssignments,
  missions,
  rankHistory,
  schema,
  trialParticipants,
  trialResults,
  trials,
  trialTeams,
  trialTemplates,
  users,
  verificationEvidence,
  verifications,
} from '@jave/database';

/**
 * Timestamp alignment — the seed's only raw writes to domain tables.
 *
 * Services take time from `ctx.clock`, which the seed walks through the
 * story. A few columns are instead filled by the database (`default now()`)
 * or by drizzle's `$onUpdate(() => new Date())`, so rows written during the
 * seed would say they were created or changed "today". After the story, every
 * such value later than the anchor is moved back to the story time the row's
 * own data implies (its join, claim, audit trail…). Anything left over is
 * clamped to the anchor, so nothing in the seeded organization claims to
 * happen after its "now".
 */

/** Columns the database or drizzle stamps with the real clock. */
const WRITE_TIME_COLUMNS = new Set(['created_at', 'updated_at', 'granted_at']);

function auditTime(aggregate: 'min' | 'max', targetType: string, targetId: SQL, anchor: Date) {
  const fn = aggregate === 'min' ? sql.raw('min') : sql.raw('max');
  return sql`(select ${fn}(${auditLogs.createdAt}) from ${auditLogs} where ${auditLogs.targetType} = ${targetType} and ${auditLogs.targetId} = ${targetId} and ${auditLogs.createdAt} <= ${sql.param(anchor, auditLogs.createdAt)})`;
}

/** Row-specific story times for the columns known to be stamped by the database. */
function alignmentStatements(anchor: Date): SQL[] {
  const after = (column: PgTimestamp) => sql`${column} > ${sql.param(anchor, column)}`;
  return [
    sql`update ${members} set created_at = coalesce(${members.joinedGuildAt}, ${members.createdAt}) where ${after(members.createdAt)}`,
    sql`update ${members} set updated_at = coalesce(greatest(${members.joinedGuildAt}, ${members.onboardedAt}, ${members.leftGuildAt}), ${members.createdAt}) where ${after(members.updatedAt)}`,
    sql`update ${users} set created_at = m.created_at, updated_at = m.created_at from ${members} m where m.user_id = ${users.id} and ${after(users.createdAt)}`,
    sql`update ${memberRoles} set granted_at = m.created_at from ${members} m where m.id = ${memberRoles.memberId} and ${after(memberRoles.grantedAt)}`,
    sql`update ${memberCapabilities} set created_at = coalesce(least(${memberCapabilities.claimedAt}, ${memberCapabilities.verifiedAt}), (select min(${rankHistory.createdAt}) from ${rankHistory} where ${rankHistory.memberId} = ${memberCapabilities.memberId} and ${rankHistory.facetKey} = ${memberCapabilities.facetKey})) where ${after(memberCapabilities.createdAt)}`,
    sql`update ${memberCapabilities} set updated_at = coalesce(greatest(${memberCapabilities.claimedAt}, ${memberCapabilities.verifiedAt}), ${memberCapabilities.createdAt}) where ${after(memberCapabilities.updatedAt)}`,
    sql`update ${evidence} set created_at = coalesce((select min(v.requested_at) from ${verificationEvidence} ve join ${verifications} v on v.id = ve.verification_id where ve.evidence_id = ${evidence.id}), ${evidence.reviewedAt}) where ${after(evidence.createdAt)}`,
    sql`update ${evidence} set updated_at = greatest(${evidence.createdAt}, ${evidence.reviewedAt}) where ${after(evidence.updatedAt)}`,
    sql`update ${verifications} set created_at = ${verifications.requestedAt} where ${after(verifications.createdAt)}`,
    sql`update ${verifications} set updated_at = greatest(${verifications.requestedAt}, ${verifications.reviewStartedAt}, ${verifications.decidedAt}, ${verifications.revokedAt}) where ${after(verifications.updatedAt)}`,
    sql`update ${trials} set created_at = coalesce(${auditTime('min', 'trial', sql`${trials.id}::text`, anchor)}, ${trials.createdAt}) where ${after(trials.createdAt)}`,
    sql`update ${trials} set updated_at = coalesce(${auditTime('max', 'trial', sql`${trials.id}::text`, anchor)}, ${trials.createdAt}) where ${after(trials.updatedAt)}`,
    sql`update ${trialTemplates} set created_at = coalesce((select min(${auditLogs.createdAt}) from ${auditLogs} where ${auditLogs.action} = 'trial.templates_seeded'), ${trialTemplates.createdAt}) where ${after(trialTemplates.createdAt)}`,
    sql`update ${trialTemplates} set updated_at = ${trialTemplates.createdAt} where ${after(trialTemplates.updatedAt)}`,
    sql`update ${trialTeams} set created_at = coalesce((select max(${auditLogs.createdAt}) from ${auditLogs} where ${auditLogs.action} = 'trial.teams_assigned' and ${auditLogs.targetId} = ${trialTeams.trialId}::text and ${auditLogs.createdAt} <= ${sql.param(anchor, auditLogs.createdAt)}), ${trialTeams.createdAt}) where ${after(trialTeams.createdAt)}`,
    sql`update ${trialParticipants} set updated_at = greatest(${trialParticipants.appliedAt}, ${trialParticipants.selectedAt}) where ${after(trialParticipants.updatedAt)}`,
    sql`update ${trialResults} set updated_at = coalesce((select ${rankHistory.createdAt} from ${rankHistory} where ${rankHistory.id} = ${trialResults.rankHistoryId}), ${trialResults.publishedAt}, ${trialResults.createdAt}) where ${after(trialResults.updatedAt)}`,
    sql`update ${missions} set updated_at = greatest(${missions.createdAt}, ${missions.publishedAt}, ${missions.closedAt}, ${missions.archivedAt}) where ${after(missions.updatedAt)}`,
    sql`update ${missionAssignments} set updated_at = greatest(${missionAssignments.assignedAt}, ${missionAssignments.acceptedAt}, ${missionAssignments.submittedAt}, ${missionAssignments.reviewedAt}, ${missionAssignments.verifiedAt}) where ${after(missionAssignments.updatedAt)}`,
  ];
}

/** Clamp any remaining write-time column after the anchor, in every JAVE table. */
function clampStatements(anchor: Date): SQL[] {
  const statements: SQL[] = [];
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    for (const column of getTableConfig(table).columns) {
      if (!WRITE_TIME_COLUMNS.has(column.name) || !is(column, PgTimestamp)) continue;
      statements.push(
        sql`update ${table} set ${sql.identifier(column.name)} = ${sql.param(anchor, column)} where ${column} > ${sql.param(anchor, column)}`,
      );
    }
  }
  return statements;
}

export async function alignWriteTimes(db: Database, anchor: Date): Promise<void> {
  for (const statement of [...alignmentStatements(anchor), ...clampStatements(anchor)]) {
    await db.execute(statement);
  }
}

/** Write-time columns (created/updated/granted) whose latest value is after the anchor. */
export async function writeTimesAfter(db: Database, anchor: Date): Promise<string[]> {
  const offenders: string[] = [];
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!WRITE_TIME_COLUMNS.has(column.name) || !is(column, PgTimestamp)) continue;
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(table)
        .where(sql`${column} > ${sql.param(anchor, column)}`);
      if ((row?.count ?? 0) > 0) offenders.push(`${config.name}.${column.name}`);
    }
  }
  return offenders;
}
