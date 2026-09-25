import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  adversarialRoles,
  members,
  serverSettings,
  trialParticipants,
  trialTeams,
  trials,
  trialTemplates,
} from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, DisabledError, ForbiddenError, NotFoundError } from '../kernel/errors';
import { activeRoles } from '../identity/users.service';
import { isStaffRole } from '../permissions/roles';
import { settingsSchemas } from '../settings/schemas';
import {
  PLANNING_TRIAL_STATUSES,
  type RoleRecord,
  type RoleStatus,
  type TrialStatus,
} from './state';

const FOREIGN_KEY_VIOLATION = '23503';

/** Postgres foreign_key_violation (postgres-js and PGlite), like the kernel's isUniqueViolation. */
export function isForeignKeyViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) => (candidate as { code?: string } | null)?.code === FOREIGN_KEY_VIOLATION,
  );
}

export const ROLE_ENTITY = 'Adversarial role';
export const AUDIT_TARGET_ROLE = 'adversarial_role';
export const AUDIT_TARGET_SCENARIO = 'adversarial_scenario';
export const FEATURE_NAME = 'Adversarial exercises';

/**
 * Global kill switch, read fresh from the database on every check (never the
 * per-process settings cache): turning it off takes effect immediately.
 * Fails closed when the stored section is unreadable.
 */
export async function adversarialEnabled(ctx: ServiceContext): Promise<boolean> {
  const [row] = await ctx.db
    .select({ value: serverSettings.value })
    .from(serverSettings)
    .where(eq(serverSettings.section, 'trials'));
  const parsed = settingsSchemas.trials.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data.adversarialEnabled : false;
}

export async function assertKillSwitchOn(ctx: ServiceContext): Promise<void> {
  if (!(await adversarialEnabled(ctx))) throw new DisabledError(FEATURE_NAME);
}

export interface TrialContext {
  id: string;
  number: number;
  title: string;
  status: TrialStatus;
  adversarialEnabled: boolean;
  templateId: string | null;
  templateAllowsAdversarial: boolean | null;
  deadlineAt: Date | null;
}

export async function loadTrial(ctx: ServiceContext, trialId: string): Promise<TrialContext> {
  const [row] = await ctx.db
    .select({
      id: trials.id,
      number: trials.number,
      title: trials.title,
      status: trials.status,
      adversarialEnabled: trials.adversarialEnabled,
      templateId: trials.templateId,
      templateAllowsAdversarial: trialTemplates.allowsAdversarial,
      deadlineAt: trials.deadlineAt,
    })
    .from(trials)
    .leftJoin(trialTemplates, eq(trialTemplates.id, trials.templateId))
    .where(eq(trials.id, trialId));
  if (!row) throw new NotFoundError('Trial');
  return row;
}

/** Why this trial cannot host an adversarial role right now, or null. */
export function trialBlocker(trial: TrialContext): string | null {
  if (!trial.adversarialEnabled) return 'Adversarial roles are not enabled for this trial.';
  if (trial.templateId && trial.templateAllowsAdversarial !== true)
    return 'This trial’s template does not allow adversarial roles.';
  if (!PLANNING_TRIAL_STATUSES.includes(trial.status))
    return `Trial is ${trial.status}; adversarial roles are closed.`;
  return null;
}

export interface TeamContext {
  id: string;
  trialId: string;
  name: string;
  discordChannelId: string | null;
}

export async function loadTeam(ctx: ServiceContext, teamId: string): Promise<TeamContext | null> {
  const [row] = await ctx.db
    .select({
      id: trialTeams.id,
      trialId: trialTeams.trialId,
      name: trialTeams.name,
      discordChannelId: trialTeams.discordChannelId,
    })
    .from(trialTeams)
    .where(eq(trialTeams.id, teamId));
  return row ?? null;
}

/** True when the member is a selected participant of the trial on the given team. */
export async function isSelectedOnTeam(
  ctx: ServiceContext,
  input: { trialId: string; teamId: string; memberId: string },
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: trialParticipants.id })
    .from(trialParticipants)
    .where(
      and(
        eq(trialParticipants.trialId, input.trialId),
        eq(trialParticipants.memberId, input.memberId),
        eq(trialParticipants.teamId, input.teamId),
        eq(trialParticipants.status, 'selected'),
      ),
    );
  return Boolean(row);
}

/**
 * Why a member cannot operate on this team, or null. Operatives must be in
 * good standing, VERIFIED or staff, and a selected participant on the team.
 */
export async function operativeIneligibility(
  ctx: ServiceContext,
  input: { trialId: string; teamId: string | null; memberId: string },
): Promise<string | null> {
  const [member] = await ctx.db
    .select({ standing: members.standing })
    .from(members)
    .where(and(eq(members.id, input.memberId), isNull(members.deletedAt)));
  if (!member) return 'Operative must be an active member.';
  if (member.standing !== 'good') return 'Operative must be a member in good standing.';
  const roles = await activeRoles(ctx, input.memberId);
  if (!roles.some((role) => role === 'verified' || isStaffRole(role)))
    return 'Operative must be VERIFIED or staff.';
  if (!input.teamId) return 'The target team no longer exists.';
  const selected = await isSelectedOnTeam(ctx, {
    trialId: input.trialId,
    teamId: input.teamId,
    memberId: input.memberId,
  });
  if (!selected) return 'Operative must be a selected participant on the target team.';
  return null;
}

export async function findRole(ctx: ServiceContext, roleId: string): Promise<RoleRecord | null> {
  const [row] = await ctx.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, roleId));
  return row ?? null;
}

