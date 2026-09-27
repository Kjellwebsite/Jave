import { eq, sql } from 'drizzle-orm';
import { serverSettings } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { recordAudit } from '../audit/audit.service';
import { authorize } from '../permissions/authorize';
import { publishEvent } from '../events/bus';
import { scheduleRoleResyncForAll } from '../identity/role-resync';
import {
  type AllSettings,
  SETTINGS_SECTIONS,
  type Settings,
  type SettingsSection,
  settingsSchemas,
} from './schemas';

const CACHE_TTL_MS = 15_000;
const cacheKey = (section: SettingsSection) => `settings:${section}`;
/** pg_advisory_xact_lock namespace serializing writes of one settings section. */
const SETTINGS_LOCK_NAMESPACE = 424_202;

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

/**
 * A new JAVE → Discord role mapping (or sync switched back on) must reach
 * members whose JAVE roles did not change, so every present member is re-synced.
 */
function needsRoleResync(
  section: SettingsSection,
  changes: Record<string, unknown>,
  next: unknown,
) {
  if (section !== 'roles') return false;
  const roles = next as Settings<'roles'>;
  return 'discordRoleIds' in changes || ('syncToDiscord' in changes && roles.syncToDiscord);
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
 * A partial value merged over the current section, or a function of the
 * current (fresh, locked) value — for fields such as maps that must be
 * derived from what is stored now, not from a cached copy.
 */
export type SettingsPatch<S extends SettingsSection> =
  Partial<Settings<S>> | ((current: Settings<S>) => Partial<Settings<S>>);

/**
 * Replace a settings section with a validated value (the patch is merged
 * over the current value). Audited with a field-level diff.
 *
 * The current value is read fresh inside the transaction, never from the
 * per-process cache: another process (bot or dashboard) may have changed the
 * section within the cache's lifetime, and merging over a stale copy would
 * silently undo that change. Writes of one section are serialized with a
 * transaction-scoped advisory lock rather than a row lock, because the row
 * does not exist before the section's first write.
 */
export async function updateSettings<S extends SettingsSection>(
  ctx: ServiceContext,
  section: S,
  patch: SettingsPatch<S>,
): Promise<Settings<S>> {
  await authorize(ctx, 'canManageSettings', { type: 'settings', id: section });
  if (!SETTINGS_SECTIONS.includes(section))
    throw new ValidationError(`Unknown settings section ${section}`);
  const outcome = await withTransaction(ctx, async (tx) => {
    await tx.db.execute(
      sql`select pg_advisory_xact_lock(${SETTINGS_LOCK_NAMESPACE}::int, hashtext(${section}))`,
    );
    const [row] = await tx.db
      .select({ value: serverSettings.value })
      .from(serverSettings)
      .where(eq(serverSettings.section, section));
    const current = parseStored(section, row?.value);
    const merged = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    const result = settingsSchemas[section].safeParse(merged);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new ValidationError(
        `Invalid ${section} settings: ${issues[0]?.path} ${issues[0]?.message}`,
        issues,
      );
    }
    const next = result.data as Settings<S>;
    const changes = diff(current as Record<string, unknown>, next as Record<string, unknown>);
    if (Object.keys(changes).length === 0) return { value: current, changed: false };

    const now = tx.clock.now();
    const updatedBy = tx.actor.kind === 'user' ? tx.actor.userId : null;
    await tx.db
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
    await recordAudit(tx, {
      action: 'settings.updated',
      targetType: 'settings',
      targetId: section,
      context: { changes },
    });
    await publishEvent(tx, {
      type: 'settings.updated',
      aggregateType: 'settings',
      aggregateId: section,
      payload: { section, fields: Object.keys(changes) },
    });
    if (needsRoleResync(section, changes, next)) await scheduleRoleResyncForAll(tx);
    return { value: next, changed: true };
  });
  if (outcome.changed) ctx.cache.delete(cacheKey(section));
  return outcome.value;
}
