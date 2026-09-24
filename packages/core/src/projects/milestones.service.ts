import { and, asc, count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { projectMilestones } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { publishEvent } from '../events/bus';
import { loadManageableProject, lockProject, type ProjectRecord } from './access';
import { assertExactPermutation, MAX_REORDER_IDS, nextOrdinal } from './ordering';
import { projectEventBase } from './projects.service';
import { plainText, plausibleDate, singleLine } from './schemas';

export const MAX_PROJECT_MILESTONES = 50;

export type MilestoneRecord = typeof projectMilestones.$inferSelect;
export type MilestoneStatus = MilestoneRecord['status'];

export const addMilestoneSchema = z.object({
  projectId: z.uuid(),
  title: singleLine(120),
  description: plainText(2000).optional(),
  dueAt: plausibleDate.optional(),
});

/** Status here covers planning moves; use completeMilestone to mark one done. */
export const updateMilestoneSchema = z
  .object({
    projectId: z.uuid(),
    milestoneId: z.uuid(),
    title: singleLine(120).optional(),
    description: plainText(2000).nullable().optional(),
    dueAt: plausibleDate.nullable().optional(),
    status: z.enum(['planned', 'active', 'dropped']).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.dueAt !== undefined ||
      value.status !== undefined,
    'Nothing to update.',
  );

export const milestoneRefSchema = z.object({ projectId: z.uuid(), milestoneId: z.uuid() });

export const reorderMilestonesSchema = z.object({
  projectId: z.uuid(),
  milestoneIds: z.array(z.uuid()).max(MAX_REORDER_IDS),
});

/** IDOR guard: a milestone is only addressable through its own project. */
async function loadMilestone(
  ctx: ServiceContext,
  projectId: string,
  milestoneId: string,
): Promise<MilestoneRecord> {
  const [row] = await ctx.db
    .select()
    .from(projectMilestones)
    .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId)));
  if (!row) throw new NotFoundError('Milestone');
  return row;
}

async function publishMilestoneChange(
  ctx: ServiceContext,
  project: ProjectRecord,
  change: 'milestone_added' | 'milestone_updated' | 'milestone_removed',
  milestone: Pick<MilestoneRecord, 'id' | 'title'>,
): Promise<void> {
  await publishEvent(ctx, {
    type: 'project.updated',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: {
      ...projectEventBase(project),
      change,
      milestoneId: milestone.id,
      title: milestone.title,
    },
  });
}

export async function listMilestones(
  ctx: ServiceContext,
  projectId: string,
): Promise<MilestoneRecord[]> {
  return ctx.db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.ordinal), asc(projectMilestones.createdAt));
}

export async function addMilestone(
  ctx: ServiceContext,
  input: z.input<typeof addMilestoneSchema>,
): Promise<MilestoneRecord> {
  const data = parseInput(addMilestoneSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  return withTransaction(ctx, async (t) => {
    await lockProject(t, project.id);
    const [stats] = await t.db
      .select({ total: count(), last: max(projectMilestones.ordinal) })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, project.id));
    if ((stats?.total ?? 0) >= MAX_PROJECT_MILESTONES) {
      throw new ConflictError(`Projects are capped at ${MAX_PROJECT_MILESTONES} milestones.`);
    }
    const now = t.clock.now();
    const [milestone] = await t.db
      .insert(projectMilestones)
      .values({
        projectId: project.id,
        title: data.title,
        description: data.description || null,
        dueAt: data.dueAt ?? null,
        ordinal: nextOrdinal(stats?.last),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await publishMilestoneChange(t, project, 'milestone_added', milestone!);
    return milestone!;
  });
}

/** Edit a milestone. Moving a done milestone back to planned/active reopens it. */
export async function updateMilestone(
  ctx: ServiceContext,
  input: z.input<typeof updateMilestoneSchema>,
): Promise<MilestoneRecord> {
  const data = parseInput(updateMilestoneSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  const milestone = await loadMilestone(ctx, project.id, data.milestoneId);
  const reopening = data.status !== undefined && milestone.status === 'done';
  return withTransaction(ctx, async (t) => {
    const [updated] = await t.db
      .update(projectMilestones)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(reopening ? { completedAt: null } : {}),
        updatedAt: t.clock.now(),
      })
      .where(eq(projectMilestones.id, milestone.id))
      .returning();
    await publishMilestoneChange(t, project, 'milestone_updated', updated!);
    return updated!;
  });
}

/** Mark a planned/active milestone done. */
export async function completeMilestone(
  ctx: ServiceContext,
  input: z.input<typeof milestoneRefSchema>,
): Promise<MilestoneRecord> {
  const data = parseInput(milestoneRefSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  const milestone = await loadMilestone(ctx, project.id, data.milestoneId);
  if (milestone.status === 'done') throw new InvalidStateError('This milestone is already done.');
  if (milestone.status === 'dropped') {
    throw new InvalidStateError('Dropped milestones must be re-planned before completion.');
  }
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [updated] = await t.db
      .update(projectMilestones)
      .set({ status: 'done', completedAt: now, updatedAt: now })
      .where(
        and(eq(projectMilestones.id, milestone.id), eq(projectMilestones.status, milestone.status)),
      )
      .returning();
    if (!updated) throw new ConflictError('The milestone changed in the meantime.');
    await publishEvent(t, {
      type: 'project.milestone_completed',
      aggregateType: 'project',
      aggregateId: project.id,
      payload: { ...projectEventBase(project), milestoneId: milestone.id, title: milestone.title },
    });
    return updated;
  });
}

export async function removeMilestone(
  ctx: ServiceContext,
  input: z.input<typeof milestoneRefSchema>,
): Promise<void> {
  const data = parseInput(milestoneRefSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  const milestone = await loadMilestone(ctx, project.id, data.milestoneId);
  await withTransaction(ctx, async (t) => {
    await t.db.delete(projectMilestones).where(eq(projectMilestones.id, milestone.id));
    await publishMilestoneChange(t, project, 'milestone_removed', milestone);
  });
}

/** Set display order: `milestoneIds` must list every milestone of the project exactly once. */
export async function reorderMilestones(
  ctx: ServiceContext,
  input: z.input<typeof reorderMilestonesSchema>,
): Promise<MilestoneRecord[]> {
  const data = parseInput(reorderMilestonesSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  return withTransaction(ctx, async (t) => {
    await lockProject(t, project.id);
    const existing = await listMilestones(t, project.id);
    assertExactPermutation(
      existing.map((milestone) => milestone.id),
      data.milestoneIds,
    );
    for (const [ordinal, id] of data.milestoneIds.entries()) {
      await t.db
        .update(projectMilestones)
        .set({ ordinal })
        .where(and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, project.id)));
    }
    return listMilestones(t, project.id);
  });
}
