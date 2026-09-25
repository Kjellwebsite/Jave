import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { eventTeamMembers, eventTeams, tournamentMatches } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { seededShuffle } from '../games/rng';
import {
  type BracketSlotName,
  buildSingleElimination,
  decideWinner,
  type MatchRef,
  roundName,
} from './bracket';
import { MAX_BRACKET_TEAMS, MIN_BRACKET_TEAMS } from './constants';
import { completeEventInTx } from './events.service';
import { requireViewer } from './guards';
import {
  assertEventStatus,
  type EventRecord,
  type EventStatus,
  loadEvent,
  OPEN_EVENT_STATUSES,
} from './records';
import { eventIdSchema, generateBracketSchema, reportMatchSchema } from './schemas';
import { hasBracket, type TeamRecord } from './teams.service';

type MatchRecord = typeof tournamentMatches.$inferSelect;

/**
 * Results can be reported until the final, including after the event itself
 * was completed (by staff or the sweep): the gathering may end before the
 * bracket does. Only a cancelled event freezes its bracket.
 */
const BRACKET_REPORTABLE_STATUSES: readonly EventStatus[] = ['scheduled', 'live', 'completed'];

export interface BracketTeamView {
  id: string;
  name: string;
  seed: number | null;
}

export interface MatchView {
  id: string;
  round: number;
  position: number;
  status: MatchRecord['status'];
  teamA: BracketTeamView | null;
  teamB: BracketTeamView | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerTeamId: string | null;
  nextMatchId: string | null;
  nextSlot: BracketSlotName | null;
  completedAt: Date | null;
}

export interface BracketView {
  eventId: string;
  state: 'none' | 'in_progress' | 'completed';
  rounds: { round: number; name: string; matches: MatchView[] }[];
  champion: BracketTeamView | null;
}

function orderTeams(
  teams: readonly TeamRecord[],
  seeding: 'seeded' | 'random',
  seed: string,
): TeamRecord[] {
  if (seeding === 'random') {
    return seededShuffle(
      [...teams].sort((x, y) => x.id.localeCompare(y.id)),
      seed,
    );
  }
  return [...teams].sort(
    (x, y) =>
      (x.seed ?? Number.MAX_SAFE_INTEGER) - (y.seed ?? Number.MAX_SAFE_INTEGER) ||
      x.name.localeCompare(y.name) ||
      x.id.localeCompare(y.id),
  );
}

const refKey = (ref: MatchRef) => `${ref.round}:${ref.position}`;

/**
 * Staff: build the single-elimination bracket from the event's teams. Byes
 * go to the top seeds and advance immediately. Teams are locked afterwards.
 */
export async function generateBracket(
  ctx: ServiceContext,
  input: z.input<typeof generateBracketSchema>,
): Promise<BracketView> {
  const data = parseInput(generateBracketSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  await withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    if (event.kind !== 'tournament') {
      throw new InvalidStateError('Brackets exist only for tournament events.');
    }
    assertEventStatus(event, OPEN_EVENT_STATUSES, 'This event has already ended.');
    if (await hasBracket(tx, event.id)) throw new ConflictError('The bracket already exists.');
    const teams = await tx.db.select().from(eventTeams).where(eq(eventTeams.eventId, event.id));
    if (teams.length < MIN_BRACKET_TEAMS || teams.length > MAX_BRACKET_TEAMS) {
      throw new InvalidStateError(
        `A bracket needs between ${MIN_BRACKET_TEAMS} and ${MAX_BRACKET_TEAMS} teams.`,
      );
    }
    const seed = data.seed ?? event.id;
    const ordered = orderTeams(teams, data.seeding, seed);
    for (const [index, team] of ordered.entries()) {
      await tx.db
        .update(eventTeams)
        .set({ seed: index + 1 })
        .where(eq(eventTeams.id, team.id));
    }
    const plan = buildSingleElimination(ordered.map((team) => team.id));
    const now = tx.clock.now();
    const ids = new Map<string, string>();
    for (const match of [...plan.matches].reverse()) {
      const [row] = await tx.db
        .insert(tournamentMatches)
        .values({
          eventId: event.id,
          round: match.round,
          position: match.position,
          teamAId: match.teamA,
          teamBId: match.teamB,
          status: match.status,
          winnerTeamId: match.winner,
          nextMatchId: match.next ? ids.get(refKey(match.next))! : null,
          nextSlot: match.next?.slot ?? null,
          completedAt: match.status === 'bye' ? now : null,
          createdAt: now,
        })
        .returning({ id: tournamentMatches.id });
      ids.set(refKey(match), row!.id);
    }
    await recordAudit(tx, {
      action: 'tournament.bracket_generated',
      targetType: 'event',
      targetId: event.id,
      context: { teams: teams.length, byes: plan.byes, seeding: data.seeding, seed },
    });
  });
  return loadBracketView(ctx, data.eventId);
}

