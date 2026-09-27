import { RESTJSONErrorCodes } from 'discord.js';
import type { z } from 'zod';
import { PermanentJobError } from '@jave/core';
import { DiscordActionError } from '../../../discord/gateway';

/** Discord "unknown entity" codes the trial and adversarial handlers treat as "already gone". */
export const UNKNOWN = {
  channel: RESTJSONErrorCodes.UnknownChannel,
  member: RESTJSONErrorCodes.UnknownMember,
  message: RESTJSONErrorCodes.UnknownMessage,
  role: RESTJSONErrorCodes.UnknownRole,
  user: RESTJSONErrorCodes.UnknownUser,
} as const;

/** A payload that fails its contract schema can never succeed: dead-letter it. */
export function parsePayload<S extends z.ZodType>(schema: S, payload: unknown): z.infer<S> {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentJobError('invalid job payload');
  return result.data;
}

/** True when a Discord action failed because the entity does not exist (any of `codes`). */
export function isUnknownEntity(error: unknown, ...codes: number[]): boolean {
  return (
    error instanceof DiscordActionError &&
    typeof error.code === 'number' &&
    codes.includes(error.code)
  );
}

export function isPermanentDiscordError(error: unknown): error is DiscordActionError {
  return error instanceof DiscordActionError && error.permanent;
}

/**
 * Normalizes a failure for the job worker: a permanent Discord failure
 * (missing permission, unknown entity) dead-letters; anything else is
 * rethrown unchanged so the job retries with backoff.
 */
export function toJobError(error: unknown): unknown {
  if (isPermanentDiscordError(error)) return new PermanentJobError(error.message);
  return error;
}

/** Run a Discord action where "it does not exist" counts as success. */
export async function ignoreUnknown(action: () => Promise<unknown>, ...codes: number[]) {
  try {
    await action();
  } catch (error) {
    if (!isUnknownEntity(error, ...codes)) throw error;
  }
}
