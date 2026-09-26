import type { z } from 'zod';
import { auditQuerySchema } from '@jave/core';
import { zonedDayBounds } from './time';

/** URL parameters of the audit log filter form, in display order. */
export const AUDIT_FILTER_KEYS = [
  'action',
  'result',
  'targetType',
  'targetId',
  'actor',
  'since',
  'until',
] as const;

export type AuditFilterKey = (typeof AUDIT_FILTER_KEYS)[number];
export type AuditFilterValues = Partial<Record<AuditFilterKey, string>>;

/** How each filter is named to the user when it cannot be applied. */
export const AUDIT_FILTER_LABELS: Record<AuditFilterKey, string> = {
  action: 'action',
  result: 'result',
  targetType: 'target type',
  targetId: 'target ID',
  actor: 'actor',
  since: 'from date',
  until: 'to date',
};

type AuditQuery = Omit<z.input<typeof auditQuerySchema>, 'limit' | 'offset'>;

export interface AuditFilters {
  /** Every valid filter, in the shape listAuditLogs expects. */
  query: AuditQuery;
  /** The submitted values of the filters that were applied (for links and paging). */
  applied: AuditFilterValues;
  /** Filters that were submitted but are not valid: ignored, and named to the user. */
  rejected: AuditFilterKey[];
}

const shape = auditQuerySchema.shape;

/** Validates one filter on its own, so a single bad value never discards the others. */
function toQuery(
  key: AuditFilterKey,
  value: string,
  timeZone: string,
): Partial<AuditQuery> | null {
  const valid = <T>(schema: z.ZodType<T>, input: unknown): T | null => {
    const parsed = schema.safeParse(input);
    return parsed.success ? parsed.data : null;
  };
  switch (key) {
    case 'action': {
      const action = valid(shape.action, value);
      return action ? { action } : null;
    }
    case 'result': {
      const result = valid(shape.result, value);
      return result ? { result } : null;
    }
    case 'targetType': {
      const targetType = valid(shape.targetType, value);
      return targetType ? { targetType } : null;
    }
    case 'targetId': {
      const targetId = valid(shape.targetId, value);
      return targetId ? { targetId } : null;
    }
    case 'actor': {
      const actorUserId = valid(shape.actorUserId, value);
      return actorUserId ? { actorUserId } : null;
    }
    case 'since': {
      const bounds = zonedDayBounds(value, timeZone);
      return bounds ? { since: bounds.start } : null;
    }
    case 'until': {
      const bounds = zonedDayBounds(value, timeZone);
      return bounds ? { until: bounds.end } : null;
    }
  }
}

/**
 * Turns the submitted filter values into a listAuditLogs query. Each filter
 * is validated independently; dates are calendar days in the viewer's time
 * zone (the zone every timestamp on the page is shown in), both inclusive.
 */
export function parseAuditFilters(raw: AuditFilterValues, timeZone: string): AuditFilters {
  const filters: AuditFilters = { query: {}, applied: {}, rejected: [] };
  for (const key of AUDIT_FILTER_KEYS) {
    const value = raw[key]?.trim();
    if (!value) continue;
    const query = toQuery(key, value, timeZone);
    if (query) {
      Object.assign(filters.query, query);
      filters.applied[key] = value;
    } else {
      filters.rejected.push(key);
    }
  }
  return filters;
}

function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** "The actor filter is not valid and was not applied. The other filters still apply." */
export function describeRejectedFilters(filters: AuditFilters): string | null {
  if (filters.rejected.length === 0) return null;
  const names = listLabels(filters.rejected.map((key) => AUDIT_FILTER_LABELS[key]));
  const single = filters.rejected.length === 1;
  const head = single
    ? `The ${names} filter is not valid and was not applied.`
    : `The ${names} filters are not valid and were not applied.`;
  const rest =
    Object.keys(filters.applied).length > 0
      ? 'The other filters still apply.'
      : 'Showing all entries.';
  return `${head} ${rest}`;
}
