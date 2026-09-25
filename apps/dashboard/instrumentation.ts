import type { Instrumentation } from 'next';

/**
 * Logs every server-side request error with its stack under the same
 * reference the error boundary shows the user (derived from the digest).
 * Query strings are dropped: they can carry OAuth codes.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // NEXT_RUNTIME is a build-time constant; the Node-only logger is compiled out of edge bundles.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { referenceFromDigest } = await import('./lib/error-reference');
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : null;
  const entry = {
    err: error,
    reference: digest ? referenceFromDigest(digest) : null,
    digest,
    method: request.method,
    path: request.path.split('?')[0],
    routePath: context.routePath,
    routeType: context.routeType,
  };
  try {
    const { getRuntime } = await import('./server/runtime');
    getRuntime().logger.error(entry, 'request failed');
  } catch {
    // The runtime itself failed to start (e.g. invalid environment): still leave a trace.
    console.error('request failed', entry.reference, error);
  }
};
