import { and, asc, count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { projectLinks } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { publishEvent } from '../events/bus';
import { loadManageableProject, lockProject, type ProjectRecord } from './access';
import { assertExactPermutation, MAX_REORDER_IDS, nextOrdinal } from './ordering';
import { projectEventBase } from './projects.service';
import { httpUrl, singleLine } from './schemas';

/** Links shown on a project page (repo, demo, docs …). */
export const MAX_PROJECT_LINKS = 12;

export type ProjectLinkRecord = typeof projectLinks.$inferSelect;

export const addProjectLinkSchema = z.object({
  projectId: z.uuid(),
  label: singleLine(48),
  url: httpUrl,
});

export const updateProjectLinkSchema = z
  .object({
    projectId: z.uuid(),
    linkId: z.uuid(),
    label: singleLine(48).optional(),
    url: httpUrl.optional(),
  })
  .refine((value) => value.label !== undefined || value.url !== undefined, 'Nothing to update.');

export const removeProjectLinkSchema = z.object({ projectId: z.uuid(), linkId: z.uuid() });

export const reorderProjectLinksSchema = z.object({
  projectId: z.uuid(),
  linkIds: z.array(z.uuid()).max(MAX_REORDER_IDS),
});

async function publishLinkChange(
  ctx: ServiceContext,
  project: ProjectRecord,
  change: 'link_added' | 'link_updated' | 'link_removed',
  label: string,
): Promise<void> {
  await publishEvent(ctx, {
    type: 'project.updated',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: { ...projectEventBase(project), change, label },
  });
}

/** IDOR guard: a link is only addressable through its own project. */
async function loadLink(
  ctx: ServiceContext,
  projectId: string,
  linkId: string,
): Promise<ProjectLinkRecord> {
  const [link] = await ctx.db
    .select()
    .from(projectLinks)
    .where(and(eq(projectLinks.id, linkId), eq(projectLinks.projectId, projectId)));
  if (!link) throw new NotFoundError('Link');
  return link;
}

export async function listProjectLinks(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectLinkRecord[]> {
  return ctx.db
    .select()
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.ordinal), asc(projectLinks.createdAt));
}

export async function addProjectLink(
  ctx: ServiceContext,
  input: z.input<typeof addProjectLinkSchema>,
): Promise<ProjectLinkRecord> {
  const data = parseInput(addProjectLinkSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  return withTransaction(ctx, async (t) => {
    await lockProject(t, project.id);
    const [stats] = await t.db
      .select({ total: count(), last: max(projectLinks.ordinal) })
      .from(projectLinks)
      .where(eq(projectLinks.projectId, project.id));
    if ((stats?.total ?? 0) >= MAX_PROJECT_LINKS) {
      throw new ConflictError(`Projects are capped at ${MAX_PROJECT_LINKS} links.`);
    }
    const [link] = await t.db
      .insert(projectLinks)
      .values({
        projectId: project.id,
        label: data.label,
        url: data.url,
        ordinal: nextOrdinal(stats?.last),
        createdAt: t.clock.now(),
      })
      .returning();
    await publishLinkChange(t, project, 'link_added', data.label);
    return link!;
  });
}

export async function updateProjectLink(
  ctx: ServiceContext,
  input: z.input<typeof updateProjectLinkSchema>,
): Promise<ProjectLinkRecord> {
  const data = parseInput(updateProjectLinkSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  const link = await loadLink(ctx, project.id, data.linkId);
  return withTransaction(ctx, async (t) => {
    const [updated] = await t.db
      .update(projectLinks)
      .set({ label: data.label ?? link.label, url: data.url ?? link.url })
      .where(eq(projectLinks.id, link.id))
      .returning();
    await publishLinkChange(t, project, 'link_updated', updated!.label);
    return updated!;
  });
}

export async function removeProjectLink(
  ctx: ServiceContext,
  input: z.input<typeof removeProjectLinkSchema>,
): Promise<void> {
  const data = parseInput(removeProjectLinkSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  const link = await loadLink(ctx, project.id, data.linkId);
  await withTransaction(ctx, async (t) => {
    await t.db.delete(projectLinks).where(eq(projectLinks.id, link.id));
    await publishLinkChange(t, project, 'link_removed', link.label);
  });
}

/** Set display order: `linkIds` must list every link of the project exactly once. */
export async function reorderProjectLinks(
  ctx: ServiceContext,
  input: z.input<typeof reorderProjectLinksSchema>,
): Promise<ProjectLinkRecord[]> {
  const data = parseInput(reorderProjectLinksSchema, input);
  const { project } = await loadManageableProject(ctx, data.projectId);
  return withTransaction(ctx, async (t) => {
    await lockProject(t, project.id);
    const existing = await listProjectLinks(t, project.id);
    assertExactPermutation(
      existing.map((link) => link.id),
      data.linkIds,
    );
    for (const [ordinal, id] of data.linkIds.entries()) {
      await t.db
        .update(projectLinks)
        .set({ ordinal })
        .where(and(eq(projectLinks.id, id), eq(projectLinks.projectId, project.id)));
    }
    return listProjectLinks(t, project.id);
  });
}
