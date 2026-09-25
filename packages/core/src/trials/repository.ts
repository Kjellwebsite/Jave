import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import {
  memberRoles,
  members,
  trialParticipants,
  trialSubmissions,
  trialTeams,
  type trialTemplates,
  trials,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import type { OrgRole } from '../permissions/roles';

export type TrialRecord = typeof trials.$inferSelect;
export type TeamRecord = typeof trialTeams.$inferSelect;
export type ParticipantRecord = typeof trialParticipants.$inferSelect;
export type ParticipantStatus = ParticipantRecord['status'];
export type TemplateRecord = typeof trialTemplates.$inferSelect;
export type SubmissionRecord = typeof trialSubmissions.$inferSelect;

type Reader = Pick<ServiceContext, 'db'>;

/** Participation statuses that still have a stake in the trial's outcome. */
export const STAKE_STATUSES: readonly ParticipantStatus[] = ['applied', 'selected', 'waitlisted'];

/** Load a trial. `lock` takes a row lock for the rest of the transaction. */
export async function loadTrial(
  ctx: Reader,
  trialId: string,
  lock?: 'update' | 'share',
): Promise<TrialRecord> {
  const query = ctx.db.select().from(trials).where(eq(trials.id, trialId));
  const [row] = lock ? await query.for(lock) : await query;
  if (!row) throw new NotFoundError('Trial');
  return row;
}

export async function findTeam(ctx: Reader, teamId: string): Promise<TeamRecord | null> {
  const [row] = await ctx.db.select().from(trialTeams).where(eq(trialTeams.id, teamId));
  return row ?? null;
}

export async function loadTeams(
  ctx: Reader,
  trialId: string,
  lock?: 'update',
): Promise<TeamRecord[]> {
  const query = ctx.db
    .select()
    .from(trialTeams)
    .where(eq(trialTeams.trialId, trialId))
    .orderBy(asc(trialTeams.ordinal));
  return lock ? query.for(lock) : query;
}

export async function findParticipation(
  ctx: Reader,
  trialId: string,
  memberId: string,
): Promise<ParticipantRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(trialParticipants)
    .where(and(eq(trialParticipants.trialId, trialId), eq(trialParticipants.memberId, memberId)));
  return row ?? null;
}

export interface ParticipantDetail extends ParticipantRecord {
  userId: string;
  discordId: string;
  displayName: string;
  handle: string;
  primaryDomain: string | null;
  standing: (typeof members.$inferSelect)['standing'];
  guildStatus: (typeof members.$inferSelect)['guildStatus'];
}

/** Participants joined with their member and user rows, in application order. */
export async function loadParticipantDetails(
  ctx: Reader,
  trialId: string,
  statuses?: readonly ParticipantStatus[],
): Promise<ParticipantDetail[]> {
  const conditions = [eq(trialParticipants.trialId, trialId)];
  if (statuses) conditions.push(inArray(trialParticipants.status, [...statuses]));
  const rows = await ctx.db
    .select({
      participant: trialParticipants,
      userId: users.id,
      discordId: users.discordId,
      displayName: members.displayName,
      handle: members.handle,
      primaryDomain: members.primaryDomain,
      standing: members.standing,
      guildStatus: members.guildStatus,
    })
    .from(trialParticipants)
    .innerJoin(members, eq(members.id, trialParticipants.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(...conditions))
    .orderBy(asc(trialParticipants.appliedAt), asc(trialParticipants.memberId));
  return rows.map((row) => ({
    ...row.participant,
    userId: row.userId,
    discordId: row.discordId,
    displayName: row.displayName,
    handle: row.handle,
    primaryDomain: row.primaryDomain,
    standing: row.standing,
    guildStatus: row.guildStatus,
  }));
}

/** Selected participants who are on a team — the people competing. */
export async function loadCompetitors(ctx: Reader, trialId: string): Promise<ParticipantDetail[]> {
  const rows = await loadParticipantDetails(ctx, trialId, ['selected']);
  return rows.filter((row) => row.teamId !== null);
}

export async function submittedTeamIds(ctx: Reader, trialId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .selectDistinct({ teamId: trialSubmissions.teamId })
    .from(trialSubmissions)
    .where(eq(trialSubmissions.trialId, trialId));
  return new Set(rows.map((row) => row.teamId));
}

/** Active (non-revoked, non-expired) roles for several members in one query. */
export async function activeRolesByMember(
  ctx: Pick<ServiceContext, 'db' | 'clock'>,
  memberIds: readonly string[],
): Promise<Map<string, OrgRole[]>> {
  const out = new Map<string, OrgRole[]>(memberIds.map((id) => [id, []]));
  if (memberIds.length === 0) return out;
  const rows = await ctx.db
    .select({ memberId: memberRoles.memberId, role: memberRoles.role })
    .from(memberRoles)
    .where(
      and(
        inArray(memberRoles.memberId, [...memberIds]),
        isNull(memberRoles.revokedAt),
        or(isNull(memberRoles.expiresAt), gt(memberRoles.expiresAt, ctx.clock.now())),
      ),
    );
  for (const row of rows) out.get(row.memberId)?.push(row.role);
  return out;
}
