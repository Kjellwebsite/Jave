import { type ErrorCode, isJaveError, newErrorId, RateLimitedError } from '@jave/core';
import type { Logger } from '@jave/core';
import type { ReplyPayload } from './types';
import { failure, panel } from '../ui/components';
import { COLORS } from '../ui/theme';

const TITLES: Record<ErrorCode, string> = {
  VALIDATION: 'INVALID INPUT',
  NOT_FOUND: 'NOT FOUND',
  FORBIDDEN: 'ACCESS RESTRICTED',
  UNAUTHENTICATED: 'IDENTITY REQUIRED',
  CONFLICT: 'CONFLICT',
  INVALID_STATE: 'NOT AVAILABLE RIGHT NOW',
  RATE_LIMITED: 'RATE LIMITED',
  EXTERNAL_SERVICE: 'SERVICE UNAVAILABLE',
  DISABLED: 'DISABLED',
};

/**
 * Turn any thrown value into a user-facing ephemeral reply. Expected errors
 * show their safe message; unexpected ones show only a reference id, while the
 * full error is logged with that id.
 */
export function renderError(
  error: unknown,
  logger: Logger,
): { payload: ReplyPayload; errorId: string | null } {
  if (error instanceof RateLimitedError) {
    return {
      payload: {
        embeds: [
          panel({
            title: TITLES.RATE_LIMITED,
            description: `Try again in ${error.retryAfterSeconds}s.`,
            color: COLORS.warning,
          }),
        ],
        ephemeral: true,
      },
      errorId: null,
    };
  }
  if (isJaveError(error)) {
    return {
      payload: { embeds: [failure(TITLES[error.code], error.userMessage)], ephemeral: true },
      errorId: null,
    };
  }
  const errorId = newErrorId();
  logger.error({ err: error, errorId }, 'unexpected interaction error');
  return {
    payload: {
      embeds: [
        failure(
          'SYSTEM ERROR',
          `Something failed on our side. It has been logged.\nReference \`${errorId}\``,
        ),
      ],
      ephemeral: true,
    },
    errorId,
  };
}
