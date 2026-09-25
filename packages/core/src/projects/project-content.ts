import { asc, eq } from 'drizzle-orm';
import { projectLinks, projectMilestones } from '@jave/database';
import type { ServiceContext } from '../kernel/context';

/**
 * Unchecked readers for a project's links and milestones. Internal: they
 * are not exported from the module index, and every caller must already
 * hold a visibility-checked ProjectAccess (or a write lock on the project).
 * Public reads go through listProjectLinks / listMilestones / getProject.
 */

export type ProjectLinkRecord = typeof projectLinks.$inferSelect;
export type MilestoneRecord = typeof projectMilestones.$inferSelect;

export async function readProjectLinks(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectLinkRecord[]> {
  return ctx.db
    .select()
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.ordinal), asc(projectLinks.createdAt));
}

export async function readMilestones(
  ctx: ServiceContext,
  projectId: string,
): Promise<MilestoneRecord[]> {
  return ctx.db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.ordinal), asc(projectMilestones.createdAt));
}
