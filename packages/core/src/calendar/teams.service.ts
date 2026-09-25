import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  eventRsvps,
  eventTeamMembers,
  eventTeams,
  members,
  tournamentMatches,
} from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { authorize } from '../permissions/authorize';
import { MAX_TEAMS_PER_EVENT, RANDOM_TEAM_NAME_PREFIX } from './constants';
import { requireViewer } from './guards';
import { assertEventStatus, type EventRecord, loadEvent, OPEN_EVENT_STATUSES } from './records';
import { createTeamSchema, eventIdSchema, randomTeamsSchema, teamIdSchema } from './schemas';
import { drawTeams, nextTeamNames } from './team-draw';

export type TeamRecord = typeof eventTeams.$inferSelect;

export interface TeamMemberView {
  memberId: string;
  handle: string;
  displayName: string;
}

export interface TeamView {
  id: string;
  eventId: string;
  name: string;
  seed: number | null;
  members: TeamMemberView[];
}

export async function hasBracket(ctx: Pick<ServiceContext, 'db'>, eventId: string) {
  const [row] = await ctx.db
    .select({ id: tournamentMatches.id })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.eventId, eventId))
    .limit(1);
  return Boolean(row);
}

/** Teams can change only while the event is open and before the bracket exists. */
async function lockEventForTeams(tx: ServiceContext, eventId: string): Promise<EventRecord> {
  const event = await loadEvent(tx, eventId, { lock: true });
  assertEventStatus(event, OPEN_EVENT_STATUSES, 'This event has already ended.');
  if (await hasBracket(tx, event.id)) {
    throw new InvalidStateError('Teams are locked once the bracket exists.');
  }
  return event;
}

async function teamCount(tx: ServiceContext, eventId: string): Promise<number> {
  const [row] = await tx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(eventTeams)
    .where(eq(eventTeams.eventId, eventId));
  return row?.total ?? 0;
}

async function insertTeam(
  tx: ServiceContext,
  eventId: string,
  team: { name: string; seed: number | null; memberIds: readonly string[] },
): Promise<TeamRecord> {
  try {
    const [row] = await tx.db
      .insert(eventTeams)
      .values({ eventId, name: team.name, seed: team.seed, createdAt: tx.clock.now() })
      .returning();
    await tx.db
      .insert(eventTeamMembers)
      .values(team.memberIds.map((memberId) => ({ teamId: row!.id, eventId, memberId })));
    return row!;
  } catch (error) {
    if (isUniqueViolation(error, 'event_teams_name_uq')) {
      throw new ConflictError('A team with that name already exists for this event.');
    }
    if (isUniqueViolation(error)) {
      throw new ConflictError('A member is already on another team for this event.');
    }
    throw error;
  }
}

export async function listTeamsForEvent(
  ctx: Pick<ServiceContext, 'db'>,
  eventId: string,
): Promise<TeamView[]> {
  const teams = await ctx.db
    .select()
    .from(eventTeams)
    .where(eq(eventTeams.eventId, eventId))
    .orderBy(sql`${eventTeams.seed} asc nulls last`, asc(eventTeams.name));
  if (teams.length === 0) return [];
  const roster = await ctx.db
    .select({
      teamId: eventTeamMembers.teamId,
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
    })
    .from(eventTeamMembers)
    .innerJoin(members, eq(members.id, eventTeamMembers.memberId))
    .where(eq(eventTeamMembers.eventId, eventId))
    .orderBy(asc(members.displayName));
  return teams.map((team) => ({
    id: team.id,
    eventId: team.eventId,
    name: team.name,
    seed: team.seed,
    members: roster
      .filter((entry) => entry.teamId === team.id)
      .map(({ memberId, handle, displayName }) => ({ memberId, handle, displayName })),
  }));
}

