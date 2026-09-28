import { describe, expect, it } from 'vitest';
import { achievements, missions } from '@jave/core';
import { ruleEventOptions } from '@/server/data/achievements';
import { criteriaFrom, definitionFields } from './achievement-form';
import { ACHIEVEMENT_FORM_LIMITS, MISSION_FORM_LIMITS } from './form-limits';
import { RULE_EVENT_LABELS, ruleEventLabel, ruleText } from './achievement-labels';
import { type MemberOption, toggleSelection } from './member-search';
import {
  deadlineInputValue,
  editedDeadline,
  INVALID_DATE,
  missionFormInput,
  parseDeadlineInput,
} from './mission-form';
import { holdingLabel, rewardLabel, showsDueDate, slotsLabel } from './mission-labels';
import { NAV_GROUPS, visibleNav } from './nav';

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe('mission form', () => {
  it("reads blanks as none and the deadline in the viewer's time zone", () => {
    const entries = {
      title: 'Prototype sprint',
      brief: 'Ship it.',
      type: 'build',
      facetKey: '',
      maxAssignees: '',
      durationHours: '72',
      deadlineAt: '2026-10-10T18:00',
      evidenceRequired: 'on',
    };
    const input = missionFormInput(form(entries), 'Europe/Berlin');
    expect(input).toMatchObject({
      type: 'build',
      facetKey: null,
      maxAssignees: null,
      durationHours: 72,
      evidenceRequired: true,
      selfAssignable: false,
      rewardAchievementKey: null,
    });
    // 18:00 in Berlin (CEST, UTC+2) is 16:00 UTC; the form shows it back as typed.
    expect(input.deadlineAt?.toISOString()).toBe('2026-10-10T16:00:00.000Z');
    expect(deadlineInputValue(input.deadlineAt, 'Europe/Berlin')).toBe('2026-10-10T18:00');
    expect(missionFormInput(form(entries), 'UTC').deadlineAt?.toISOString()).toBe(
      '2026-10-10T18:00:00.000Z',
    );
    expect(deadlineInputValue(null, 'Europe/Berlin')).toBe('');
  });

  it('leaves an untouched deadline exactly as stored on edit, even a passed one', () => {
    // Stored to the second; the form shows it to the minute.
    const stored = new Date('2026-09-20T16:00:30.000Z');
    const shown = deadlineInputValue(stored, 'Europe/Berlin');
    expect(shown).toBe('2026-09-20T18:00');
    expect(editedDeadline(form({ deadlineAt: shown }), stored, 'Europe/Berlin')).toBeUndefined();
    expect(editedDeadline(form({ deadlineAt: '' }), null, 'Europe/Berlin')).toBeUndefined();
    expect(editedDeadline(form({ deadlineAt: '' }), stored, 'Europe/Berlin')).toBeNull();
    expect(
      editedDeadline(
        form({ deadlineAt: '2026-09-21T09:30' }),
        stored,
        'Europe/Berlin',
      )?.toISOString(),
    ).toBe('2026-09-21T07:30:00.000Z');
    expect(editedDeadline(form({ deadlineAt: 'soon' }), stored, 'Europe/Berlin')).toBe(
      INVALID_DATE,
    );
  });

  it('BREAK: impossible dates, forged types and junk numbers never pass as valid', () => {
    expect(parseDeadlineInput('2026-02-30T10:00', 'UTC')).toBe(INVALID_DATE);
    expect(parseDeadlineInput('tomorrow', 'UTC')).toBe(INVALID_DATE);
    expect(parseDeadlineInput('2026-12-01T18:30Z; drop', 'UTC')).toBe(INVALID_DATE);
    expect(parseDeadlineInput('2026-12-01T25:00', 'Europe/Berlin')).toBe(INVALID_DATE);
    expect(parseDeadlineInput(undefined, 'UTC')).toBeNull();
    // An unknown stored zone reads as UTC, as every timestamp on the page does.
    expect(parseDeadlineInput('2026-12-01T18:30', 'Mars/Olympus')?.toISOString()).toBe(
      '2026-12-01T18:30:00.000Z',
    );
    const input = missionFormInput(form({ type: 'constructor', maxAssignees: '1e9x' }), 'UTC');
    expect(input.type).toBeUndefined();
    expect(Number.isNaN(input.maxAssignees)).toBe(true);
  });

  it('labels holdings and slots with and without a cap', () => {
    expect(holdingLabel(3, 10)).toBe('3 of 10');
    expect(holdingLabel(0, null)).toBe('0 · no cap');
    expect(slotsLabel(3, 10)).toBe('7 of 10 left');
    expect(slotsLabel(10, 10)).toBe('Full · 10 of 10');
    expect(slotsLabel(4, null)).toBe('No cap · 4 taking part');
  });

  it('shows a due date only while the work can still fall due', () => {
    expect(missions.ASSIGNMENT_STATUSES.filter(showsDueDate)).toEqual([
      'assigned',
      'accepted',
      'rejected',
    ]);
  });

  it('labels rewards, masking a hidden one to its rarity', () => {
    expect(rewardLabel(null)).toBe('—');
    expect(rewardLabel({ hidden: false, key: 'builder', title: 'Builder', rarity: 'rare' })).toBe(
      'Builder · rare',
    );
    expect(rewardLabel({ hidden: true, rarity: 'exceptional' })).toBe(
      'Hidden achievement · exceptional',
    );
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

  it('offers exactly the core allow-list of events, each labelled, first steps flagged', () => {
    const options = ruleEventOptions();
    expect(options.map((option) => option.value)).toEqual([
      ...achievements.ACHIEVEMENT_EVENT_TYPES,
    ]);
    expect(Object.keys(RULE_EVENT_LABELS).sort()).toEqual(
      [...achievements.ACHIEVEMENT_EVENT_TYPES].sort(),
    );
    for (const option of options) expect(option.label).not.toBe(option.value);
    expect(options.filter((option) => option.firstStep).map((option) => option.value)).toEqual([
      ...achievements.FIRST_STEP_ONLY_EVENTS,
    ]);
    expect(ruleEventLabel('member.joined')).toBe('member.joined');
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
});

describe('member picker selection', () => {
  const mara: MemberOption = { memberId: 'a', displayName: 'Mara Voss', handle: 'mara' };
  const jun: MemberOption = { memberId: 'b', displayName: 'Jun Park', handle: 'jun' };
  const sana: MemberOption = { memberId: 'c', displayName: 'Sana Okafor', handle: 'sana' };

  it('toggles members in and out, keeping the order of picks', () => {
    const picked = toggleSelection(toggleSelection([], mara, 3), jun, 3);
    expect(picked.map((member) => member.handle)).toEqual(['mara', 'jun']);
    expect(toggleSelection(picked, mara, 3).map((member) => member.handle)).toEqual(['jun']);
  });

  it('BREAK: refuses a pick past the cap instead of dropping an earlier one', () => {
    const full = toggleSelection(toggleSelection([], mara, 2), jun, 2);
    expect(toggleSelection(full, sana, 2).map((member) => member.handle)).toEqual(['mara', 'jun']);
  });
});

/** The longest value a pattern accepts, from lowercase letters. */
function patternMax(pattern: RegExp): number {
  let length = 1;
  while (pattern.test('a'.repeat(length + 1))) length++;
  return length;
}

describe('form limits mirrored in the browser', () => {
  it('equal the mission service limits', () => {
    expect(MISSION_FORM_LIMITS).toEqual({
      titleMin: missions.TITLE_MIN,
      titleMax: missions.TITLE_MAX,
      briefMin: missions.BRIEF_MIN,
      briefMax: missions.BRIEF_MAX,
      rewardNoteMax: missions.REWARD_NOTE_MAX,
      maxAssignees: missions.MAX_ASSIGNEES_LIMIT,
      durationHoursMax: missions.MAX_DURATION_HOURS,
      submissionMax: missions.SUBMISSION_MAX,
      evidenceTitleMax: missions.EVIDENCE_TITLE_MAX,
      evidenceUrlMax: MISSION_FORM_LIMITS.evidenceUrlMax,
      feedbackMin: missions.FEEDBACK_MIN,
      feedbackMax: missions.FEEDBACK_MAX,
      assignBatchMax: missions.MAX_ASSIGN_BATCH,
      teamKeyMax: patternMax(missions.TEAM_KEY_PATTERN),
    });
    const evidence = (length: number) =>
      missions.submitMissionSchema.safeParse({
        assignmentId: '00000000-0000-4000-8000-000000000000',
        submission: 'Done.',
        evidence: {
          title: 'Log',
          url: `https://example.org/${'a'.repeat(length - 'https://example.org/'.length)}`,
        },
      }).success;
    expect(evidence(MISSION_FORM_LIMITS.evidenceUrlMax)).toBe(true);
    expect(evidence(MISSION_FORM_LIMITS.evidenceUrlMax + 1)).toBe(false);
  });

  it('equal the achievements service limits', () => {
    expect(ACHIEVEMENT_FORM_LIMITS).toEqual({
      keyMax: patternMax(achievements.ACHIEVEMENT_KEY_PATTERN),
      titleMax: achievements.TITLE_MAX,
      summaryMax: achievements.SUMMARY_MAX,
      descriptionMax: achievements.DESCRIPTION_MAX,
      categoryMax: patternMax(achievements.ACHIEVEMENT_CATEGORY_PATTERN),
      thresholdMax: achievements.MAX_EVENT_THRESHOLD,
      ordinalMax: achievements.MAX_ORDINAL,
      reasonMin: achievements.REASON_MIN,
      reasonMax: achievements.REASON_MAX,
    });
  });
});

describe('navigation', () => {
  it('shows missions and achievements to every signed-in user', () => {
    const hrefs = visibleNav(NAV_GROUPS, []).flatMap((group) => group.items.map((i) => i.href));
    expect(hrefs).toEqual(expect.arrayContaining(['/missions', '/achievements']));
  });
});
