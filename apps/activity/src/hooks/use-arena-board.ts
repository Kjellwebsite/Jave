import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { ArenaBoardResponse } from '../api/contract';
import type { ActivitySession } from '../api/session';

export interface ArenaBoardState {
  data: ArenaBoardResponse | null;
  error: ApiError | null;
}

const BOARD_PATH = '/activity/trivia/leaderboard';
/** After a lost connection or a server hiccup the board tries again at this pace. */
export const BOARD_RETRY_MS = 15_000;

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'CLIENT', 'Something went wrong.');
}

/**
 * The all-time trivia board. It only changes when a ranked game completes,
 * so it loads once and again whenever `refreshKey` changes (the Arena passes
 * the id of the game that just completed). A failed load keeps the last board
 * and retries while the failure is transient; a refusal is shown as is.
 */
export function useArenaBoard(session: ActivitySession, refreshKey: string): ArenaBoardState {
  const [state, setState] = useState<ArenaBoardState>({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;
    session
      .call<ArenaBoardResponse>('GET', BOARD_PATH)
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        const error = asApiError(failure);
        setState((previous) => ({ ...previous, error }));
        if (error.transient) {
          retry = window.setTimeout(() => setAttempt((value) => value + 1), BOARD_RETRY_MS);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [session, refreshKey, attempt]);

  return state;
}
