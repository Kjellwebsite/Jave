import { and, asc, count, desc, eq, isNotNull, isNull, notInArray, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  adversarialObservations,
  adversarialRoles,
  adversarialScenarios,
  members,
  trialParticipants,
  trials,
  trialTeams,
} from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize, requireMember } from '../permissions/authorize';
import { type BriefingView, renderBriefingText } from './briefing';
import {
  AUDIT_TARGET_ROLE,
  denyAsNotFound,
  findRole,
  inGoodStanding,
  loadManagedRole,
} from './guards';
import type { ObservationRecord, TriggerRecord } from './observations.service';
import { listRolesSchema, roleIdSchema } from './schemas';
import { countOutcomes, type OutcomeCounts, suggestScore } from './scoring';
import type { RoleRecord, RoleStatus, Technique, TrialStatus } from './state';
import { type EvaluationRecord, loadBriefingView, loadEvaluation, loadTriggers } from './views';

export interface RoleSummary {
  id: string;
  status: RoleStatus;
  trial: { id: string; number: number; title: string; status: TrialStatus };
  team: { id: string; name: string } | null;
  operative: { memberId: string; displayName: string; handle: string };
  scenario: { id: string; key: string; title: string; technique: Technique };
  authorized: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleDetail extends RoleSummary {
  role: RoleRecord;
  triggers: TriggerRecord[];
  observations: ObservationRecord[];
  outcomes: OutcomeCounts;
  suggestedScore: number | null;
  evaluation: EvaluationRecord | null;
}

function summarySelect() {
  return {
    role: adversarialRoles,
    trialNumber: trials.number,
    trialTitle: trials.title,
    trialStatus: trials.status,
    teamName: trialTeams.name,
    operativeName: members.displayName,
    operativeHandle: members.handle,
    scenarioKey: adversarialScenarios.key,
    scenarioTitle: adversarialScenarios.title,
    technique: adversarialScenarios.technique,
  };
}

type SummaryRow = {
  role: RoleRecord;
  trialNumber: number;
  trialTitle: string;
  trialStatus: TrialStatus;
  teamName: string | null;
  operativeName: string;
  operativeHandle: string;
  scenarioKey: string;
  scenarioTitle: string;
  technique: Technique;
};

function toSummary(row: SummaryRow): RoleSummary {
  const { role } = row;
  return {
    id: role.id,
    status: role.status,
    trial: {
      id: role.trialId,
      number: row.trialNumber,
      title: row.trialTitle,
      status: row.trialStatus,
    },
    team: role.teamId && row.teamName !== null ? { id: role.teamId, name: row.teamName } : null,
    operative: {
      memberId: role.operativeMemberId,
      displayName: row.operativeName,
      handle: row.operativeHandle,
    },
    scenario: {
      id: role.scenarioId,
      key: row.scenarioKey,
      title: row.scenarioTitle,
      technique: row.technique,
    },
    authorized: role.authorizedAt !== null,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function summaryQuery(ctx: ServiceContext, where: SQL | undefined) {
  return ctx.db
    .select(summarySelect())
    .from(adversarialRoles)
    .innerJoin(trials, eq(trials.id, adversarialRoles.trialId))
    .innerJoin(adversarialScenarios, eq(adversarialScenarios.id, adversarialRoles.scenarioId))
    .innerJoin(members, eq(members.id, adversarialRoles.operativeMemberId))
    .leftJoin(trialTeams, eq(trialTeams.id, adversarialRoles.teamId))
    .where(where);
}

/** Full staff view of a role. canManageAdversarial only; every read is audited. */
export async function getRole(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<RoleDetail> {
  const data = parseInput(roleIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE, id: data.roleId });
  const role = await loadManagedRole(ctx, data.roleId, 'adversarial.get_role');
  const [[row], triggers, observations, evaluation] = await Promise.all([
    summaryQuery(ctx, eq(adversarialRoles.id, role.id)),
    loadTriggers(ctx, role.id),
    ctx.db
      .select()
      .from(adversarialObservations)
      .where(eq(adversarialObservations.roleId, role.id))
      .orderBy(asc(adversarialObservations.occurredAt), asc(adversarialObservations.id)),
    loadEvaluation(ctx, role.id),
  ]);
  const outcomes = observations.map((o) => o.outcome);
  await recordAudit(ctx, {
    action: 'adversarial.role_viewed',
    targetType: AUDIT_TARGET_ROLE,
    targetId: role.id,
  });
  return {
    ...toSummary(row!),
    role,
    triggers,
    observations,
    outcomes: countOutcomes(outcomes),
    suggestedScore: suggestScore(outcomes),
    evaluation,
  };
}

/** Staff list of roles, newest first. canManageAdversarial only; audited. */
export async function listRoles(
  ctx: ServiceContext,
  input: z.input<typeof listRolesSchema> = {},
): Promise<Page<RoleSummary>> {
  const q = parseInput(listRolesSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_ROLE });
  const filters: SQL[] = [];
  // Conflict of interest: trials the caller takes part in are invisible to them.
  if (ctx.actor.kind === 'user' && ctx.actor.memberId) {
    filters.push(
      notInArray(
        adversarialRoles.trialId,
        ctx.db
          .select({ trialId: trialParticipants.trialId })
          .from(trialParticipants)
          .where(eq(trialParticipants.memberId, ctx.actor.memberId)),
      ),
    );
  }
  if (q.trialId) filters.push(eq(adversarialRoles.trialId, q.trialId));
  if (q.status) filters.push(eq(adversarialRoles.status, q.status));
  const where = filters.length ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    summaryQuery(ctx, where)
      .orderBy(desc(adversarialRoles.createdAt), desc(adversarialRoles.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(adversarialRoles).where(where),
  ]);
  await recordAudit(ctx, {
    action: 'adversarial.roles_listed',
    targetType: AUDIT_TARGET_ROLE,
    context: { trialId: q.trialId ?? null, status: q.status ?? null, returned: rows.length },
  });
  return { items: rows.map(toSummary), total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

export interface MyBriefing {
  briefing: BriefingView;
  text: string;
}

/**
 * The operative's own briefing: their role, objective, guardrails, stop-word
 * protocol and triggers. Available once briefed. Anyone else — including a
 * teammate guessing an ID — gets the same answer as for a role that does not exist.
 */
export async function getMyBriefing(
  ctx: ServiceContext,
  input: z.input<typeof roleIdSchema>,
): Promise<MyBriefing> {
  const data = parseInput(roleIdSchema, input);
  const actor = requireMember(ctx);
  const role = await findRole(ctx, data.roleId);
  if (
    !role ||
    role.operativeMemberId !== actor.memberId ||
    role.briefedAt === null ||
    !inGoodStanding(ctx)
  )
    return denyAsNotFound(ctx, data.roleId, 'adversarial.get_briefing');
  const briefing = await loadBriefingView(ctx, role);
  await recordAudit(ctx, {
    action: 'adversarial.briefing_viewed',
    targetType: AUDIT_TARGET_ROLE,
    targetId: role.id,
    context: { revision: role.briefingRevision },
  });
  return { briefing, text: renderBriefingText(briefing) };
}

/**
 * Every unrevealed briefing addressed to the caller. Empty for everyone who
 * is not an operative — the response shape never hints at other roles.
 */
export async function listMyBriefings(ctx: ServiceContext): Promise<MyBriefing[]> {
  const actor = requireMember(ctx);
  if (!inGoodStanding(ctx)) return [];
  const roles = await ctx.db
    .select()
    .from(adversarialRoles)
    .where(
      and(
        eq(adversarialRoles.operativeMemberId, actor.memberId),
        isNotNull(adversarialRoles.briefedAt),
        isNull(adversarialRoles.revealedAt),
      ),
    )
    .orderBy(desc(adversarialRoles.briefedAt));
  if (roles.length === 0) return [];
  const briefings = await Promise.all(roles.map((role) => loadBriefingView(ctx, role)));
  await recordAudit(ctx, {
    action: 'adversarial.briefings_listed',
    targetType: AUDIT_TARGET_ROLE,
    context: { roleIds: roles.map((role) => role.id) },
  });
  return briefings.map((briefing) => ({ briefing, text: renderBriefingText(briefing) }));
}
