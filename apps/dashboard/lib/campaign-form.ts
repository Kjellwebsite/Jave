/**
 * Campaign windows are entered as whole UTC days: the start day begins at
 * 00:00 UTC, the end day is inclusive (the window closes at the following
 * midnight). Same convention as the bot's campaign modal. Client-safe.
 */

const DAY_MS = 86_400_000;
const ISO_DAY_LENGTH = 10;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CampaignDayField = 'startsAt' | 'endsAt';

export type ParsedDay = { ok: true; value: Date | null } | { ok: false };

/** 'YYYY-MM-DD' → the boundary instant; '' → null (open); anything else → not ok. */
export function parseCampaignDay(raw: string, field: CampaignDayField): ParsedDay {
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  if (!ISO_DAY_PATTERN.test(value)) return { ok: false };
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, ISO_DAY_LENGTH) !== value) {
    return { ok: false };
  }
  return { ok: true, value: field === 'endsAt' ? new Date(start.getTime() + DAY_MS) : start };
}

/** The day a boundary shows as in a date input ('' when open). */
export function campaignDayValue(at: Date | null, field: CampaignDayField): string {
  if (!at) return '';
  const instant = field === 'endsAt' ? new Date(at.getTime() - 1) : at;
  return instant.toISOString().slice(0, ISO_DAY_LENGTH);
}
