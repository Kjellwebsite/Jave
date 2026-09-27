import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { ActivitySession } from '../api/session';
import { AuthMismatchError, type AuthSession } from '../platform/hosts';

export type SignInState =
  | { status: 'pending' }
  | { status: 'ready'; auth: AuthSession }
  | { status: 'failed'; problem: SignInProblem };

export interface SignInProblem {
  title: string;
  description: string;
  reference: string | null;
}

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;

/** Calm, specific copy for the ways sign-in fails. Never echoes raw error text from Discord. */
export function describeSignInFailure(error: unknown, mode: 'discord' | 'dev'): SignInProblem {
  if (error instanceof AuthMismatchError) {
    return {
      title: 'SIGN-IN REFUSED',
      description: 'Discord and JAVELIN disagree about who is signed in. Relaunch the Activity.',
      reference: null,
    };
  }
  if (error instanceof ApiError) {
    if (mode === 'dev' && error.status === HTTP_NOT_FOUND) {
      return {
        title: 'DEV SIGN-IN DISABLED',
        description:
          'The dashboard refuses dev personas. Start it with JAVE_DEV_AUTH=true outside production.',
        reference: null,
      };
    }
    if (error.status === HTTP_FORBIDDEN) {
      return { title: 'ACCESS RESTRICTED', description: error.message, reference: null };
    }
    if (error.transient) {
      return {
        title: 'CONNECTION LOST',
        description: 'JAVELIN could not be reached. Check the connection and try again.',
        reference: error.reference,
      };
    }
    return { title: 'SIGN-IN FAILED', description: error.message, reference: error.reference };
  }
  return {
    title: 'SIGN-IN FAILED',
    description:
      mode === 'discord'
        ? 'Discord did not complete the sign-in. Relaunch the Activity to try again.'
        : 'The mock Discord client did not start.',
    reference: null,
  };
}

/** Runs the host's sign-in once on mount; `retry` runs it again after a failure. */
export function useSignIn(session: ActivitySession, mode: 'discord' | 'dev') {
  const [state, setState] = useState<SignInState>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    session
      .signIn()
      .then((auth) => {
        if (!cancelled) setState({ status: 'ready', auth });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'failed', problem: describeSignInFailure(error, mode) });
      });
    return () => {
      cancelled = true;
    };
  }, [session, mode, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'pending' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
