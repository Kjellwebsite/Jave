import type { calendar } from '@jave/core';
import { Badge, cx, Mono } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ReportMatchDialog } from './report-match-dialog';

export interface BracketViewProps {
  bracket: calendar.BracketView;
  /** Staff who may report results (core re-checks). Null: read-only. */
  report: { action: FormAction; scoreMax: number } | null;
}

function TeamRow({
  team,
  score,
  won,
  decided,
  placeholder,
}: {
  team: calendar.BracketTeamView | null;
  score: number | null;
  won: boolean;
  decided: boolean;
  placeholder: string;
}) {
  const scoreText = decided ? (score === null ? (won ? 'W' : 'FF') : String(score)) : '';
  return (
    <div
      className={cx(
        'flex h-9 items-center gap-2.5 px-3',
        won && 'bg-surface-raised',
        decided && !won && 'text-fg-subtle',
      )}
    >
      <Mono dim className="w-5 shrink-0 text-right text-[11px]">
        {team?.seed ?? ''}
      </Mono>
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-small',
          team
            ? won
              ? 'font-medium text-fg'
              : decided
                ? 'text-fg-subtle'
                : 'text-fg-muted'
            : 'text-fg-subtle italic',
        )}
      >
        {team?.name ?? placeholder}
      </span>
      <Mono className={cx('shrink-0', won ? 'text-fg' : 'text-fg-subtle')}>{scoreText}</Mono>
      <span
        aria-hidden
        className={cx('h-4 w-0.5 shrink-0 rounded-full', won ? 'chrome-plate' : 'bg-transparent')}
      />
    </div>
  );
}

function MatchCard({
  match,
  roundName,
  report,
}: {
  match: calendar.MatchView;
  roundName: string;
  report: BracketViewProps['report'];
}) {
  const decided = match.status === 'completed' || match.status === 'bye';
  const placeholder = match.status === 'bye' ? 'Bye' : 'To be decided';
  const label = `${roundName}, match ${match.position + 1}`;
  return (
    <li
      aria-label={label}
      data-match-status={match.status}
      className="w-full rounded-md border border-line bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-3 py-1.5">
        <Mono dim className="text-[11px]">
          M{match.position + 1}
        </Mono>
        {match.status === 'ready' ? (
          report && match.teamA && match.teamB ? (
            <ReportMatchDialog
              matchId={match.id}
              roundName={roundName}
              teamA={match.teamA.name}
              teamB={match.teamB.name}
              scoreMax={report.scoreMax}
              action={report.action}
            />
          ) : (
            <Badge tone="info">Ready</Badge>
          )
        ) : match.status === 'bye' ? (
          <Badge>Bye</Badge>
        ) : match.status === 'pending' ? (
          <span className="type-eyebrow text-[10px] text-fg-subtle">Waiting</span>
        ) : null}
      </div>
      <div className="divide-y divide-line-subtle">
        <TeamRow
          team={match.teamA}
          score={match.scoreA}
          won={decided && match.winnerTeamId !== null && match.winnerTeamId === match.teamA?.id}
          decided={match.status === 'completed'}
          placeholder={placeholder}
        />
        <TeamRow
          team={match.teamB}
          score={match.scoreB}
          won={decided && match.winnerTeamId !== null && match.winnerTeamId === match.teamB?.id}
          decided={match.status === 'completed'}
          placeholder={placeholder}
        />
      </div>
    </li>
  );
}

/**
 * Single-elimination bracket: one column per round, matches spaced so each
 * pair lines up with the match it feeds. Scrolls inside its own frame on
 * narrow screens; the page never scrolls sideways.
 */
export function BracketView({ bracket, report }: BracketViewProps) {
  return (
    <div className="scroll-fade-x -mx-5 overflow-x-auto px-5 pb-2 [scrollbar-width:thin]">
      <ol className="flex min-w-max gap-6" aria-label="Bracket">
        {bracket.rounds.map((round) => (
          <li key={round.round} className="flex w-60 shrink-0 flex-col">
            <p className="type-eyebrow mb-3 text-fg-subtle">{round.name}</p>
            <ul className="flex flex-1 flex-col justify-around gap-4">
              {round.matches.map((match) => (
                <MatchCard key={match.id} match={match} roundName={round.name} report={report} />
              ))}
            </ul>
          </li>
        ))}
        <li className="flex w-48 shrink-0 flex-col">
          <p className="type-eyebrow mb-3 text-fg-subtle">Champion</p>
          <div className="flex flex-1 flex-col justify-center">
            <div
              className={cx(
                'rounded-md border px-4 py-3',
                bracket.champion
                  ? 'machined border-line-strong bg-surface-raised'
                  : 'border-dashed border-line',
              )}
            >
              {bracket.champion ? (
                <>
                  <p className="type-eyebrow text-[10px] text-fg-subtle">WINNER</p>
                  <p className="mt-1 truncate text-body font-medium text-fg">
                    {bracket.champion.name}
                  </p>
                </>
              ) : (
                <p className="text-small text-fg-subtle">Decided by the final</p>
              )}
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
