import type { calendar } from '@jave/core';
import { Mono } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { DeleteTeamButton } from './team-controls';

export interface TeamsListProps {
  eventId: string;
  teams: readonly calendar.TeamView[];
  /** Staff while teams can still change (core re-checks). Null: read-only. */
  deleteAction: FormAction | null;
}

/** Teams as a grid of cards: name, seed, members. */
export function TeamsList({ eventId, teams, deleteAction }: TeamsListProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Teams">
      {teams.map((team) => (
        <li key={team.id} className="rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-2.5">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <p className="truncate text-body font-medium text-fg">{team.name}</p>
              {team.seed !== null ? (
                <Mono dim className="text-[11px]">
                  SEED {team.seed}
                </Mono>
              ) : null}
            </div>
            {deleteAction ? (
              <DeleteTeamButton
                eventId={eventId}
                teamId={team.id}
                teamName={team.name}
                action={deleteAction}
              />
            ) : null}
          </div>
          <ul className="space-y-1 px-4 py-3">
            {team.members.map((member) => (
              <li key={member.memberId} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-small text-fg-muted">{member.displayName}</span>
                <Mono dim className="shrink-0 text-[11px]">
                  @{member.handle}
                </Mono>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
