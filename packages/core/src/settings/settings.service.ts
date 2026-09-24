import { eq, sql } from 'drizzle-orm';
import { serverSettings } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { recordAudit } from '../audit/audit.service';
import { authorize } from '../permissions/authorize';
import { publishEvent } from '../events/bus';
import {
  type AllSettings,
  SETTINGS_SECTIONS,
  type Settings,
  type SettingsSection,
  settingsSchemas,
} from './schemas';

const CACHE_TTL_MS = 15_000;
const cacheKey = (section: SettingsSection) => `settings:${section}`;

function parseStored<S extends SettingsSection>(section: S, stored: unknown): Settings<S> {
  const schema = settingsSchemas[section];
  const result = schema.safeParse(stored ?? {});
  // A stored value that no longer validates (e.g. after a schema change) falls back to defaults
  // per-field rather than taking the bot down.
  return (result.success ? result.data : schema.parse({})) as Settings<S>;
}

/** Read a settings section (defaults merged). Cached briefly per process. */
export async function getSettings<S extends SettingsSection>(
  ctx: ServiceContext,
  section: S,
): Promise<Settings<S>> {
  return ctx.cache.getOrLoad(cacheKey(section), CACHE_TTL_MS, async () => {
    const [row] = await ctx.db
      .select({ value: serverSettings.value })
      .from(serverSettings)
      .where(eq(serverSettings.section, section));
    return parseStored(section, row?.value);
  });
}

export async function getAllSettings(ctx: ServiceContext): Promise<AllSettings> {
  await authorize(ctx, 'canViewSettings');
  const entries = await Promise.all(
    SETTINGS_SECTIONS.map(async (section) => [section, await getSettings(ctx, section)] as const),
  );
  return Object.fromEntries(entries) as AllSettings;
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

/**
 * Replace a settings section with a validated value (partial input is merged
 * over the current value). Audited with a field-level diff.
 */
export async function updateSettings<S extends SettingsSection>(
  ctx: ServiceContext,
  section: S,
  patch: Partial<Settings<S>>,
): Promise<Settings<S>> {
  await authorize(ctx, 'canManageSettings', { type: 'settings', id: section });
  if (!SETTINGS_SECTIONS.includes(section))
    throw new ValidationError(`Unknown settings section ${section}`);
  const current = await getSettings(ctx, section);
  const merged = { ...current, ...patch };
  const result = settingsSchemas[section].safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new ValidationError(
      `Invalid ${section} settings: ${issues[0]?.path} ${issues[0]?.message}`,
      issues,
    );
  }
  const next = result.data as Settings<S>;
  const changes = diff(current as Record<string, unknown>, next as Record<string, unknown>);
  if (Object.keys(changes).length === 0) return current;

  const now = ctx.clock.now();
  const updatedBy = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  await ctx.db
    .insert(serverSettings)
    .values({
      section,
      value: next as Record<string, unknown>,
      updatedByUserId: updatedBy,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: serverSettings.section,
      set: {
        value: next as Record<string, unknown>,
        updatedByUserId: updatedBy,
        updatedAt: now,
        version: sql`${serverSettings.version} + 1`,
      },
    });
  ctx.cache.delete(cacheKey(section));
  await recordAudit(ctx, {
    action: 'settings.updated',
    targetType: 'settings',
    targetId: section,
    context: { changes },
  });
  await publishEvent(ctx, {
    type: 'settings.updated',
    aggregateType: 'settings',
    aggregateId: section,
    payload: { section, fields: Object.keys(changes) },
  });
  return next;
}
