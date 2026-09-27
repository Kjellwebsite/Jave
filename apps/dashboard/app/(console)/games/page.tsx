import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { can, games } from '@jave/core';
import {
  Card,
  cx,
  EmptyState,
  formatCount,
  Kbd,
  LinkTabs,
  Mono,
  PageHeader,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { MemberOnlyPage } from '@/components/events/member-only-page';
import { NextLink } from '@/components/next-link';
import { firstParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Games' };

const BOARD_LIMIT = 50;
const POSITION_DIGITS = 2;
const METRICS = [
  'wins',
  'best_score',
  'sessions',
] as const satisfies readonly games.LeaderboardMetric[];
const METRIC_LABELS: Record<games.LeaderboardMetric, string> = {
  wins: 'Wins',
  best_score: 'Best score',
  sessions: 'Sessions',
};

const COMMANDS = [
  { command: '/challenge trivia', what: 'Open a trivia lobby in the channel.' },
  { command: '/challenge reaction', what: 'Wait for GO, then tap. Early taps lose the round.' },
  { command: '/challenge leaderboard', what: 'These boards, inside Discord.' },
] as const;

function boardHref(gameKey: string, metric: games.LeaderboardMetric, defaultGame: string) {
  return `/games${toQueryString({
    game: gameKey === defaultGame ? undefined : gameKey,
    metric: metric === 'wins' ? undefined : metric,
  })}`;
}

function MetricSwitch({
  gameKey,
  active,
  defaultGame,
}: {
  gameKey: string;
  active: games.LeaderboardMetric;
  defaultGame: string;
}) {
  return (
    <nav aria-label="Order by" className="flex rounded-md border border-line-strong p-0.5">
      {METRICS.map((metric) => (
        <Link
          key={metric}
          href={boardHref(gameKey, metric, defaultGame)}
          aria-current={metric === active ? 'page' : undefined}
          className={cx(
            'type-eyebrow inline-flex h-7 items-center rounded-sm px-2.5 text-[11px] transition-colors',
            metric === active ? 'bg-surface-raised text-fg' : 'text-fg-subtle hover:text-fg-muted',
          )}
        >
          {METRIC_LABELS[metric]}
        </Link>
      ))}
    </nav>
  );
}

export default async function GamesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const available = games.listGames();
  const defaultGame = available[0]?.key ?? games.trivia.TRIVIA_KEY;
  const game =
    available.find((candidate) => candidate.key === firstParam(params.game)) ?? available[0];
  const requestedMetric = firstParam(params.metric);
  const metric = METRICS.find((candidate) => candidate === requestedMetric) ?? 'wins';
  if (!game) {
    return (
      <>
        <PageHeader eyebrow="OPERATIONS" title="Games" />
        <EmptyState
          title="NO GAMES REGISTERED"
          description="No game is registered in this build."
        />
      </>
    );
  }
  const board = await guarded(() =>
    games.getLeaderboard(ctx, { gameKey: game.key, metric, limit: BOARD_LIMIT }),
  );
  if (!board.ok) return <MemberOnlyPage eyebrow="OPERATIONS" title="Games" />;
  const viewer = await loadViewer(ctx);
  const linkMembers = can(ctx, 'canViewMembers');
  const entries = board.value.entries;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Games"
        description="Trivia and reaction challenges played in JAVELIN channels. Game results are game results — never capability."
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <LinkTabs
            label="Games"
            linkComponent={NextLink}
            tabs={available.map((candidate) => ({
              href: boardHref(candidate.key, metric, defaultGame),
              label: candidate.name,
              active: candidate.key === game.key,
            }))}
          />
          <Card padding="none">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h2 className="type-heading text-fg">{game.name}</h2>
                <p className="mt-1 text-small text-fg-subtle">{game.description}</p>
              </div>
              <MetricSwitch gameKey={game.key} active={metric} defaultGame={defaultGame} />
            </div>
            {entries.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="NO RANKED RESULTS YET"
                description="Sessions with two or more players count. Solo runs are practice."
              />
            ) : (
              <Table caption={`${game.name} leaderboard by ${METRIC_LABELS[metric].toLowerCase()}`}>
                <TableHead>
                  <tr>
                    <TableHeaderCell className="w-14">#</TableHeaderCell>
                    <TableHeaderCell>Member</TableHeaderCell>
                    {METRICS.map((column) => (
                      <TableHeaderCell
                        key={column}
                        className={cx(
                          'text-right',
                          column !== metric && 'hidden sm:table-cell',
                          column === metric && 'text-fg',
                        )}
                      >
                        {METRIC_LABELS[column]}
                      </TableHeaderCell>
                    ))}
                  </tr>
                </TableHead>
                <TableBody>
                  {entries.map((entry) => {
                    const you = entry.memberId === viewer.memberId;
                    const values: Record<games.LeaderboardMetric, number> = {
                      wins: entry.wins,
                      best_score: entry.bestScore,
                      sessions: entry.sessions,
                    };
                    return (
                      <TableRow key={entry.memberId} className={cx(you && 'bg-surface-raised')}>
                        <TableCell>
                          <Mono className={entry.rank <= 3 ? 'text-fg' : undefined}>
                            {String(entry.rank).padStart(POSITION_DIGITS, '0')}
                          </Mono>
                        </TableCell>
                        <TableCell>
                          <span className="flex min-w-0 items-baseline gap-2">
                            {linkMembers ? (
                              <Link
                                href={`/members/${entry.memberId}`}
                                className="truncate text-body text-fg hover:underline"
                              >
                                {entry.displayName}
                              </Link>
                            ) : (
                              <span className="truncate text-body text-fg">
                                {entry.displayName}
                              </span>
                            )}
                            {you ? (
                              <span className="type-eyebrow shrink-0 text-[10px] text-fg-subtle">
                                YOU
                              </span>
                            ) : null}
                          </span>
                          <span className="type-data block truncate text-[12px] text-fg-subtle">
                            @{entry.handle}
                          </span>
                        </TableCell>
                        {METRICS.map((column) => (
                          <TableCell
                            key={column}
                            className={cx(
                              'text-right',
                              column !== metric && 'hidden sm:table-cell',
                            )}
                          >
                            <Mono
                              className={column === metric ? 'text-fg' : undefined}
                              dim={column !== metric}
                            >
                              {formatCount(values[column])}
                            </Mono>
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <Panel title="Play in Discord" description="Games run on one live panel in the channel.">
          <ul className="space-y-3.5">
            {COMMANDS.map((item) => (
              <li key={item.command} className="space-y-1">
                <Kbd className="h-6 px-1.5 text-[12px]">{item.command}</Kbd>
                <p className="text-small text-fg-subtle">{item.what}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-line-subtle pt-4 text-small text-fg-subtle">
            A win needs placement 1 in a session of two or more with points scored. Members who hide
            themselves from leaderboards are not listed.
          </p>
        </Panel>
      </div>
    </div>
  );
}
