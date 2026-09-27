import { CircleSlash, LogIn, Swords } from 'lucide-react';
import { Badge, Button, Card, cx, EmptyState, formatCount } from '@jave/ui';
import type { ArenaSessionWire } from '../../api/contract';
import type { ArenaAction } from '../../hooks/use-arena';
import { type PodiumSpot, standings } from '../../lib/arena';
import { ordinal } from '../../lib/format';
import { configSummary, endReasonText } from './copy';

/** Podium order on screen: second, first, third. */
const PODIUM_ORDER = [1, 0, 2] as const;
const PODIUM_HEIGHT = ['h-28 sm:h-36', 'h-20 sm:h-24', 'h-14 sm:h-16'] as const;

export interface NextStepProps {
  canHost: boolean;
  /** A new lobby is already open in this instance. */
  nextLobby: boolean;
  pending: ArenaAction | null;
  onOpen: () => void;
}

/** After a game: join the lobby someone already opened, or open the next one. */
function NextStep({ canHost, nextLobby, pending, onOpen }: NextStepProps) {
  if (nextLobby) {
    return (
      <Button variant="primary" iconLeft={LogIn} loading={pending === 'open'} onClick={onOpen}>
        Join next lobby
      </Button>
    );
  }
  if (canHost) {
    return (
      <Button variant="primary" iconLeft={Swords} loading={pending === 'open'} onClick={onOpen}>
        Open new lobby
      </Button>
    );
  }
  return null;
}

function PodiumPlate({ spot, rank }: { spot: PodiumSpot; rank: number }) {
  const first = spot.placement === 1;
  return (
    <li className="flex min-w-0 flex-1 flex-col items-center gap-2" data-testid="podium-spot">
      <span className="max-w-full truncate text-body text-fg">{spot.displayName}</span>
      <span className="type-data text-small text-fg-muted">{formatCount(spot.score)}</span>
      <div
        className={cx(
          'flex w-full flex-col items-center justify-start rounded-t-md border border-b-0 pt-3',
          PODIUM_HEIGHT[rank],
          first ? 'border-line-strong bg-surface-raised' : 'border-line bg-surface',
          spot.isYou && 'border-fg-faint',
        )}
      >
        <span
          className={cx(
            'flex size-9 items-center justify-center rounded-sm font-display text-[16px] font-semibold',
            first ? 'rank-verified' : 'rank-unknown text-fg-muted',
          )}
        >
          {spot.placement}
        </span>
        {spot.isYou ? <span className="type-eyebrow mt-2 text-fg-subtle">YOU</span> : null}
      </div>
    </li>
  );
}

export interface ResultsProps extends NextStepProps {
  session: ArenaSessionWire;
}

/** FINAL STANDINGS: the podium, every placement, and the viewer's own result. */
export function Results({ session, ...next }: ResultsProps) {
  const all = standings(session);
  const podium = PODIUM_ORDER.map((index) => all[index]).filter(
    (spot): spot is PodiumSpot => spot !== undefined,
  );
  const you = all.find((spot) => spot.isYou) ?? null;
  return (
    <section
      aria-labelledby="results-title"
      className="machined relative rounded-lg border border-line bg-surface"
      data-testid="results"
    >
      <div className="flex flex-col gap-4 border-b border-line-subtle p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0 space-y-2.5">
          <p className="type-eyebrow text-fg-subtle">JVLN ARENA · {session.gameName}</p>
          <h2 id="results-title" className="type-title text-fg">
            Final standings
          </h2>
          <p className="type-data text-small text-fg-muted">{configSummary(session.config)}</p>
        </div>
        <NextStep {...next} />
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-end">
          <ol
            aria-label="Podium"
            className="mx-auto flex w-full max-w-md items-end gap-2 border-b border-line-strong"
          >
            {podium.map((spot) => (
              <PodiumPlate key={spot.key} spot={spot} rank={all.indexOf(spot)} />
            ))}
          </ol>
        </div>
        <div className="min-w-0 space-y-4">
          {you ? (
            <p className="type-eyebrow text-fg" data-testid="your-result">
              {session.practice
                ? `PRACTICE COMPLETE — ${formatCount(you.score)} POINTS`
                : `YOU PLACED ${ordinal(you.placement).toUpperCase()} — ${formatCount(you.score)} POINTS`}
            </p>
          ) : null}
          {session.practice ? <Badge tone="accent">PRACTICE · NOT RANKED</Badge> : null}
          <ol className="divide-y divide-line-subtle rounded-md border border-line">
            {all.map((spot) => (
              <li
                key={spot.key}
                className={cx(
                  'flex items-center gap-3 px-4 py-2.5',
                  spot.isYou && 'bg-surface-raised',
                )}
              >
                <span className="type-data w-10 shrink-0 text-small text-fg-subtle">
                  {ordinal(spot.placement).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  {spot.displayName}
                </span>
                <span className="type-data text-body text-fg tabular-nums">
                  {formatCount(spot.score)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-small text-fg-subtle">Arena results never change capability ranks.</p>
        </div>
      </div>
    </section>
  );
}

/** The session stopped before the end (host stopped it, everyone left, or it idled out). */
export function Ended({ session, ...next }: ResultsProps) {
  return (
    <Card data-testid="ended">
      <EmptyState
        icon={CircleSlash}
        title="SESSION ENDED"
        description={endReasonText(session.endReason)}
        action={<NextStep {...next} />}
      />
    </Card>
  );
}