export async function loadRole(ctx: ServiceContext, roleId: string): Promise<RoleRecord> {
  const role = await findRole(ctx, roleId);
  if (!role) throw new NotFoundError(ROLE_ENTITY);
  return role;
}

/** Lock the role row for the rest of the transaction and return its current state. */
export async function lockRole(ctx: ServiceContext, roleId: string): Promise<RoleRecord> {
  const [row] = await ctx.db
    .select()
    .from(adversarialRoles)
    .where(eq(adversarialRoles.id, roleId))
    .for('update');
  if (!row) throw new NotFoundError(ROLE_ENTITY);
  return row;
}

type RolePatch = Partial<typeof adversarialRoles.$inferInsert>;

/**
 * Compare-and-set transition: succeeds only while the role is still in one of
 * `from` (and matches `extra`). A concurrent writer makes it a ConflictError.
 */
export async function transitionRole(
  ctx: ServiceContext,
  roleId: string,
  from: readonly RoleStatus[],
  patch: RolePatch,
  extra?: SQL,
): Promise<RoleRecord> {
  const [row] = await ctx.db
    .update(adversarialRoles)
    .set({ ...patch, updatedAt: ctx.clock.now() })
    .where(and(eq(adversarialRoles.id, roleId), inArray(adversarialRoles.status, [...from]), extra))
    .returning();
  if (!row) throw new ConflictError('The role changed in the meantime. Reload and try again.');
  return row;
}

/**
 * Non-disclosure: callers who may not see a role get exactly the answer a
 * missing role gets. The attempt is still audited durably.
 */
export async function denyAsNotFound(
  ctx: ServiceContext,
  roleId: string,
  operation: string,
): Promise<never> {
  await recordAudit(
    ctx,
    {
      action: 'access.denied',
      targetType: AUDIT_TARGET_ROLE,
      targetId: roleId,
      result: 'denied',
      context: { operation },
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
  throw new NotFoundError(ROLE_ENTITY);
}

/**
 * Operative self-service (briefing, triggers) needs good standing: a
 * quarantined or banned account may be compromised. RED FLAG does not.
 */
export function inGoodStanding(ctx: ServiceContext): boolean {
  return ctx.actor.kind === 'user' && ctx.actor.standing === 'good';
}

/** True when the member has any participant record (any status) in the trial. */
export async function isTrialParticipant(
  ctx: ServiceContext,
  trialId: string,
  memberId: string,
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: trialParticipants.id })
    .from(trialParticipants)
    .where(and(eq(trialParticipants.trialId, trialId), eq(trialParticipants.memberId, memberId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Conflict of interest: staff who take part in a trial are participants for
 * its adversarial roles. They must not learn whether the trial has any.
 */
export async function actorParticipatesIn(ctx: ServiceContext, trialId: string): Promise<boolean> {
  if (ctx.actor.kind !== 'user' || !ctx.actor.memberId) return false;
  return isTrialParticipant(ctx, trialId, ctx.actor.memberId);
}

async function auditConflictOfInterest(
  ctx: ServiceContext,
  target: { type: string; id: string },
  operation: string,
): Promise<void> {
  await recordAudit(
    ctx,
    {
      action: 'adversarial.conflict_of_interest_blocked',
      targetType: target.type,
      targetId: target.id,
      result: 'denied',
      context: { operation },
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
}

/**
 * Load a role for a staff operation. Roles in a trial the caller takes part in
 * answer exactly like a missing role (audited as a conflict of interest).
 */
export async function loadManagedRole(
  ctx: ServiceContext,
  roleId: string,
  operation: string,
): Promise<RoleRecord> {
  const role = await findRole(ctx, roleId);
  if (!role) throw new NotFoundError(ROLE_ENTITY);
  if (await actorParticipatesIn(ctx, role.trialId)) {
    await auditConflictOfInterest(ctx, { type: AUDIT_TARGET_ROLE, id: roleId }, operation);
    throw new NotFoundError(ROLE_ENTITY);
  }
  return role;
}

/** Planning or listing for a trial the caller takes part in is refused. */
export async function assertNotTrialParticipant(
  ctx: ServiceContext,
  trialId: string,
  operation: string,
): Promise<void> {
  if (!(await actorParticipatesIn(ctx, trialId))) return;
  await auditConflictOfInterest(ctx, { type: 'trial', id: trialId }, operation);
  throw new ForbiddenError(
    'You take part in this trial, so its adversarial roles are closed to you.',
  );
}

/** User IDs of everyone with a participant record in the trial (excluded from staff notifications). */
export async function trialParticipantUserIds(
  ctx: ServiceContext,
  trialId: string,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: members.userId })
    .from(trialParticipants)
    .innerJoin(members, eq(members.id, trialParticipants.memberId))
    .where(eq(trialParticipants.trialId, trialId));
  return rows.map((row) => row.userId);
}

/** Bot callbacks and delivery loaders run only in the worker (system actor). */
export function assertSystemActor(ctx: ServiceContext): void {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
}

export async function memberUserId(ctx: ServiceContext, memberId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.userId ?? null;
}

/** User IDs of the selected participants on a team (for reveal notifications). */
export async function teamParticipantUserIds(
  ctx: ServiceContext,
  input: { trialId: string; teamId: string },
): Promise<{ memberId: string; userId: string }[]> {
  return ctx.db
    .select({ memberId: trialParticipants.memberId, userId: members.userId })
    .from(trialParticipants)
    .innerJoin(members, eq(members.id, trialParticipants.memberId))
    .where(
      and(
        eq(trialParticipants.trialId, input.trialId),
        eq(trialParticipants.teamId, input.teamId),
        eq(trialParticipants.status, 'selected'),
      ),
    );
}