async function lockMatch(tx: ServiceContext, matchId: string): Promise<MatchRecord> {
  const [row] = await tx.db
    .select()
    .from(tournamentMatches)
    .where(eq(tournamentMatches.id, matchId))
    .for('update');
  if (!row) throw new NotFoundError('Match');
  return row;
}

async function advanceWinner(tx: ServiceContext, match: MatchRecord, winnerId: string) {
  const next = await lockMatch(tx, match.nextMatchId!);
  const teamAId = match.nextSlot === 'a' ? winnerId : next.teamAId;
  const teamBId = match.nextSlot === 'b' ? winnerId : next.teamBId;
  await tx.db
    .update(tournamentMatches)
    .set({ teamAId, teamBId, status: teamAId && teamBId ? 'ready' : 'pending' })
    .where(eq(tournamentMatches.id, next.id));
}

/** Final placements: 1 champion, 2 finalist; everyone else by the round they fell in. */
async function finishTournament(tx: ServiceContext, event: EventRecord, final: MatchRecord) {
  const matches = await tx.db
    .select()
    .from(tournamentMatches)
    .where(eq(tournamentMatches.eventId, event.id));
  const eliminatedIn = new Map<string, number>();
  for (const match of matches) {
    if (match.status !== 'completed' || !match.winnerTeamId) continue;
    const loser = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
    if (loser) eliminatedIn.set(loser, match.round);
  }
  const roster = await tx.db
    .select({ teamId: eventTeamMembers.teamId, memberId: eventTeamMembers.memberId })
    .from(eventTeamMembers)
    .where(eq(eventTeamMembers.eventId, event.id));
  for (const entry of roster) {
    const champion = entry.teamId === final.winnerTeamId;
    const finalist = !champion && eliminatedIn.get(entry.teamId) === final.round;
    await publishEvent(tx, {
      type: 'tournament.completed',
      aggregateType: 'event',
      aggregateId: event.id,
      subjectMemberId: entry.memberId,
      payload: {
        teamId: entry.teamId,
        won: champion,
        placement: champion ? 1 : finalist ? 2 : null,
        eliminatedInRound: eliminatedIn.get(entry.teamId) ?? null,
        rounds: final.round,
      },
    });
  }
  if (OPEN_EVENT_STATUSES.includes(event.status)) {
    await completeEventInTx(tx, event, 'tournament');
  }
}

/**
 * Staff: record a result. The winner advances; reporting the final
 * completes the tournament and, if still open, its event. Results are final
 * once recorded.
 */