/** Staff: create one team from named members. A member sits on one team per event. */
export async function createTeam(
  ctx: ServiceContext,
  input: z.input<typeof createTeamSchema>,
): Promise<TeamView> {
  const data = parseInput(createTeamSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  const team = await withTransaction(ctx, async (tx) => {
    const event = await lockEventForTeams(tx, data.eventId);
    if ((await teamCount(tx, event.id)) >= MAX_TEAMS_PER_EVENT) {
      throw new InvalidStateError(`An event can have at most ${MAX_TEAMS_PER_EVENT} teams.`);
    }
    const found = await tx.db
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, data.memberIds), isNull(members.deletedAt)));
    if (found.length !== data.memberIds.length) throw new NotFoundError('Member');
    const taken = await tx.db
      .select({ memberId: eventTeamMembers.memberId })
      .from(eventTeamMembers)
      .where(
        and(
          eq(eventTeamMembers.eventId, event.id),
          inArray(eventTeamMembers.memberId, data.memberIds),
        ),
      );
    if (taken.length > 0) {
      throw new ConflictError('A member is already on another team for this event.');
    }
    const created = await insertTeam(tx, event.id, {
      name: data.name,
      seed: data.seed ?? null,
      memberIds: data.memberIds,
    });
    await recordAudit(tx, {
      action: 'event.team_created',
      targetType: 'event',
      targetId: event.id,
      context: { teamId: created.id, size: data.memberIds.length },
    });
    return created;
  });
  const views = await listTeamsForEvent(ctx, team.eventId);
  return views.find((view) => view.id === team.id)!;
}

/**
 * Staff: draw teams from 'going' RSVPs not yet on a team. Deterministic for a
 * given seed (default: the event id) and set of members.
 */
export async function createRandomTeams(
  ctx: ServiceContext,
  input: z.input<typeof randomTeamsSchema>,
): Promise<TeamView[]> {
  const data = parseInput(randomTeamsSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  const createdIds = await withTransaction(ctx, async (tx) => {
    const event = await lockEventForTeams(tx, data.eventId);
    const assigned = tx.db
      .select({ memberId: eventTeamMembers.memberId })
      .from(eventTeamMembers)
      .where(eq(eventTeamMembers.eventId, event.id));
    const pool = await tx.db
      .select({ memberId: eventRsvps.memberId })
      .from(eventRsvps)
      .innerJoin(members, eq(members.id, eventRsvps.memberId))
      .where(
        and(
          eq(eventRsvps.eventId, event.id),
          eq(eventRsvps.status, 'going'),
          isNull(members.deletedAt),
          notInArray(eventRsvps.memberId, assigned),
        ),
      );
    if (pool.length === 0) {
      throw new InvalidStateError('No unassigned members are going to this event.');
    }
    const seed = data.seed ?? event.id;
    const drawn = drawTeams(
      pool.map((entry) => entry.memberId),
      data.teamSize,
      seed,
    );
    const existing = await tx.db
      .select({ name: eventTeams.name })
      .from(eventTeams)
      .where(eq(eventTeams.eventId, event.id));
    if (existing.length + drawn.length > MAX_TEAMS_PER_EVENT) {
      throw new InvalidStateError(`An event can have at most ${MAX_TEAMS_PER_EVENT} teams.`);
    }
    const names = nextTeamNames(
      RANDOM_TEAM_NAME_PREFIX,
      drawn.length,
      new Set(existing.map((row) => row.name)),
    );
    const ids: string[] = [];
    for (const [index, memberIds] of drawn.entries()) {
      const team = await insertTeam(tx, event.id, { name: names[index]!, seed: null, memberIds });
      ids.push(team.id);
    }
    await recordAudit(tx, {
      action: 'event.teams_drawn',
      targetType: 'event',
      targetId: event.id,
      context: { teams: drawn.length, members: pool.length, teamSize: data.teamSize, seed },
    });
    return ids;
  });
  const views = await listTeamsForEvent(ctx, data.eventId);
  return views.filter((view) => createdIds.includes(view.id));
}

/** Staff: remove a team (before the bracket exists). */
export async function deleteTeam(
  ctx: ServiceContext,
  input: z.input<typeof teamIdSchema>,
): Promise<void> {
  const data = parseInput(teamIdSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event_team', id: data.teamId });
  await withTransaction(ctx, async (tx) => {
    const [team] = await tx.db.select().from(eventTeams).where(eq(eventTeams.id, data.teamId));
    if (!team) throw new NotFoundError('Team');
    await lockEventForTeams(tx, team.eventId);
    await tx.db.delete(eventTeams).where(eq(eventTeams.id, team.id));
    await recordAudit(tx, {
      action: 'event.team_deleted',
      targetType: 'event',
      targetId: team.eventId,
      context: { teamId: team.id, name: team.name },
    });
  });
}

export async function listTeams(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<TeamView[]> {
  requireViewer(ctx);
  const data = parseInput(eventIdSchema, input);
  await loadEvent(ctx, data.eventId);
  return listTeamsForEvent(ctx, data.eventId);
}
