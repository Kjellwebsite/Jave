import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import type { ArenaResponse, ArenaSessionWire, TriviaConfigWire } from '../api/contract';
import type { ActivitySession } from '../api/session';
import { pollDelay, shouldTick } from '../lib/arena';
import { ArenaFeed } from '../lib/arena-feed';

export type ArenaAction = 'open' | 'start' | 'leave' | 'close' | 'answer';
export type Connection = 'connecting' | 'live' | 'reconnecting';

/** An answer on its way to the server: shown as locked in before the response lands. */
export interface LockedAnswer {
  sessionId: string;
  round: number;
  choice: number;
}

export interface ArenaController {
  response: ArenaResponse | null;
  session: ArenaSessionWire | null;
  connection: Connection;
  /** The last failed poll, until one succeeds (a refusal is shown, a lost connection retried). */
  pollError: ApiError | null;
  pending: ArenaAction | null;
  actionError: ApiError | null;
  locked: LockedAnswer | null;
  /** Join the instance's lobby, or open one with this configuration. */
  open(config?: Partial<TriviaConfigWire>): void;
  start(): void;
  leave(): void;
  /** Host or event staff: end the lobby so the instance is free again. */
  close(): void;
  answer(choice: number): void;
  clearError(): void;
}

const MS_PER_SECOND = 1000;
const STATE_PATH = '/activity/trivia/session';

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'CLIENT', 'Something went wrong.');
}

function retryDelay(error: unknown, session: ArenaSessionWire | null, failures: number): number {
  const backoff = pollDelay(session, failures);
  if (error instanceof ApiError && error.retryAfterSeconds !== null) {
    return Math.max(backoff, error.retryAfterSeconds * MS_PER_SECOND);
  }
  return backoff;
}

/**
 * JVLN Arena state for this Activity instance: polls the server (1 Hz while a
 * game is live, slower otherwise, with backoff on failures), nudges overdue
 * timers when this viewer is a player, and runs lobby/answer actions. Server
 * time decides everything; the client only renders what it is told.
 */
export function useArena(session: ActivitySession): ArenaController {
  const [response, setResponse] = useState<ArenaResponse | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [pollError, setPollError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<ArenaAction | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [locked, setLocked] = useState<LockedAnswer | null>(null);
  /** Orders polls against actions; see ArenaFeed. */
  const [feed] = useState(() => new ArenaFeed());
  const busy = useRef(false);

  const pollOnce = useCallback(async (): Promise<ArenaResponse> => {
    const current = feed.latest?.session ?? null;
    if (current && shouldTick(current, session.clock.now())) {
      return session.call<ArenaResponse>('POST', '/activity/trivia/tick', {
        body: { sessionId: current.id },
      });
    }
    return session.call<ArenaResponse>('GET', STATE_PATH, {
      query: { sessionId: feed.following },
    });
  }, [session, feed]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    const run = async () => {
      let delay: number;
      const stamp = feed.stamp();
      try {
        const next = await pollOnce();
        if (cancelled) return;
        failures = 0;
        // Null: an action's result landed while this poll was in flight; it is stale.
        const applied = feed.pollResult(stamp, next);
        if (applied) setResponse(applied);
        setConnection('live');
        setPollError(null);
        delay = pollDelay(feed.latest?.session ?? null, 0);
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        feed.pollFailed(stamp, error instanceof ApiError ? error.status : null);
        setConnection('reconnecting');
        setPollError(asApiError(error));
        delay = retryDelay(error, feed.latest?.session ?? null, failures);
      }
      timer = window.setTimeout(() => void run(), delay);
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pollOnce, feed]);

  const act = useCallback(
    async (action: ArenaAction, path: string, body: unknown) => {
      if (busy.current) return;
      busy.current = true;
      setPending(action);
      setActionError(null);
      try {
        setResponse(feed.actionResult(await session.call<ArenaResponse>('POST', path, { body })));
      } catch (error) {
        setActionError(asApiError(error));
        if (action === 'answer') setLocked(null);
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [session, feed],
  );

  const sessionId = response?.session?.id ?? null;

  const open = useCallback(
    (config?: Partial<TriviaConfigWire>) => void act('open', STATE_PATH, config ? { config } : {}),
    [act],
  );
  const start = useCallback(() => {
    if (sessionId) void act('start', '/activity/trivia/start', { sessionId });
  }, [act, sessionId]);
  const leave = useCallback(() => {
    if (sessionId) void act('leave', '/activity/trivia/leave', { sessionId });
  }, [act, sessionId]);
  const close = useCallback(() => {
    if (sessionId) void act('close', '/activity/trivia/close', { sessionId });
  }, [act, sessionId]);
  const answer = useCallback(
    (choice: number) => {
      const current = feed.latest?.session;
      const view = current?.trivia;
      if (!current?.youArePlayer || !view || view.phase !== 'question' || view.you?.answered) {
        return;
      }
      setLocked({ sessionId: current.id, round: view.round, choice });
      void act('answer', '/activity/trivia/move', {
        sessionId: current.id,
        round: view.round,
        choice,
      });
    },
    [act, feed],
  );
  const clearError = useCallback(() => setActionError(null), []);

  return {
    response,
    session: response?.session ?? null,
    connection,
    pollError,
    pending,
    actionError,
    locked,
    open,
    start,
    leave,
    close,
    answer,
    clearError,
  };
}
