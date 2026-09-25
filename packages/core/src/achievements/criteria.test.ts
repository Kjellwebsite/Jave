import { describe, expect, it } from 'vitest';
import { DOMAIN_EVENT_TYPES } from '../events/catalog';
import { coreJobHandlers, coreRecurringJobs, coreSubscribers } from '../registry';
import {
  ACHIEVEMENT_EVENT_TYPES,
  achievementAnnouncementLine,
  achievementCriteriaSchema,
  achievementHeadline,
  FIRST_STEP_ONLY_EVENTS,
  FIRST_STEP_THRESHOLD,
  holderPercent,
  isAchievementEventType,
  MAX_EVENT_THRESHOLD,
  parseStoredCriteria,
  thresholdsMet,
  unlockSummary,
} from './criteria';
import { hasControlCharacters, httpUrl } from './guards';
import { createDefinitionSchema } from './schemas';
import { STARTER_ACHIEVEMENTS } from './starter';

describe('achievement criteria', () => {
  it('accepts event_count rules on eligible catalog events and manual rules', () => {
    expect(
      achievementCriteriaSchema.parse({
        type: 'event_count',
        event: 'project.shipped',
        threshold: 3,
      }),
    ).toEqual({ type: 'event_count', event: 'project.shipped', threshold: 3 });
    expect(achievementCriteriaSchema.parse({ type: 'manual' })).toEqual({ type: 'manual' });
  });

  it('rejects unknown events, excluded events and out-of-range thresholds', () => {
    const bad = [
      { type: 'event_count', event: 'project.teleported', threshold: 1 },
      { type: 'event_count', event: 'member.joined', threshold: 1 },
      { type: 'event_count', event: 'capability.claimed', threshold: 1 },
      { type: 'event_count', event: 'project.shipped', threshold: 0 },
      { type: 'event_count', event: 'project.shipped', threshold: 1.5 },
      { type: 'event_count', event: 'project.shipped', threshold: MAX_EVENT_THRESHOLD + 1 },
      { type: 'event_count', event: 'project.shipped' },
      { type: 'manual', event: 'project.shipped' },
      { type: 'streak', days: 7 },
    ];
    for (const criteria of bad) {
      expect(achievementCriteriaSchema.safeParse(criteria).success, JSON.stringify(criteria)).toBe(
        false,
      );
    }
  });

  it('is an explicit allow-list of verified-outcome catalog events', () => {
    for (const eligible of ACHIEVEMENT_EVENT_TYPES) expect(DOMAIN_EVENT_TYPES).toContain(eligible);
    expect([...ACHIEVEMENT_EVENT_TYPES].sort()).toEqual(
      [
        'adversarial.revealed',
        'application.accepted',
        'contribution.verified',
        'mission.completed',
        'project.created',
        'project.shipped',
        'research.verified',
        'trial.passed',
        'trial.result_published',
        'verification.approved',
      ].sort(),
    );
    for (const starter of STARTER_ACHIEVEMENTS) {
      if (starter.criteria.type !== 'event_count') continue;
      expect(isAchievementEventType(starter.criteria.event), starter.key).toBe(true);
    }
    // Everything else in the catalog drives nothing, including events appended later.
    const ineligible = DOMAIN_EVENT_TYPES.filter((type) => !isAchievementEventType(type));
    expect(ineligible.length).toBe(DOMAIN_EVENT_TYPES.length - ACHIEVEMENT_EVENT_TYPES.length);
    expect(isAchievementEventType('game.won')).toBe(false);
    expect(isAchievementEventType('message.sent')).toBe(false);
  });

  it('BREAK: Discord activity, unreviewed work and staff operations never drive achievements', () => {
    for (const event of [
      'tournament.match_completed',
      'game.completed',
      'event.checked_in',
      'event.rsvp',
      'member.joined',
      'member.onboarded',
      'trial.submission_received',
      'trial.participant_selected',
      'mission.submitted',
      'research.submitted',
      'contribution.submitted',
      'project.member_added',
      'trial.created',
      'event.created',
      'mission.published',
      'achievement.unlocked',
    ]) {
      const parsed = achievementCriteriaSchema.safeParse({
        type: 'event_count',
        event,
        threshold: 20,
      });
      expect(parsed.success, event).toBe(false);
      expect(ACHIEVEMENT_EVENT_TYPES as readonly string[], event).not.toContain(event);
    }
  });

  it('BREAK: first-step events count once only, so repeating them farms nothing', () => {
    expect(FIRST_STEP_ONLY_EVENTS.has('project.created')).toBe(true);
    expect(
      achievementCriteriaSchema.safeParse({
        type: 'event_count',
        event: 'project.created',
        threshold: FIRST_STEP_THRESHOLD,
      }).success,
    ).toBe(true);
    for (const threshold of [2, 10, MAX_EVENT_THRESHOLD]) {
      expect(
        achievementCriteriaSchema.safeParse({
          type: 'event_count',
          event: 'project.created',
          threshold,
        }).success,
        String(threshold),
      ).toBe(false);
    }
    for (const event of FIRST_STEP_ONLY_EVENTS) expect(ACHIEVEMENT_EVENT_TYPES).toContain(event);
  });

  it('treats stored rules that no longer validate as inert', () => {
    expect(parseStoredCriteria({ type: 'event_count', event: 'gone.event', threshold: 1 })).toBe(
      null,
    );
    expect(parseStoredCriteria(null)).toBe(null);
  });

  it('selects the rules whose threshold is met', () => {
    const rules = [1, 3, 10].map((threshold) => ({
      key: `t${threshold}`,
      criteria: { type: 'event_count' as const, event: 'project.shipped' as const, threshold },
    }));
    expect(thresholdsMet(rules, 0)).toEqual([]);
    expect(thresholdsMet(rules, 3).map((r) => r.key)).toEqual(['t1', 't3']);
    expect(thresholdsMet(rules, 99).map((r) => r.key)).toEqual(['t1', 't3', 't10']);
  });
});

