import { LoaderCircle, X } from 'lucide-react';
import { Callout, Card, cx, ErrorState, Icon, IconButton, Skeleton } from '@jave/ui';
import type { ApiError } from '../../api/client';
import type { ServerClock } from '../../api/session';
import type { ArenaController } from '../../hooks/use-arena';
import type { ArenaBoardState } from '../../hooks/use-arena-board';
import { type ArenaStage, stageOf } from '../../lib/arena';
import { ArenaBoard } from './board';
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

/**
 * Stages that are a single card read as a stage on wide screens: centered in
 * the space below the bar. Rounds stay top-aligned so the reveal never shifts
 * the question.
 */
const CENTERED_STAGES: ReadonlySet<ArenaStage> = new Set([
  'none',
  'lobby',
  'starting',
  'completed',
  'abandoned',
]);

/** Between games the all-time board sits beside the stage; rounds show live standings instead. */
const BOARD_STAGES: ReadonlySet<ArenaStage> = new Set(['none', 'lobby', 'completed', 'abandoned']);

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
  board: ArenaBoardState;
  clock: ServerClock;
  /** The Arena tab is on screen (keyboard answers only then). */
  active: boolean;
}

/**
 * The Arena never loaded and the server refused (not a lost connection): say
 * why instead of connecting forever. Polling continues underneath, so the view
 * recovers on its own if the refusal lifts.
 */
function ArenaUnavailable({ error }: { error: ApiError }) {
  return (
    <Card data-testid="arena-unavailable">
      <ErrorState
        title={ERROR_TITLES[error.code] ?? 'ARENA UNAVAILABLE'}
        description={error.message}
        reference={error.reference}
      />
    </Card>
  );
}

/** What the stage shows in the main column (rounds bring their own standings column). */
function StageContent({ arena, clock, active }: Omit<ArenaViewProps, 'board'>) {
  const { response, session, pending } = arena;
  if (!response) return null;
  const stage = stageOf(session);
  const nextLobby =
    session !== null && response.liveSessionId !== null && response.liveSessionId !== session.id;
  const next = {
    canHost: response.canHost,
    nextLobby,
    pending,
    onOpen: () => arena.open(),
  };
  switch (stage) {
    case 'none':
      return (
        <OpenLobby
          canHost={response.canHost}
          opening={pending === 'open'}
          onOpen={(config) => arena.open(config)}
        />
      );
    case 'lobby':
      return session ? (
        <Lobby
          session={session}
          pending={pending}
          onStart={arena.start}
          onJoin={() => arena.open()}
          onLeave={arena.leave}
          onClose={arena.close}
        />
      ) : null;
    case 'question':
    case 'reveal':
      return session?.trivia ? (
        <Round
          session={session}
          view={session.trivia}
          clock={clock}
          locked={arena.locked}
          submitting={pending === 'answer'}
          active={active}
          onAnswer={arena.answer}
        />
      ) : null;
    case 'starting':
      return (
        <Card className="flex items-center justify-center gap-3 py-16">
          <Icon icon={LoaderCircle} className="animate-spin text-fg-subtle" />
          <span className="type-eyebrow text-fg-subtle">STARTING</span>
        </Card>
      );
    case 'completed':
      return session ? <Results session={session} {...next} /> : null;
    case 'abandoned':
      return session ? <Ended session={session} {...next} /> : null;
  }
}

/** JVLN ARENA · TRIVIA — every stage of the instance's game, as the server reports it. */
export function ArenaView({ arena, board, clock, active }: ArenaViewProps) {
  const { response, session, actionError, pollError } = arena;
  if (!response) {
    return pollError && !pollError.transient ? (
      <ArenaUnavailable error={pollError} />
    ) : (
      <ArenaSkeleton />
    );
  }
  const stage = stageOf(session);
  const content = <StageContent arena={arena} clock={clock} active={active} />;
  return (
    <div
      className={cx(
        'flex flex-1 flex-col gap-4',
        CENTERED_STAGES.has(stage) && 'lg:justify-center',
      )}
      data-testid="arena"
      data-stage={stage}
    >
      {actionError ? <ActionError error={actionError} onDismiss={arena.clearError} /> : null}
      {BOARD_STAGES.has(stage) ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">{content}</div>
          <ArenaBoard state={board} />
        </div>
      ) : (
        content
      )}
    </div>
  );
}
