import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivitySession } from '../api/session';
import type { AuthSession } from '../platform/hosts';
import { describeSignInFailure, type SignInProblem } from './sign-in-failure';

export type SignInState =
  | { status: 'pending' }
  | { status: 'ready'; auth: AuthSession }
  /** `retryAt` (local epoch ms): an automatic retry is scheduled for then. */
  | { status: 'failed'; problem: SignInProblem; retryAt: number | null };

/** Automatic retries after a 429 before the member is asked to try again. */
export const MAX_AUTO_RETRIES = 5;

/**
 * Runs the host's sign-in once on mount; `retry` runs it again after a
 * failure. A throttled sign-in (429) retries on its own after the server's
 * Retry-After, a bounded number of times.
 */
export function useSignIn(session: ActivitySession, mode: 'discord' | 'dev') {
  const [state, setState] = useState<SignInState>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  const autoRetries = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    session
      .signIn()
      .then((auth) => {
        if (cancelled) return;
        autoRetries.current = 0;
        setState({ status: 'ready', auth });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const problem = describeSignInFailure(error, mode);
        const wait =
          problem.retryAfterMs !== null && autoRetries.current < MAX_AUTO_RETRIES
            ? problem.retryAfterMs
            : null;
        setState({
          status: 'failed',
          problem,
          retryAt: wait === null ? null : Date.now() + wait,
        });
        if (wait !== null) {
          autoRetries.current += 1;
          timer = window.setTimeout(() => {
            setState({ status: 'pending' });
            setAttempt((value) => value + 1);
          }, wait);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session, mode, attempt]);

  const retry = useCallback(() => {
    autoRetries.current = 0;
    setState({ status: 'pending' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
