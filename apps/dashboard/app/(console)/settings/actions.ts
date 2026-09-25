'use server';

import { revalidatePath } from 'next/cache';
import { type Settings, type SettingsSection, updateSettings, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { parseSettingsForm, settingsSpec } from '@/lib/settings-form';
import { runAction } from '@/server/actions';

/**
 * Saves one settings section. `section` is bound by the page but still
 * untrusted: it is resolved against the known spec, and updateSettings
 * authorizes (canManageSettings), validates and audits with a field diff.
 */
export async function saveSettingsAction(
  section: string,
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const spec = settingsSpec(section);
  return runAction(
    'settings.update',
    async (ctx) => {
      if (!spec) throw new ValidationError('Unknown settings section.');
      const parsed = parseSettingsForm(spec, data);
      const problems = Object.entries(parsed.errors).map(([path, message]) => ({ path, message }));
      if (problems.length > 0) throw new ValidationError('Check the highlighted fields.', problems);
      await updateSettings(ctx, spec.section, parsed.value as Partial<Settings<SettingsSection>>);
      revalidatePath('/settings');
      return `${spec.title.toUpperCase()} SAVED.`;
    },
    { fieldNames: spec?.fields.map((field) => field.path) ?? [] },
  );
}
