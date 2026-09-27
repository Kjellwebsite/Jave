import { CircleX, LogIn, LogOut, Play } from 'lucide-react';
import { Avatar, Badge, Button, cx } from '@jave/ui';
import type { ArenaSessionWire } from '../../api/contract';
import type { ArenaAction } from '../../hooks/use-arena';
import { configSummary, SCORING_NOTE } from './copy';

export interface LobbyProps {
  session: ArenaSessionWire;
  pending: ArenaAction | null;
  onStart: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onClose: () => void;
}

function Seat({ player }: { player: ArenaSessionWire['players'][number] }) {
  return (
    <li
      className={cx(
        'flex min-w-0 items-center gap-3 rounded-md border px-3 py-2.5',
        player.isYou ? 'border-line-strong bg-surface-raised' : 'border-line bg-surface',
      )}
    >
      <Avatar name={player.displayName} size="md" />
      <span className="min-w-0 flex-1 truncate text-body text-fg">{player.displayName}</span>
      {player.isHost ? <Badge>HOST</Badge> : null}
      {player.isYou ? <span className="type-eyebrow text-fg-subtle">YOU</span> : null}
    </li>
  );
}

/** The instance's open lobby: who is in, the settings, and what this viewer can do. */
function lobbyHint(session: ArenaSessionWire): string {
  if (session.isHost) {
    return session.practice
      ? 'Start now to practise alone, or wait for others to join. Ranked games need two players.'
      : 'Everyone in this Activity can join until you start.';
  }
  if (session.canClose) return 'As event staff you can start or close this lobby.';
  if (session.youArePlayer) return 'You are in. The host starts the game.';
  return 'Join to play, or stay to watch.';
}

export function Lobby({ session, pending, onStart, onJoin, onLeave, onClose }: LobbyProps) {
  const seats = session.players.length;
  const busy = pending !== null;
  return (
    <section
      aria-labelledby="lobby-title"
      className="machined relative rounded-lg border border-line bg-surface"
      data-testid="lobby"
    >
      <div className="flex flex-col gap-5 border-b border-line-subtle p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0 space-y-2.5">
          <p className="type-eyebrow text-fg-subtle">JVLN ARENA · LOBBY</p>
          <h2 id="lobby-title" className="type-title text-fg">
            {session.gameName}
          </h2>
          <p className="type-data text-small text-fg-muted">{configSummary(session.config)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session.canStart ? (
            <Button
              variant="primary"
              size="lg"
              iconLeft={Play}
              loading={pending === 'start'}
              disabled={busy}
              onClick={onStart}
            >
              Start game
            </Button>
          ) : null}
          {session.canJoin ? (
            <Button
              variant={session.canStart ? 'secondary' : 'primary'}
              size="lg"
              iconLeft={LogIn}
              loading={pending === 'open'}
              disabled={busy}
              onClick={onJoin}
            >
              Join lobby
            </Button>
          ) : null}
          {session.youArePlayer && !session.isHost ? (
            <Button
              variant="ghost"
              iconLeft={LogOut}
              loading={pending === 'leave'}
              disabled={busy}
              onClick={onLeave}
            >
              Leave
            </Button>
          ) : null}
          {session.canClose ? (
            <Button
              variant="ghost"
              iconLeft={CircleX}
              loading={pending === 'close'}
              disabled={busy}
              onClick={onClose}
            >
              Close lobby
            </Button>
          ) : null}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="type-eyebrow text-fg-subtle">
            PLAYERS <span className="type-data ml-1 text-fg-muted">{seats}</span>
            <span className="text-fg-faint"> / {session.maxPlayers}</span>
          </p>
          {session.practice ? <Badge tone="accent">PRACTICE · NOT RANKED</Badge> : null}
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="lobby-players">
          {session.players.map((player) => (
            <Seat key={player.key} player={player} />
          ))}
        </ul>
        <p className="mt-5 text-small text-fg-subtle" data-testid="lobby-hint">
          {lobbyHint(session)}
        </p>
      </div>

      <footer className="rounded-b-lg border-t border-line-subtle bg-surface-sunken px-5 py-3 sm:px-6">
        <p className="text-[12px] leading-snug text-fg-subtle">{SCORING_NOTE}</p>
      </footer>
    </section>
  );
}
