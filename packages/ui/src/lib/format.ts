const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/** Grouped integer ("1,284"). Non-finite values render as an em dash. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return COUNT_FORMAT.format(Math.trunc(value));
}

export interface PageWindow {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  /** 1-based index of the first item on this page (0 when empty). */
  from: number;
  /** 1-based index of the last item on this page (0 when empty). */
  to: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Derive pagination state from an offset/limit page. Robust to out-of-range offsets. */
export function pageWindow(input: { offset: number; limit: number; total: number }): PageWindow {
  const limit = Math.max(1, Math.trunc(input.limit));
  const total = Math.max(0, Math.trunc(input.total));
  const offset = Math.max(0, Math.trunc(input.offset));
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pageCount, Math.floor(offset / limit) + 1);
  const inRange = offset < total;
  return {
    page,
    pageCount,
    from: inRange ? offset + 1 : 0,
    to: inRange ? Math.min(total, offset + limit) : 0,
    total,
    hasPrevious: page > 1 || (!inRange && total > 0),
    hasNext: page < pageCount,
  };
}

/** "1–25 of 132" */
export function formatRange(window: PageWindow): string {
  if (window.from === 0) return `0 of ${formatCount(window.total)}`;
  return `${formatCount(window.from)}–${formatCount(window.to)} of ${formatCount(window.total)}`;
}

/** Up to two initials from a display name, for avatar fallbacks. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  const joined = letters.join('').toUpperCase();
  return joined || '?';
}
