export type SearchParams = Record<string, string | string[] | undefined>;

const MAX_PARAM_LENGTH = 256;

/** The first value of a query parameter, capped in length. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === undefined ? undefined : raw.slice(0, MAX_PARAM_LENGTH);
}

/** `?a=1&b=x` from the defined, non-empty entries (or '' when none remain). */
export function toQueryString(entries: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Non-negative integer offset from a query parameter (0 when absent or malformed). */
export function offsetParam(value: string | string[] | undefined, max = 100_000): number {
  const parsed = Number(firstParam(value));
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, max);
}
