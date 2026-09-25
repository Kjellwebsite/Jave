import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultSettings,
  getSettings,
  ROLES,
  SETTINGS_SECTIONS,
  settingsSchemas,
  updateSettings,
} from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { ROLE_KEYS, roleVisual } from '@jave/ui/roles';
import { parseSettingsForm, SETTINGS_FORM, settingsSpec, valueAtPath } from './settings-form';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe('settings form coverage', () => {
  it('has exactly one form section per settings section', () => {
    expect(SETTINGS_FORM.map((spec) => spec.section).sort()).toEqual([...SETTINGS_SECTIONS].sort());
  });

  it.each(SETTINGS_SECTIONS)(
    '%s: every schema field has a control, and every control a field',
    (section) => {
      const spec = settingsSpec(section)!;
      const paths = new Set(spec.fields.map((field) => field.path));
      const defaults = defaultSettings(section) as Record<string, unknown>;
      const expected: string[] = [];
      for (const key of Object.keys(settingsSchemas[section].shape)) {
        const value = defaults[key];
        if (!paths.has(key) && isPlainObject(value) && Object.keys(value).length > 0) {
          for (const nested of Object.keys(value)) expected.push(`${key}.${nested}`);
        } else {
          expected.push(key);
        }
      }
      expect([...paths].sort()).toEqual(expected.sort());
    },
  );

  it.each(SETTINGS_SECTIONS)(
    '%s: rendering the defaults and submitting them unchanged validates',
    (section) => {
      const spec = settingsSpec(section)!;
      const defaults = defaultSettings(section);
      const data = new FormData();
      for (const field of spec.fields) {
        const value = valueAtPath(defaults, field.path);
        switch (field.control.kind) {
          case 'boolean':
            if (value === true) data.set(field.path, 'on');
            break;
          case 'roleSnowflakes':
            break;
          case 'domains':
            data.set(field.path, (value as string[]).join('\n'));
            break;
          case 'minuteList':
            data.set(field.path, (value as number[]).join(', '));
            break;
          case 'roles':
            for (const role of value as string[]) data.append(field.path, role);
            break;
          case 'quietHours':
            break;
          default:
            if (value !== undefined) data.set(field.path, String(value));
        }
      }
      const parsed = parseSettingsForm(spec, data);
      expect(parsed.errors).toEqual({});
      expect(settingsSchemas[section].parse(parsed.value)).toEqual(defaults);
    },
  );
});

describe('settings form parsing', () => {
  const moderation = settingsSpec('moderation')!;

  it('reads nested numbers, lists and role sets', () => {
    const data = new FormData();
    data.set('spam.maxMessages', '9');
    data.set('links.allowlist', 'example.com\n*.jave.example,  other.org ');
    data.append('exemptRoles', 'core');
    data.append('exemptRoles', 'core');
    data.append('exemptRoles', 'not-a-role');
    const { value, errors } = parseSettingsForm(moderation, data);
    expect(valueAtPath(value, 'spam.maxMessages')).toBe(9);
    expect(valueAtPath(value, 'links.allowlist')).toEqual([
      'example.com',
      '*.jave.example',
      'other.org',
    ]);
    expect(value.exemptRoles).toEqual(['core']);
    expect(errors['spam.windowSeconds']).toBe('Enter a whole number.');
  });

  it('BREAK: rejects non-numeric and fractional integers, and malformed quiet hours', () => {
    const data = new FormData();
    data.set('spam.maxMessages', '1e400');
    data.set('maxMentions', '2.5');
    expect(parseSettingsForm(moderation, data).errors).toMatchObject({
      'spam.maxMessages': expect.any(String),
      maxMentions: expect.any(String),
    });
    const notifications = settingsSpec('notifications')!;
    const quiet = new FormData();
    quiet.set('defaultQuietHours.enabled', 'on');
    quiet.set('defaultQuietHours.start', '25:00');
    quiet.set('defaultQuietHours.end', '07:00');
    expect(parseSettingsForm(notifications, quiet).errors.defaultQuietHours).toBeDefined();
    const off = new FormData();
    expect(parseSettingsForm(notifications, off).value.defaultQuietHours).toBeNull();
  });

  it('maps role → Discord role IDs, dropping blanks', () => {
    const data = new FormData();
    data.set('discordRoleIds.core', ' 123456789012345678 ');
    data.set('discordRoleIds.member', '');
    const { value } = parseSettingsForm(settingsSpec('roles')!, data);
    expect(value.discordRoleIds).toEqual({ core: '123456789012345678' });
  });
});

describe('settings form saving', () => {
  const WELCOME_CHANNEL = '123456789012345678';
  const MOD_LOG_CHANNEL = '223456789012345678';

  let kit: TestKit;

  beforeAll(async () => {
    kit = await createTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('BREAK: clearing a channel ID removes it instead of keeping the stored value', async () => {
    await updateSettings(kit.system, 'channels', {
      welcome: WELCOME_CHANNEL,
      modLog: MOD_LOG_CHANNEL,
    });
    const data = new FormData();
    data.set('welcome', '');
    data.set('modLog', MOD_LOG_CHANNEL);
    const parsed = parseSettingsForm(settingsSpec('channels')!, data);
    expect(parsed.errors).toEqual({});
    await updateSettings(kit.system, 'channels', parsed.value);
    const saved = await getSettings(kit.system, 'channels');
    expect(saved.welcome).toBeUndefined();
    expect(saved.modLog).toBe(MOD_LOG_CHANNEL);
  });
});

describe('role visual language', () => {
  it('stays aligned with the core role catalogue', () => {
    expect([...ROLE_KEYS]).toEqual(ROLES.map((role) => role.key));
    for (const role of ROLES) {
      expect(roleVisual(role.key).treatment, role.key).toBe(role.treatment);
      expect(roleVisual(role.key).label, role.key).toBe(role.label);
    }
  });
});
