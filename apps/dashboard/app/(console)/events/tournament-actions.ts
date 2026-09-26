'use server';

import { revalidatePath } from 'next/cache';
import { calendar, isUuid, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';

const SEEDINGS = ['seeded', 'random'] as const;
const WINNER_CHOICES = ['score', 'a', 'b'] as const;
const WHOLE_NUMBER = /^\d{1,7}$/;

function uuidFrom(data: FormData, name: string, what: string): string {
  const value = formString(data, name);
  if (!isUuid(value)) throw new ValidationError(`Unknown ${what}.`);
  return value;
}

function refresh(eventId: string): void {
  revalidatePath(`/events/${eventId}`);
}

function score(data: FormData, name: 'scoreA' | 'scoreB'): number | undefined {
  const raw = formString(data, name).trim();
  if (raw === '') return undefined;
  if (!WHOLE_NUMBER.test(raw)) {
    throw new ValidationError(`${name}: must be a whole number`, [
      { path: name, message: 'must be a whole number' },
    ]);
  }
  return Number(raw);
}

export async function drawTeamsAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'event.draw_teams',
    async (ctx) => {
      const eventId = uuidFrom(data, 'eventId', 'event');
      const teamSize = Number(formString(data, 'teamSize'));
      const teams = await calendar.createRandomTeams(ctx, { eventId, teamSize });
      refresh(eventId);
      const members = teams.reduce((total, team) => total + team.members.length, 0);
      return `TEAMS DRAWN — ${teams.length} ${teams.length === 1 ? 'team' : 'teams'}, ${members} members.`;
    },
    { fieldNames: ['teamSize'] },
  );
}

export async function deleteTeamAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('event.delete_team', async (ctx) => {
    const eventId = uuidFrom(data, 'eventId', 'event');
    await calendar.deleteTeam(ctx, { teamId: uuidFrom(data, 'teamId', 'team') });
    refresh(eventId);
    return 'TEAM REMOVED — its members can be drawn again.';
  });
}

export async function generateBracketAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'event.generate_bracket',
    async (ctx) => {
      const eventId = uuidFrom(data, 'eventId', 'event');
      const seeding = formEnum(data, 'seeding', SEEDINGS);
      if (!seeding) throw new ValidationError('Choose seeded or random.');
      const bracket = await calendar.generateBracket(ctx, { eventId, seeding });
      refresh(eventId);
      const matches = bracket.rounds.reduce((total, round) => total + round.matches.length, 0);
      return `BRACKET GENERATED — ${bracket.rounds.length} rounds, ${matches} matches. Teams are locked.`;
    },
    { fieldNames: ['seeding'] },
  );
}

export async function reportMatchAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'event.report_match',
    async (ctx) => {
      const matchId = uuidFrom(data, 'matchId', 'match');
      const winner = formEnum(data, 'winner', WINNER_CHOICES);
      if (!winner) throw new ValidationError('Choose how the winner is decided.');
      const bracket = await calendar.reportMatch(ctx, {
        matchId,
        scoreA: score(data, 'scoreA'),
        scoreB: score(data, 'scoreB'),
        winner: winner === 'score' ? undefined : winner,
      });
      refresh(bracket.eventId);
      const match = bracket.rounds.flatMap((round) => round.matches).find((m) => m.id === matchId);
      const won = match?.winnerTeamId === match?.teamA?.id ? match?.teamA : match?.teamB;
      const champion = bracket.champion ? ` CHAMPION — ${bracket.champion.name}.` : '';
      return `RESULT RECORDED — ${won?.name ?? 'Winner'} advances.${champion}`;
    },
    { fieldNames: ['scoreA', 'scoreB', 'winner'] },
  );
}
