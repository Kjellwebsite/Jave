import { moderation } from '@jave/core';
import type { AutocompleteChoice } from '../../interactions/types';

const SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;
type Unit = keyof typeof SECONDS;
const UNIT_ORDER: readonly Unit[] = ['w', 'd', 'h', 'm', 's'];
/** Longest duration text we try to parse ("12w6d23h59m59s" fits comfortably). */
const MAX_DURATION_TEXT = 24;
const DURATION_PART = /(\d{1,6})([wdhms])/g;
const DURATION_SHAPE = /^(?:\d{1,6}[wdhms])+$/;

export interface DurationPreset {
  /** Stable key submitted by selects and autocomplete ("10m", "indefinite"). */
  key: string;
  label: string;
  /** Null = indefinite (quarantine only). */
  seconds: number | null;
}

/** Timeout presets — Discord caps a timeout at 28 days. */
export const TIMEOUT_PRESETS: readonly DurationPreset[] = [
  { key: '10m', label: '10 minutes', seconds: 10 * SECONDS.m },
  { key: '1h', label: '1 hour', seconds: SECONDS.h },
  { key: '1d', label: '1 day', seconds: SECONDS.d },
  { key: '7d', label: '7 days', seconds: 7 * SECONDS.d },
  { key: '28d', label: '28 days (maximum)', seconds: moderation.MAX_TIMEOUT_SECONDS },
];

export const INDEFINITE = 'indefinite';

/** Quarantine presets — indefinite until released, or up to 90 days. */
export const QUARANTINE_PRESETS: readonly DurationPreset[] = [
  { key: INDEFINITE, label: 'Until released', seconds: null },
  { key: '1h', label: '1 hour', seconds: SECONDS.h },
  { key: '1d', label: '1 day', seconds: SECONDS.d },
  { key: '7d', label: '7 days', seconds: 7 * SECONDS.d },
  { key: '28d', label: '28 days', seconds: 28 * SECONDS.d },
  { key: '90d', label: '90 days (maximum)', seconds: moderation.MAX_QUARANTINE_SECONDS },
];

/** Ban: how much of the member's message history Discord deletes. */
export const BAN_DELETE_PRESETS = [
  { key: '0', label: 'Keep messages', days: 0 },
  { key: '1', label: 'Delete the last 24 hours', days: 1 },
  { key: '7', label: 'Delete the last 7 days', days: moderation.MAX_BAN_DELETE_MESSAGE_DAYS },
] as const;

/**
 * "10m", "1h30m", "7d" → seconds. Bare numbers are refused (ambiguous), as is
 * anything that is not a clean sequence of number+unit pairs.
 */
export function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const compact = text.toLowerCase().replace(/\s+/g, '');
  if (compact.length === 0 || compact.length > MAX_DURATION_TEXT) return null;
  if (!DURATION_SHAPE.test(compact)) return null;
  let total = 0;
  for (const match of compact.matchAll(DURATION_PART)) {
    total += Number(match[1]) * SECONDS[match[2] as Unit];
  }
  return total > 0 ? total : null;
}

/** 5400 → "1h 30m" (largest two units). */
export function describeDuration(seconds: number): string {
  return moderation.formatDuration(seconds);
}

/** 5400 → "1h30m": a key parseDuration understands. */
export function durationKey(seconds: number): string {
  let rest = Math.max(0, Math.floor(seconds));
  const parts: string[] = [];
  for (const unit of UNIT_ORDER) {
    const count = Math.floor(rest / SECONDS[unit]);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      rest -= count * SECONDS[unit];
    }
  }
  return parts.join('') || '0s';
}

/** Resolve a preset key or free text within [min, max]; null when invalid. */
export function resolveDuration(
  value: string | null | undefined,
  bounds: { min: number; max: number },
): number | null {
  const seconds = parseDuration(value);
  if (seconds === null || seconds < bounds.min || seconds > bounds.max) return null;
  return seconds;
}

export const TIMEOUT_BOUNDS = {
  min: moderation.MIN_TIMEOUT_SECONDS,
  max: moderation.MAX_TIMEOUT_SECONDS,
} as const;
export const QUARANTINE_BOUNDS = {
  min: moderation.MIN_QUARANTINE_SECONDS,
  max: moderation.MAX_QUARANTINE_SECONDS,
} as const;

/** Autocomplete: the presets matching what was typed, plus a valid custom value first. */
export function durationChoices(
  presets: readonly DurationPreset[],
  typed: string,
  bounds: { min: number; max: number },
): AutocompleteChoice[] {
  const query = typed.trim().toLowerCase();
  const matching = presets
    .filter((p) => !query || p.key.startsWith(query) || p.label.toLowerCase().includes(query))
    .map((p) => ({ name: `${p.key.toUpperCase()} — ${p.label}`, value: p.key }));
  const custom = resolveDuration(query, bounds);
  if (custom !== null && !presets.some((p) => p.seconds === custom)) {
    const key = durationKey(custom);
    return [
      { name: `${key.toUpperCase()} — ${describeDuration(custom)}`, value: key },
      ...matching,
    ];
  }
  return matching;
}