describe('achievement copy', () => {
  it('formats the unlock line in the JAVE voice', () => {
    const builder = { title: 'Builder', summary: '3 projects shipped.' };
    expect(achievementHeadline(builder)).toBe('BUILDER — 3 projects shipped.');
    expect(achievementAnnouncementLine(builder)).toBe(
      'ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.',
    );
  });

  it('falls back to the title when no summary was written', () => {
    expect(unlockSummary({ title: 'Team Leader', summary: '  ' })).toBe('TEAM LEADER.');
  });

  it('computes holder percentages with one decimal and safe edges', () => {
    expect(holderPercent(0, 0)).toBe(0);
    expect(holderPercent(5, 0)).toBe(0);
    expect(holderPercent(1, 3)).toBe(33.3);
    expect(holderPercent(2, 3)).toBe(66.7);
    expect(holderPercent(4, 4)).toBe(100);
    expect(holderPercent(9, 4)).toBe(100);
  });
});

describe('starter catalog', () => {
  it('is valid, uniquely keyed and includes a few hidden entries', () => {
    const keys = new Set<string>();
    for (const starter of STARTER_ACHIEVEMENTS) {
      expect(() => createDefinitionSchema.parse(starter)).not.toThrow();
      keys.add(starter.key);
    }
    expect(keys.size).toBe(STARTER_ACHIEVEMENTS.length);
    const hidden = STARTER_ACHIEVEMENTS.filter((s) => s.visibility === 'hidden');
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(hidden.length).toBeLessThanOrEqual(3);
    for (const key of [
      'first_mission',
      'first_project',
      'first_verified_contribution',
      'first_trial',
      'trial_pass',
      'researcher',
      'builder',
      'operator',
      'team_leader',
      'project_shipped',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it('writes summaries as calm, short sentences without emoji', () => {
    for (const starter of STARTER_ACHIEVEMENTS) {
      expect(starter.summary).toMatch(/^[A-Z0-9][^!]*\.$/);
      expect(starter.summary).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(starter.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('input guards', () => {
  it('detects control characters', () => {
    expect(hasControlCharacters('plain text', false)).toBe(false);
    expect(hasControlCharacters('tab\tok', false)).toBe(false);
    expect(hasControlCharacters('two\nlines', false)).toBe(true);
    expect(hasControlCharacters('two\nlines', true)).toBe(false);
    expect(hasControlCharacters('bell\u0007', true)).toBe(true);
    expect(hasControlCharacters('nul\u0000', true)).toBe(true);
    expect(hasControlCharacters('del\u007f', true)).toBe(true);
  });

  it('accepts only http(s) URLs', () => {
    expect(httpUrl.safeParse('https://example.com/x').success).toBe(true);
    expect(httpUrl.safeParse('http://example.com').success).toBe(true);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'not a url',
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      expect(httpUrl.safeParse(url).success, url).toBe(false);
    }
  });
});

describe('module wiring', () => {
  it('registers the engine, the evaluation job and the mission sweeps in the core registry', () => {
    const handlers = coreJobHandlers();
    for (const type of [
      'achievements.evaluate_definition',
      'missions.expire_overdue',
      'missions.deadline_reminders',
    ]) {
      expect(handlers[type], type).toBeTypeOf('function');
    }
    expect(coreSubscribers.map((s) => s.name)).toContain('achievements.engine');
    expect(coreRecurringJobs.map((j) => j.type)).toEqual(
      expect.arrayContaining(['missions.expire_overdue', 'missions.deadline_reminders']),
    );
    // Discord side effects belong to the bot; core never registers a discord.* handler.
    for (const type of Object.keys(handlers)) expect(type.startsWith('discord.')).toBe(false);
  });
});