export async function reportMatch(
  ctx: ServiceContext,
  input: z.input<typeof reportMatchSchema>,
): Promise<BracketView> {
  const data = parseInput(reportMatchSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'tournament_match', id: data.matchId });
  const decision = decideWinner({
    scoreA: data.scoreA ?? null,
    scoreB: data.scoreB ?? null,
    winner: data.winner,
  });
  if ('error' in decision) {
    throw new ValidationError(decision.error, [{ path: 'winner', message: decision.error }]);
  }
  const eventId = await withTransaction(ctx, async (tx) => {
    const [peek] = await tx.db
      .select({ eventId: tournamentMatches.eventId })
      .from(tournamentMatches)
      .where(eq(tournamentMatches.id, data.matchId));
    if (!peek) throw new NotFoundError('Match');
    // Lock order: event, then matches — the same order every writer uses.
    const event = await loadEvent(tx, peek.eventId, { lock: true });
    assertEventStatus(event, BRACKET_REPORTABLE_STATUSES, 'This event was cancelled.');
    const match = await lockMatch(tx, data.matchId);
    if (match.status === 'completed' || match.status === 'bye') {
      throw new InvalidStateError('This match already has a result.');
    }
    if (match.status !== 'ready' || !match.teamAId || !match.teamBId) {
      throw new InvalidStateError('This match is waiting for its teams.');
    }
    const winnerId = decision.slot === 'a' ? match.teamAId : match.teamBId;
    const loserId = decision.slot === 'a' ? match.teamBId : match.teamAId;
    const now = tx.clock.now();
    const [completed] = await tx.db
      .update(tournamentMatches)
      .set({
        scoreA: data.scoreA ?? null,
        scoreB: data.scoreB ?? null,
        winnerTeamId: winnerId,
        status: 'completed',
        completedAt: now,
        reportedByUserId: actorUserId(ctx.actor),
      })
      .where(eq(tournamentMatches.id, match.id))
      .returning();
    await recordAudit(tx, {
      action: 'tournament.match_reported',
      targetType: 'tournament_match',
      targetId: match.id,
      context: {
        eventId: event.id,
        round: match.round,
        scoreA: data.scoreA ?? null,
        scoreB: data.scoreB ?? null,
        winnerTeamId: winnerId,
      },
    });
    await publishEvent(tx, {
      type: 'tournament.match_completed',
      aggregateType: 'event',
      aggregateId: event.id,
      payload: {
        matchId: match.id,
        round: match.round,
        winnerTeamId: winnerId,
        loserTeamId: loserId,
        scoreA: data.scoreA ?? null,
        scoreB: data.scoreB ?? null,
        final: match.nextMatchId === null,
      },
    });
    if (match.nextMatchId) await advanceWinner(tx, match, winnerId);
    else await finishTournament(tx, event, completed!);
    return event.id;
  });
  return loadBracketView(ctx, eventId);
}

async function loadBracketView(ctx: ServiceContext, eventId: string): Promise<BracketView> {
  const [matches, teams] = await Promise.all([
    ctx.db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.eventId, eventId))
      .orderBy(asc(tournamentMatches.round), asc(tournamentMatches.position)),
    ctx.db
      .select({ id: eventTeams.id, name: eventTeams.name, seed: eventTeams.seed })
      .from(eventTeams)
      .where(eq(eventTeams.eventId, eventId)),
  ]);
  if (matches.length === 0) return { eventId, state: 'none', rounds: [], champion: null };
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const team = (id: string | null) => (id ? (teamById.get(id) ?? null) : null);
  const totalRounds = Math.max(...matches.map((match) => match.round));
  const final = matches.find((match) => match.round === totalRounds)!;
  const rounds: BracketView['rounds'] = [];
  for (let round = 1; round <= totalRounds; round++) {
    rounds.push({
      round,
      name: roundName(round, totalRounds),
      matches: matches
        .filter((match) => match.round === round)
        .map((match) => ({
          id: match.id,
          round: match.round,
          position: match.position,
          status: match.status,
          teamA: team(match.teamAId),
          teamB: team(match.teamBId),
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          winnerTeamId: match.winnerTeamId,
          nextMatchId: match.nextMatchId,
          nextSlot: match.nextSlot,
          completedAt: match.completedAt,
        })),
    });
  }
  const done = final.status === 'completed';
  return {
    eventId,
    state: done ? 'completed' : 'in_progress',
    rounds,
    champion: done ? team(final.winnerTeamId) : null,
  };
}

export async function getBracket(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<BracketView> {
  requireViewer(ctx);
  const data = parseInput(eventIdSchema, input);
  await loadEvent(ctx, data.eventId);
  return loadBracketView(ctx, data.eventId);
}
