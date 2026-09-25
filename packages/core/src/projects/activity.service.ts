import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { domainEvents, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import type { DomainEventType } from '../events/catalog';
import {
  findProject,
  type ProjectAccess,
  type ProjectRecord,
  profileVisibleTo,
  resolveAccess,
} from './access';
import { REPO_PRIVATE_FLAG, redactRepoContent, repoContentVisible } from './project-events';
import type { PersonRef } from './queries.service';

/**
 * project.shipped is emitted once per member (for achievements); the feed
 * already shows the single project.status_changed that caused it.
 */
const FEED_EXCLUDED_TYPES: readonly DomainEventType[] = ['project.shipped'];

/**
 * Payload fields that hold member ids, per event type. They never reach the
 * viewer raw: each becomes a PersonRef under `people`, or null when that
 * member's profile is hidden from the viewer (no id leak, no oracle).
 */
const MEMBER_ID_FIELDS: Partial<Record<DomainEventType, readonly string[]>> = {
  'project.member_added': ['memberId'],
  'project.member_removed': ['memberId'],
  'project.member_role_changed': ['memberId'],
  'project.ownership_transferred': ['from', 'to'],
};
/** Fallback for event types not listed above. */
const DEFAULT_MEMBER_ID_FIELDS: readonly string[] = ['memberId'];

export interface ProjectActivityItem {
  id: number;
  type: string;
  occurredAt: Date;
  /** Null for system/integration events or when the actor's profile is hidden. */
  actor: PersonRef | null;
  /**
   * Members the event is about, keyed by the payload field that named them
   * (`memberId`, or `from`/`to` for ownership transfers). Null when hidden.
   */
  people: Record<string, PersonRef | null>;
  /**
   * Event payload without member ids. GitHub activity from a private
   * repository has its content fields nulled unless the project is private.
   */
  payload: Record<string, unknown>;
}

export const projectActivitySchema = pageSchema.extend({ projectId: z.uuid() });

interface MemberCard extends PersonRef {
  visibility: (typeof members.$inferSelect)['profileVisibility'];
  standing: (typeof members.$inferSelect)['standing'];
}

async function loadMemberCards(
  ctx: ServiceContext,
  memberIds: ReadonlySet<string>,
): Promise<Map<string, MemberCard>> {
  if (memberIds.size === 0) return new Map();
  const rows = await ctx.db
    .select({
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
      visibility: members.profileVisibility,
      standing: members.standing,
    })
    .from(members)
    .where(and(inArray(members.id, [...memberIds]), isNull(members.deletedAt)));
  return new Map(rows.map((row) => [row.memberId, row]));
}

/** Collaborators and staff see each other; everyone else respects profile privacy. */
function personFor(
  ctx: ServiceContext,
  access: ProjectAccess,
  card: MemberCard | undefined,
): PersonRef | null {
  if (!card) return null;
  const insider = access.staff || access.role !== null;
  if (!insider && !profileVisibleTo(ctx, card)) return null;
  return { memberId: card.memberId, handle: card.handle, displayName: card.displayName };
}

interface ProjectedPayload {
  payload: Record<string, unknown>;
  /** Payload field → member id. */
  memberRefs: [string, string][];
}

function projectPayload(
  type: string,
  raw: Record<string, unknown>,
  project: ProjectRecord,
): ProjectedPayload {
  const fields = MEMBER_ID_FIELDS[type as DomainEventType] ?? DEFAULT_MEMBER_ID_FIELDS;
  const memberRefs: [string, string][] = [];
  const kept = Object.entries(raw).filter(([key, value]) => {
    if (!fields.includes(key)) return true;
    if (typeof value === 'string') memberRefs.push([key, value]);
    return false;
  });
  const payload = Object.fromEntries(kept);
  // Re-checked at read time: the project may have left 'private' since the event.
  const hideRepoContent =
    payload[REPO_PRIVATE_FLAG] === true && !repoContentVisible(true, project.visibility);
  return { payload: hideRepoContent ? redactRepoContent(payload) : payload, memberRefs };
}

/** Activity feed built from the project's domain events, newest first. */
export async function getProjectActivity(
  ctx: ServiceContext,
  input: z.input<typeof projectActivitySchema>,
): Promise<Page<ProjectActivityItem>> {
  const q = parseInput(projectActivitySchema, input);
  const project = await findProject(ctx, q.projectId);
  if (!project) throw new NotFoundError('Project');
  const access = await resolveAccess(ctx, project);
  if (!access.canView) throw new NotFoundError('Project');

  const where = and(
    eq(domainEvents.aggregateType, 'project'),
    eq(domainEvents.aggregateId, project.id),
    sql`${domainEvents.type} not in (${sql.join(
      FEED_EXCLUDED_TYPES.map((type) => sql`${type}`),
      sql`, `,
    )})`,
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        id: domainEvents.id,
        type: domainEvents.type,
        occurredAt: domainEvents.occurredAt,
        payload: domainEvents.payload,
        actorMemberId: members.id,
      })
      .from(domainEvents)
      .leftJoin(members, eq(members.userId, domainEvents.actorUserId))
      .where(where)
      .orderBy(desc(domainEvents.occurredAt), desc(domainEvents.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(domainEvents)
      .where(where),
  ]);

  const projected = rows.map((row) => projectPayload(row.type, row.payload, project));
  const referenced = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.actorMemberId) referenced.add(row.actorMemberId);
    for (const [, memberId] of projected[index]!.memberRefs) referenced.add(memberId);
  }
  const cards = await loadMemberCards(ctx, referenced);
  const person = (memberId: string | null) =>
    memberId ? personFor(ctx, access, cards.get(memberId)) : null;

  const items = rows.map((row, index) => {
    const { payload, memberRefs } = projected[index]!;
    return {
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt,
      actor: person(row.actorMemberId),
      people: Object.fromEntries(memberRefs.map(([field, memberId]) => [field, person(memberId)])),
      payload,
    };
  });
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
