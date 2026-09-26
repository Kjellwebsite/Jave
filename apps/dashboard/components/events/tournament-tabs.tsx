import { Swords, UsersRound } from 'lucide-react';
import { calendar, type ServiceContext } from '@jave/core';
import { Callout, Card, EmptyState } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { BracketView } from './bracket-view';
import { DrawTeamsDialog, GenerateBracketDialog } from './team-controls';
import { TeamsList } from './teams-list';

const isOpen = (event: calendar.EventView) =>
  event.status === 'scheduled' || event.status === 'live';

export interface TeamsTabProps {
  ctx: ServiceContext;
  event: calendar.EventView;
  staff: boolean;
  drawAction: FormAction;
  deleteAction: FormAction;
}

/** Teams: everyone sees them; staff draw and dissolve them until a bracket locks them. */
export async function TeamsTab({ ctx, event, staff, drawAction, deleteAction }: TeamsTabProps) {
  const [teams, bracket] = await Promise.all([
    calendar.listTeams(ctx, { eventId: event.id }),
    calendar.getBracket(ctx, { eventId: event.id }),
  ]);
  const editable = staff && isOpen(event) && bracket.state === 'none';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-subtle">
          {bracket.state === 'none'
            ? 'Teams are drawn from members who are GOING. Sizes differ by at most one.'
            : 'Teams are locked: the bracket exists.'}
        </p>
        {editable ? (
          <DrawTeamsDialog eventId={event.id} available={event.counts.going} action={drawAction} />
        ) : null}
      </div>
      {teams.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={UsersRound}
            title="NO TEAMS YET"
            description={
              editable
                ? 'Draw random teams from GOING members, or wait for more responses.'
                : 'Teams appear here once staff draw them.'
            }
          />
        </Card>
      ) : (
        <TeamsList eventId={event.id} teams={teams} deleteAction={editable ? deleteAction : null} />
      )}
    </div>
  );
}

export interface BracketTabProps {
  ctx: ServiceContext;
  event: calendar.EventView;
  staff: boolean;
  generateAction: FormAction;
  reportAction: FormAction;
}

/** The single-elimination bracket; staff generate it and record results. */
export async function BracketTab({
  ctx,
  event,
  staff,
  generateAction,
  reportAction,
}: BracketTabProps) {
  const [bracket, teams] = await Promise.all([
    calendar.getBracket(ctx, { eventId: event.id }),
    calendar.listTeams(ctx, { eventId: event.id }),
  ]);
  if (bracket.state === 'none') {
    const canGenerate = staff && isOpen(event);
    return (
      <Card padding="none">
        <EmptyState
          icon={Swords}
          title="NO BRACKET YET"
          description={
            canGenerate
              ? `Generate a single-elimination bracket from the ${teams.length} ${teams.length === 1 ? 'team' : 'teams'}. At least two are needed.`
              : 'The bracket appears here once staff generate it.'
          }
          action={
            canGenerate ? (
              <GenerateBracketDialog
                eventId={event.id}
                teams={teams.length}
                action={generateAction}
              />
            ) : undefined
          }
        />
      </Card>
    );
  }
  // Results can still be recorded after the evening ends; only a cancellation freezes them.
  const canReport = staff && event.status !== 'cancelled' && bracket.state === 'in_progress';
  return (
    <div className="space-y-5">
      {bracket.champion ? (
        <Callout tone="success" title="TOURNAMENT COMPLETE">
          Champion — {bracket.champion.name}.
        </Callout>
      ) : null}
      <Card>
        <BracketView
          bracket={bracket}
          report={canReport ? { action: reportAction, scoreMax: calendar.MAX_MATCH_SCORE } : null}
        />
      </Card>
    </div>
  );
}
