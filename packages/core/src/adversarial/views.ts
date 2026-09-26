import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  adversarialEvaluations,
  adversarialObservations,
  adversarialTriggers,
  members,
  trials,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { buildBriefing, buildDebrief, type BriefingView, type DebriefView } from './briefing';
import { countOutcomes } from './scoring';
import { loadTeam } from './guards';
import { type Outcome, type RoleRecord, stoppedEarly, type Technique } from './state';

export type EvaluationRecord = typeof adversarialEvaluations.$inferSelect;

interface RoleHeader {
  trial: { number: number; title: string };
  team: { name: string; discordChannelId: string | null } | null;
  scenario: { title: string; technique: Technique };
  operative: { displayName: string };
}

/** The scenario as authorized: the role's planning-time snapshot, never the live library row. */
export function scenarioSnapshot(
  role: Pick<RoleRecord, 'scenarioTitle' | 'technique'>,
): RoleHeader['scenario'] {
  return { title: role.scenarioTitle, technique: role.technique };
}

/** Trial, team, scenario and operative labels for a role. */
export async function loadRoleHeader(ctx: ServiceContext, role: RoleRecord): Promise<RoleHeader> {
  const [row] = await ctx.db
    .select({
      trialNumber: trials.number,
      trialTitle: trials.title,
      operativeName: members.displayName,
    })
    .from(trials)
    .innerJoin(members, eq(members.id, role.operativeMemberId))
    .where(eq(trials.id, role.trialId));
  if (!row) throw new NotFoundError('Trial');
  const team = role.teamId ? await loadTeam(ctx, role.teamId) : null;
  return {
    trial: { number: row.trialNumber, title: row.trialTitle },
    team: team ? { name: team.name, discordChannelId: team.discordChannelId } : null,
    scenario: scenarioSnapshot(role),
    operative: { displayName: row.operativeName },
  };
}

/**
 * A role's triggers, oldest first. `approved` is what the operative may see:
 * pending triggers never reach a briefing.
 */
export async function loadTriggers(
  ctx: ServiceContext,
  roleId: string,
  which: 'all' | 'approved' = 'all',
) {
  return ctx.db
    .select()
    .from(adversarialTriggers)
    .where(
      and(
        eq(adversarialTriggers.roleId, roleId),
        which === 'approved' ? isNotNull(adversarialTriggers.approvedAt) : undefined,
      ),
    )
    .orderBy(asc(adversarialTriggers.createdAt), asc(adversarialTriggers.id));
}

export async function loadOutcomes(ctx: ServiceContext, roleId: string): Promise<Outcome[]> {
  const rows = await ctx.db
    .select({ outcome: adversarialObservations.outcome })
    .from(adversarialObservations)
    .where(eq(adversarialObservations.roleId, roleId));
  return rows.map((row) => row.outcome);
}

export async function loadEvaluation(
  ctx: ServiceContext,
  roleId: string,
): Promise<EvaluationRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(adversarialEvaluations)
    .where(eq(adversarialEvaluations.roleId, roleId));
  return row ?? null;
}

/** The operative's briefing. Never includes anything about other roles. */
export async function loadBriefingView(
  ctx: ServiceContext,
  role: RoleRecord,
): Promise<BriefingView> {
  const [header, triggers] = await Promise.all([
    loadRoleHeader(ctx, role),
    loadTriggers(ctx, role.id, 'approved'),
  ]);
  return buildBriefing({
    roleId: role.id,
    status: role.status,
    revision: role.briefingRevision,
    trial: header.trial,
    team: header.team ? { name: header.team.name } : null,
    scenario: header.scenario,
    objective: role.objective,
    sandboxAssets: role.sandboxAssets,
    guardrails: role.guardrails,
    triggers: triggers.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      plannedFor: t.plannedFor,
      firedAt: t.firedAt,
    })),
  });
}

/** The team debrief, or null when no evaluation with a debrief exists yet. */
export async function loadDebriefView(
  ctx: ServiceContext,
  role: RoleRecord,
): Promise<{ view: DebriefView; channelId: string | null } | null> {
  const evaluation = await loadEvaluation(ctx, role.id);
  if (!evaluation?.debrief) return null;
  const [header, outcomes] = await Promise.all([
    loadRoleHeader(ctx, role),
    loadOutcomes(ctx, role.id),
  ]);
  const view = buildDebrief({
    roleId: role.id,
    trial: header.trial,
    team: header.team ? { name: header.team.name } : null,
    scenario: header.scenario,
    operative: header.operative,
    securityCultureScore: evaluation.securityCultureScore,
    outcomes: countOutcomes(outcomes),
    debrief: evaluation.debrief,
    stoppedEarly: stoppedEarly(role),
  });
  return { view, channelId: header.team?.discordChannelId ?? null };
}
