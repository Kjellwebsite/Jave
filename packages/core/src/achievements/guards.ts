import { z } from 'zod';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError } from '../kernel/errors';
import type { SystemActor } from '../permissions/actor';

/**
 * Small guards shared by the achievements and missions modules (missions
 * already depends on achievements for mission rewards).
 */

/** Callbacks and internal grants are reserved for jobs, the event dispatcher and the bot worker. */
export function requireSystemActor(ctx: Pick<ServiceContext, 'actor'>): SystemActor {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
  return ctx.actor;
}

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** Control characters other than tab (and, optionally, line breaks) never belong in copy. */
export function hasControlCharacters(value: string, allowLineBreaks: boolean): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === TAB) continue;
    if (allowLineBreaks && (code === LINE_FEED || code === CARRIAGE_RETURN)) continue;
    if (code < FIRST_PRINTABLE || code === DELETE) return true;
  }
  return false;
}

/** Trimmed single-line text without control characters. */
export function singleLineText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value, false), {
      message: 'must be a single line of plain text',
    });
}

/** Trimmed multi-line text without control characters. */
export function multiLineText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value, true), {
      message: 'contains control characters',
    });
}

export const MAX_URL_LENGTH = 2048;

/** Absolute http(s) URL; every other scheme (javascript:, data:, file:) is refused. */
export const httpUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

/** Discord snowflake id. */
export const snowflakeId = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
