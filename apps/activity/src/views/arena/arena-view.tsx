import { LoaderCircle, X } from 'lucide-react';
import { Callout, Card, Icon, IconButton, Skeleton } from '@jave/ui';
import type { ApiError } from '../../api/client';
import type { ServerClock } from '../../api/session';
import type { ArenaController } from '../../hooks/use-arena';
import { stageOf } from '../../lib/arena';
import { Lobby } from './lobby';
import { OpenLobby } from './open-lobby';
import { Ended, Results } from './results';
import { Round } from './round';

const ERROR_TITLES: Readonly<Record<string, string>> = {
  CONFLICT: 'ALREADY RECORDED',
  INVALID_STATE: 'NOT POSSIBLE RIGHT NOW',
  FORBIDDEN: 'ACCESS RESTRICTED',
  NOT_FOUND: 'SESSION NOT FOUND',
  RATE_LIMITED: 'SLOW DOWN',
  VALIDATION: 'NOT ACCEPTED',
};

function ActionError({ error, onDismiss }: { error: ApiError; onDismiss: () => void }) {
  const title = ERROR_TITLES[error.code] ?? (error.transient ? 'CONNECTION LOST' : 'NOT DONE');
  return (
    <div className="flex items-start gap-2" data-testid="arena-error">
      <Callout tone="danger" role="alert" title={title} className="flex-1">
        {error.message}
        {error.reference ? <span className="type-data ml-2">{error.reference}</span> : null}
      </Callout>
      <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} />
    </div>
  );
}

function ArenaSkeleton() {
  return (
    <Card role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Connecting to the Arena</span>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    </Card>
  );
}

export interface ArenaViewProps {
  arena: ArenaController;
  clock: ServerClock;
  /** The Arena tab is on screen (keyboard answers only then). */
  active: boolean;
}

/** JVLN ARENA · TRIVIA — every stage of the instance's game, as the server reports it. */
export function ArenaView({ arena, clock, active }: ArenaViewProps) {
  const { response, session, pending, actionError } = arena;
  if (!response) return <ArenaSkeleton />;

  const stage = stageOf(session);
  const nextLobby =
    session !== null && response.liveSessionId !== null && response.liveSessionId !== session.id;
  const next = {
    canHost: response.canHost,
    nextLobby,
    pending,
    onOpen: () => arena.open(),
  };

  return (
    <div className="space-y-4" data-testid="arena" data-stage={stage}>
      {actionError ? <ActionError error={actionError} onDismiss={arena.clearError} /> : null}
      {stage === 'none' ? (
        <OpenLobby
          canHost={response.canHost}
          opening={pending === 'open'}
          onOpen={(config) => arena.open(config)}
        />
      ) : null}
      {stage === 'lobby' && session ? (
        <Lobby
          session={session}
          pending={pending}
          onStart={arena.start}
          onJoin={() => arena.open()}
          onLeave={arena.leave}
        />
      ) : null}
      {(stage === 'question' || stage === 'reveal') && session?.trivia ? (
        <Round
          session={session}
          view={session.trivia}
          clock={clock}
          locked={arena.locked}
          submitting={pending === 'answer'}
          active={active}
          onAnswer={arena.answer}
        />
      ) : null}
      {stage === 'starting' ? (
        <Card className="flex items-center justify-center gap-3 py-16">
          <Icon icon={LoaderCircle} className="animate-spin text-fg-subtle" />
          <span className="type-eyebrow text-fg-subtle">STARTING</span>
        </Card>
      ) : null}
      {stage === 'completed' && session ? <Results session={session} {...next} /> : null}
      {stage === 'abandoned' && session ? <Ended session={session} {...next} /> : null}
    </div>
  );
}
