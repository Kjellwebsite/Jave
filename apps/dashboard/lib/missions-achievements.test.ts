import { describe, expect, it } from 'vitest';
import { achievements } from '@jave/core';
import { criteriaFrom, definitionFields, handleFrom } from './achievement-form';
import { RULE_EVENT_LABELS, ruleText } from './achievement-labels';
import { INVALID_DATE, missionFormInput, parseUtcInput } from './mission-form';
import { holdingLabel, toUtcInputValue } from './mission-labels';
import { NAV_GROUPS, visibleNav } from './nav';

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe('mission form', () => {
  it('reads blanks as none and datetime-local values as UTC', () => {
    const input = missionFormInput(
      form({
        title: 'Prototype sprint',
        brief: 'Ship it.',
        type: 'build',
        facetKey: '',
        maxAssignees: '',
        durationHours: '72',
        deadlineAt: '2026-12-01T18:30',
        evidenceRequired: 'on',
      }),
    );
    expect(input).toMatchObject({
      type: 'build',
      facetKey: null,
      maxAssignees: null,
      durationHours: 72,
      evidenceRequired: true,
      selfAssignable: false,
      rewardAchievementKey: null,
    });
    expect(input.deadlineAt?.toISOString()).toBe('2026-12-01T18:30:00.000Z');
    expect(toUtcInputValue(input.deadlineAt)).toBe('2026-12-01T18:30');
  });

  it('BREAK: impossible dates, forged types and junk numbers never pass as valid', () => {
    expect(parseUtcInput('2026-02-30T10:00')).toBe(INVALID_DATE);
    expect(parseUtcInput('tomorrow')).toBe(INVALID_DATE);
    expect(parseUtcInput('2026-12-01T18:30Z; drop')).toBe(INVALID_DATE);
    expect(parseUtcInput(undefined)).toBeNull();
    const input = missionFormInput(form({ type: 'constructor', maxAssignees: '1e9x' }));
    expect(input.type).toBeUndefined();
    expect(Number.isNaN(input.maxAssignees)).toBe(true);
  });

  it('labels holdings with and without a cap', () => {
    expect(holdingLabel(3, 10)).toBe('3 of 10');
    expect(holdingLabel(0, null)).toBe('0 · no cap');
  });
});

describe('achievement definition form', () => {
  it('builds manual and event-count rules the service accepts', () => {
    expect(criteriaFrom(form({ ruleType: 'manual', event: 'mission.completed' }))).toEqual({
      type: 'manual',
    });
    const rule = criteriaFrom(
      form({ ruleType: 'event_count', event: 'mission.completed', threshold: '10' }),
    );
    expect(rule).toEqual({ type: 'event_count', event: 'mission.completed', threshold: 10 });
    expect(achievements.achievementCriteriaSchema.safeParse(rule).success).toBe(true);
    expect(ruleText(rule)).toBe('Mission verified × 10');
  });

  it('offers exactly the core allow-list of events', () => {
    expect(Object.keys(RULE_EVENT_LABELS)).toEqual([...achievements.ACHIEVEMENT_EVENT_TYPES]);
  });

  it('BREAK: farmable or forged rules are refused by the service schema', () => {
    const farm = criteriaFrom(
      form({ ruleType: 'event_count', event: 'project.created', threshold: '50' }),
    );
    expect(achievements.achievementCriteriaSchema.safeParse(farm).success).toBe(false);
    const activity = criteriaFrom(
      form({ ruleType: 'event_count', event: 'member.joined', threshold: '1' }),
    );
    expect(achievements.achievementCriteriaSchema.safeParse(activity).success).toBe(false);
    const blank = criteriaFrom(form({ ruleType: 'event_count', event: 'trial.passed' }));
    expect(achievements.achievementCriteriaSchema.safeParse(blank).success).toBe(false);
    expect(ruleText(null)).toBe('Inert rule');
  });

  it('falls back to safe enum values and reads switches', () => {
    const fields = definitionFields(
      form({ rarity: 'mythic', visibility: 'secret', active: 'on', ordinal: '' }),
    );
    expect(fields).toMatchObject({
      rarity: 'standard',
      visibility: 'public',
      active: true,
      requiresVerification: false,
      ordinal: 0,
      facetKey: null,
    });
  });

  it('normalizes typed handles', () => {
    expect(handleFrom(form({ handle: ' @Mara ' }))).toBe('mara');
    expect(handleFrom(form({}))).toBe('');
  });
});

describe('navigation', () => {
  it('shows missions and achievements to every signed-in user', () => {
    const hrefs = visibleNav(NAV_GROUPS, []).flatMap((group) => group.items.map((i) => i.href));
    expect(hrefs).toEqual(expect.arrayContaining(['/missions', '/achievements']));
  });
});
