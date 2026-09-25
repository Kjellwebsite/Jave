import { and, count, eq } from 'drizzle-orm';
import { contributions, projects } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { DAY } from '../kernel/clock';
import { ConflictError } from '../kernel/errors';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import type { ProjectRecord } from './access';
import { projectEventBase } from './project-events';
import { activeProjectMembers, notifyProjectMembers, shipCreditEligible } from './recipients';
import { isFirstShip, type ProjectStatus, STATUS_LABELS } from './status';

/**
 * Write half of changeProjectStatus. Internal (not exported from the module
 * index): callers have already authorized the actor and checked the
 * transition against `snapshot`. The update only applies while the stored
 * status still equals the snapshot's, so two writers acting on the same
 * stale read can never both apply (e.g. a double project.shipped).
 */
export async function applyStatusChange(
  ctx: ServiceContext,
  snapshot: ProjectRecord,
  to: ProjectStatus,
): Promise<ProjectRecord> {
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const firstShip = isFirstShip(to, snapshot.shippedAt);
    const archiving = to === 'archived';
    const [updated] = await t.db
      .update(projects)
      .set({
        status: to,
        updatedAt: now,
        ...(firstShip ? { shippedAt: now } : {}),
        ...(archiving ? { archivedAt: now, archivedFromStatus: snapshot.status } : {}),
      })
      .where(and(eq(projects.id, snapshot.id), eq(projects.status, snapshot.status)))
      .returning();
    if (!updated) {
      throw new ConflictError('The project changed in the meantime. Reload and try again.');
    }
    const eventId = await publishEvent(t, {
      type: 'project.status_changed',
      aggregateType: 'project',
      aggregateId: snapshot.id,
      payload: { ...projectEventBase(updated), from: snapshot.status, to },
    });
    if (firstShip) await emitShipped(t, updated, now);
    if (archiving) {
      await recordAudit(t, {
        action: 'project.archived',
        targetType: 'project',
        targetId: snapshot.id,
        context: { from: snapshot.status },
      });
    }
    await notifyProjectMembers(t, updated, {
      title: to === 'shipped' ? 'PROJECT SHIPPED' : 'PROJECT UPDATE',
      body: `${updated.title} — now ${STATUS_LABELS[to]}.`,
      dedupeKey: `project:${snapshot.id}:status:${eventId}`,
      data: { from: snapshot.status, to },
    });
    return updated;
  });
}

/** Verified contributions on a project, per member. */
async function verifiedContributionCounts(
  ctx: ServiceContext,
  projectId: string,
): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ memberId: contributions.memberId, value: count() })
    .from(contributions)
    .where(and(eq(contributions.projectId, projectId), eq(contributions.status, 'verified')))
    .groupBy(contributions.memberId);
  return new Map(rows.map((row) => [row.memberId, row.value]));
}

/**
 * One project.shipped per active member eligible for credit (banned and
 * quarantined members get none). The payload carries the evidence an
 * achievement needs to tell real work from a throwaway ship.
 */
async function emitShipped(ctx: ServiceContext, project: ProjectRecord, now: Date): Promise<void> {
  const team = await activeProjectMembers(ctx, project.id);
  const credited = team.filter((member) => shipCreditEligible(member.standing));
  const projectAgeDays = Math.floor((now.getTime() - project.createdAt.getTime()) / DAY);
  const verified = await verifiedContributionCounts(ctx, project.id);
  const verifiedContributions = [...verified.values()].reduce((sum, value) => sum + value, 0);
  for (const member of credited) {
    await publishEvent(ctx, {
      type: 'project.shipped',
      aggregateType: 'project',
      aggregateId: project.id,
      subjectMemberId: member.memberId,
      payload: {
        ...projectEventBase(project),
        role: member.role,
        teamSize: team.length,
        projectAgeDays,
        verifiedContributions,
        memberVerifiedContributions: verified.get(member.memberId) ?? 0,
      },
    });
  }
}
