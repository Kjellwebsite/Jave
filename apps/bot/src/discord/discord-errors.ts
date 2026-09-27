import { RESTJSONErrorCodes } from 'discord.js';
import { PermanentJobError } from '@jave/core';
import { DiscordActionError } from './gateway';

/** Discord's answers for objects that no longer exist. */
export const UNKNOWN_OBJECT = {
  message: RESTJSONErrorCodes.UnknownMessage,
  scheduledEvent: RESTJSONErrorCodes.UnknownGuildScheduledEvent,
  channel: RESTJSONErrorCodes.UnknownChannel,
} as const;

/** True when `error` is a normalized Discord failure with this error code. */
export function isDiscordError(error: unknown, code: number): boolean {
  return error instanceof DiscordActionError && Number(error.code) === code;
}

export function isPermanentDiscordError(error: unknown): boolean {
  return error instanceof DiscordActionError && error.permanent;
}

/**
 * The error a job handler should throw for a Discord failure: permanent ones
 * dead-letter immediately (retrying a missing permission never helps); every
 * other error is rethrown unchanged and retried with backoff.
 */
export function jobFailure(error: unknown): unknown {
  if (error instanceof DiscordActionError && error.permanent) {
    return new PermanentJobError(error.message);
  }
  return error;
}
