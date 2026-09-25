import type { modAction } from '@jave/database';
import { formatNumber } from '../kernel/ids';
import { truncate } from '../kernel/redact';
import { DISCORD_AUDIT_REASON_MAX, DISCORD_MESSAGE_MAX } from './constants';

/** User-facing moderation copy. Calm, precise, uppercase headers, no emoji. */

export type ModAction = (typeof modAction.enumValues)[number];

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

/** 90 → "1m 30s", 5400 → "1h 30m", 172800 → "2d". Largest two units. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (rest) parts.push(`${rest}s`);
  return parts.length ? parts.slice(0, 2).join(' ') : '0s';
}

/** 2026-03-01T13:05:09Z → "2026-03-01 13:05 UTC". */
export function formatInstant(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function caseReference(number: number): string {
  return formatNumber('CASE', number);
}

export function securityReference(number: number): string {
  return formatNumber('SEC', number);
}

export interface NoticeCopy {
  title: string;
  body: string;
}

export interface NoticeInput {
  action: ModAction;
  reason: string;
  organizationName: string;
  durationSeconds?: number | null;
  expiresAt?: Date | null;
}

/** Notice shown to the target (inbox + DM). Notes are staff-only and have none. */
export function noticeFor(input: NoticeInput): NoticeCopy | null {
  const reason = `Reason: ${input.reason}`;
  const until = input.expiresAt ? ` Ends ${formatInstant(input.expiresAt)}.` : '';
  const duration = input.durationSeconds ? formatDuration(input.durationSeconds) : null;
  switch (input.action) {
    case 'warn':
      return { title: 'WARNING ISSUED', body: reason };
    case 'timeout':
      return {
        title: duration ? `TIMEOUT — ${duration.toUpperCase()}` : 'TIMEOUT',
        body: `You can read but not post.${until} ${reason}`,
      };
    case 'untimeout':
      return { title: 'TIMEOUT LIFTED', body: 'You can post again.' };
    case 'kick':
      return {
        title: `REMOVED FROM ${input.organizationName.toUpperCase()}`,
        body: `${reason} You may rejoin with a new invite.`,
      };
    case 'ban':
      return { title: `BANNED FROM ${input.organizationName.toUpperCase()}`, body: reason };
    case 'unban':
      return { title: 'BAN LIFTED', body: 'You may rejoin the server.' };
    case 'quarantine':
      return {
        title: 'ACCESS RESTRICTED — QUARANTINE',
        body: `Your access is limited pending staff review.${until} ${reason}`,
      };
    case 'release':
      return { title: 'QUARANTINE LIFTED', body: 'Full access restored.' };
    case 'note':
      return null;
  }
}

/** DM text for the Discord apply job (plain text; the bot escapes it). */
export function dmTextFor(notice: NoticeCopy, organizationName: string): string {
  return truncate(
    `${organizationName.toUpperCase()} · ${notice.title}\n${notice.body}`,
    DISCORD_MESSAGE_MAX,
  );
}

export function auditReasonFor(caseNumber: number, reason: string): string {
  return truncate(`JAVE ${caseReference(caseNumber)} — ${reason}`, DISCORD_AUDIT_REASON_MAX);
}
