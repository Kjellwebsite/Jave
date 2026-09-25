import { and, eq, inArray, isNull } from 'drizzle-orm';
import { members, projectMembers } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { notify } from '../notifications/notifications.service';
import type { ProjectRecord, ProjectRole } from './access';

export interface ActiveProjectMember {
  memberId: string;
  userId: string;
  role: ProjectRole;
  joinedAt: Date;
}

export async function activeProjectMembers(
  ctx: ServiceContext,
  projectId: string,
): Promise<ActiveProjectMember[]> {
  return ctx.db
    .select({
      memberId: projectMembers.memberId,
      userId: members.userId,
      role: projectMembers.role,
      joinedAt: projectMembers.joinedAt,
    })
    .from(projectMembers)
    .innerJoin(members, eq(members.id, projectMembers.memberId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        isNull(projectMembers.leftAt),
        isNull(members.deletedAt),
      ),
    );
}

export async function userIdOfMember(
  ctx: ServiceContext,
  memberId: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.userId ?? null;
}

export async function userIdsOfMembers(
  ctx: ServiceContext,
  memberIds: readonly string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: members.id, userId: members.userId })
    .from(members)
    .where(inArray(members.id, [...memberIds]));
  return new Map(rows.map((row) => [row.id, row.userId]));
}

/** Dashboard link for a project, when the deployment has a public URL. */
export function projectUrl(ctx: ServiceContext, slug: string): string | undefined {
  const base = ctx.config.publicUrl?.replace(/\/+$/, '');
  return base ? `${base}/projects/${encodeURIComponent(slug)}` : undefined;
}

/**
 * Notify every active project member (except the actor) about a project fact.
 * `dedupeKey` identifies the fact; the recipient is appended per member.
 */
export async function notifyProjectMembers(
  ctx: ServiceContext,
  project: ProjectRecord,
  message: { title: string; body: string; dedupeKey: string; data?: Record<string, unknown> },
): Promise<number> {
  const actorMemberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  const recipients = (await activeProjectMembers(ctx, project.id)).filter(
    (member) => member.memberId !== actorMemberId,
  );
  for (const recipient of recipients) {
    await notify(ctx, {
      recipientUserId: recipient.userId,
      type: 'project.updated',
      title: message.title,
      body: message.body,
      url: projectUrl(ctx, project.slug),
      data: { projectId: project.id, ...message.data },
      dedupeKey: `${message.dedupeKey}:${recipient.memberId}`,
    });
  }
  return recipients.length;
}
