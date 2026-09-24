import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@jave/core';
import { LOGIN_PATH } from '@/lib/routes';

export type Guarded<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a page's data load through the core services' authorization:
 * Forbidden → a calm ACCESS RESTRICTED state, NotFound → 404,
 * Unauthenticated → /login. Anything else reaches the error boundary.
 */
export async function guarded<T>(load: () => Promise<T>): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof UnauthenticatedError) redirect(LOGIN_PATH);
    throw error;
  }
}
