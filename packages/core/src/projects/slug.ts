import { eq, like, or } from 'drizzle-orm';
import { type Database, projects } from '@jave/database';
import { randomCode } from '../kernel/crypto';

/** Leaves room for a "-NNNN" collision suffix inside the 64-char column. */
export const SLUG_BASE_MAX_LENGTH = 48;
const FALLBACK_SLUG = 'project';
const MAX_NUMBERED_SUFFIX = 1000;
const RANDOM_SUFFIX_LENGTH = 6;

/** Slugs that would collide with dashboard routes (/projects/new, …). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'new',
  'create',
  'edit',
  'settings',
  'admin',
  'api',
  'search',
  'mine',
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** URL-safe slug from a title: lowercase ASCII, hyphen-separated, bounded. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * First free slug for `base`: base, base-2, base-3 … Reserved slugs are
 * treated as taken. The unique index remains the final arbiter under races
 * (the caller retries with a random suffix on conflict).
 */
export async function availableSlug(db: Database, base: string): Promise<string> {
  const rows = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(or(eq(projects.slug, base), like(projects.slug, `${base}-%`)));
  const taken = new Set(rows.map((row) => row.slug));
  for (const reserved of RESERVED_SLUGS) taken.add(reserved);
  if (!taken.has(base)) return base;
  for (let n = 2; n < MAX_NUMBERED_SUFFIX; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return randomSlug(base);
}

export function randomSlug(base: string): string {
  return `${base}-${randomCode(RANDOM_SUFFIX_LENGTH).toLowerCase()}`;
}
