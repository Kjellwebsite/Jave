import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../kernel/clock';
import { InvalidStateError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { TRIAL_STATUSES } from './constants';
import { eligibilityProblem } from './guards';
import {
  applyToTrialSchema,
  createTemplateSchema,
  evaluateSchema,
  rubricSchema,
  submitSchema,
} from './schemas';
import { STARTER_TEMPLATES } from './starter-templates';
import { assertTransition, canTransition, TRIAL_TRANSITIONS } from './state-machine';
import { formatDuration, formatRemaining, formatUtc, trialTiming, warningSchedule } from './timing';

describe('state machine', () => {
  it('follows draft → recruiting → teams_assigned → active → evaluating → completed', () => {
    expect(canTransition('draft', 'recruiting')).toBe(true);
    expect(canTransition('recruiting', 'teams_assigned')).toBe(true);
    expect(canTransition('teams_assigned', 'teams_assigned')).toBe(true);
    expect(canTransition('teams_assigned', 'active')).toBe(true);
    expect(canTransition('active', 'evaluating')).toBe(true);
    expect(canTransition('evaluating', 'completed')).toBe(true);
  });

  it('cancels from every non-terminal state; terminal states are final', () => {
    for (const status of TRIAL_STATUSES) {
      const terminal = status === 'completed' || status === 'cancelled';
      expect(canTransition(status, 'cancelled')).toBe(!terminal);
      if (terminal) expect(TRIAL_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('BREAK: refuses skipped steps and reversals', () => {
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('recruiting', 'active')).toBe(false);
    expect(canTransition('active', 'recruiting')).toBe(false);
    expect(canTransition('evaluating', 'active')).toBe(false);
    expect(() => assertTransition({ number: 7, status: 'draft' }, 'active', 'start')).toThrow(
      InvalidStateError,
    );
  });
});

describe('timing', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const deadlineAt = new Date('2026-03-01T14:00:00Z');

  it('reports open, grace and closed phases', () => {
    const active = {
      status: 'active' as const,
      deadlineAt,
      graceMinutes: 15,
      submissionsClosedAt: null,
    };
    expect(trialTiming(active, now).phase).toBe('open');
    expect(trialTiming(active, now).remainingLabel).toBe('2h');
    expect(trialTiming(active, new Date(now.getTime() + 45 * MINUTE)).remainingLabel).toBe(
      '1h 15m',
    );
    expect(trialTiming(active, new Date(deadlineAt.getTime() + 5 * MINUTE)).phase).toBe('grace');
    expect(trialTiming(active, new Date(deadlineAt.getTime() + 15 * MINUTE)).phase).toBe('closed');
    expect(trialTiming({ ...active, submissionsClosedAt: now }, now).phase).toBe('closed');
    expect(trialTiming({ ...active, status: 'evaluating' }, now).phase).toBe('closed');
  });

  it('has no clock before the start, and a closed clock for trials cancelled before it', () => {
    const notStarted = { deadlineAt: null, graceMinutes: 0, submissionsClosedAt: null };
    expect(trialTiming({ ...notStarted, status: 'recruiting' }, now).phase).toBe('not_started');
    expect(trialTiming({ ...notStarted, status: 'cancelled' }, now).phase).toBe('closed');
  });

  it('schedules distinct future warnings, largest first', () => {
    const schedule = warningSchedule(deadlineAt, [10, 60, 60, 180, 0], now);
    expect(schedule.map((w) => w.minutes)).toEqual([60, 10]);
    expect(schedule[0]!.runAt.toISOString()).toBe('2026-03-01T13:00:00.000Z');
  });

  it('formats durations and remaining time', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(48 * 60)).toBe('48h');
    expect(formatDuration(108 * 60)).toBe('4d 12h');
    expect(formatRemaining(0)).toBe('closed');
    expect(formatRemaining(30_000)).toBe('under 1m');
    expect(formatRemaining(26 * HOUR)).toBe('1d 2h');
    expect(formatRemaining(24 * HOUR)).toBe('1d');
    expect(formatUtc(deadlineAt)).toBe('2026-03-01 14:00 UTC');
  });
});

describe('eligibility', () => {
  const good = { standing: 'good' as const, guildStatus: 'present' as const };
  it('admits TRIAL, VERIFIED and staff; refuses MEMBER, APPLICANT, SUPPORTER', () => {
    expect(eligibilityProblem({ ...good, roles: ['trial'] })).toBeNull();
    expect(eligibilityProblem({ ...good, roles: ['verified'] })).toBeNull();
    expect(eligibilityProblem({ ...good, roles: ['operations'] })).toBeNull();
    expect(eligibilityProblem({ ...good, roles: ['member'] })).not.toBeNull();
    expect(eligibilityProblem({ ...good, roles: ['applicant'] })).not.toBeNull();
    expect(eligibilityProblem({ ...good, roles: ['supporter'] })).not.toBeNull();
  });

  it('refuses members in bad standing or outside the server', () => {
    expect(
      eligibilityProblem({ ...good, roles: ['verified'], standing: 'restricted' }),
    ).not.toBeNull();
    expect(
      eligibilityProblem({ ...good, roles: ['verified'], guildStatus: 'departed' }),
    ).not.toBeNull();
  });
});

describe('input schemas', () => {
  const criterion = { key: 'shipped', label: 'Shipped', weight: 1 };

  it('every starter template is valid', () => {
    expect(STARTER_TEMPLATES).toHaveLength(6);
    for (const template of STARTER_TEMPLATES) {
      const parsed = parseInput(createTemplateSchema, template);
      expect(parsed.rubric.length).toBeGreaterThanOrEqual(1);
      expect(new Set(parsed.rubric.map((c) => c.key)).size).toBe(parsed.rubric.length);
    }
    expect(STARTER_TEMPLATES.filter((t) => t.allowsAdversarial).map((t) => t.key)).toEqual([
      'security-red-flag-hunt',
    ]);
  });

  it('BREAK: rubric rejects 0 or 11 criteria, duplicate keys, zero weights, empty labels', () => {
    expect(rubricSchema.safeParse([]).success).toBe(false);
    expect(
      rubricSchema.safeParse(
        Array.from({ length: 11 }, (_, i) => ({ ...criterion, key: `k${i}x` })),
      ).success,
    ).toBe(false);
    expect(rubricSchema.safeParse([criterion, criterion]).success).toBe(false);
    expect(rubricSchema.safeParse([{ ...criterion, weight: 0 }]).success).toBe(false);
    expect(rubricSchema.safeParse([{ ...criterion, weight: -2 }]).success).toBe(false);
    expect(rubricSchema.safeParse([{ ...criterion, label: '  ' }]).success).toBe(false);
    expect(rubricSchema.safeParse([{ ...criterion, key: 'Bad Key' }]).success).toBe(false);
    expect(rubricSchema.safeParse([criterion]).success).toBe(true);
  });

  it('BREAK: strips control characters and caps text', () => {
    const parsed = parseInput(applyToTrialSchema, {
      trialId: '00000000-0000-4000-8000-000000000001',
      statement: 'I ship\u0000 things\u0007 fast and\r\nwell, every week.',
    });
    expect(parsed.statement).toBe('I ship things fast and\nwell, every week.');
    expect(
      applyToTrialSchema.safeParse({
        trialId: '00000000-0000-4000-8000-000000000001',
        statement: 'x'.repeat(100_000),
      }).success,
    ).toBe(false);
  });

  it('BREAK: submission links must be http(s)', () => {
    const base = { trialId: '00000000-0000-4000-8000-000000000001', summary: 'x'.repeat(40) };
    expect(submitSchema.safeParse({ ...base, links: ['javascript:alert(1)'] }).success).toBe(false);
    expect(submitSchema.safeParse({ ...base, links: ['ftp://example.com/x'] }).success).toBe(false);
    expect(submitSchema.safeParse({ ...base, links: ['https://example.com/x'] }).success).toBe(
      true,
    );
    expect(
      submitSchema.safeParse({
        ...base,
        links: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`),
      }).success,
    ).toBe(false);
  });

  it('BREAK: evaluation targets exactly one of team/member, integer scores 0–10', () => {
    const base = { trialId: '00000000-0000-4000-8000-000000000001', scores: { a: 5 } };
    const id = '00000000-0000-4000-8000-000000000002';
    expect(evaluateSchema.safeParse(base).success).toBe(false);
    expect(evaluateSchema.safeParse({ ...base, teamId: id, memberId: id }).success).toBe(false);
    expect(evaluateSchema.safeParse({ ...base, teamId: id }).success).toBe(true);
    expect(evaluateSchema.safeParse({ ...base, teamId: id, scores: { a: 11 } }).success).toBe(
      false,
    );
    expect(evaluateSchema.safeParse({ ...base, teamId: id, scores: { a: 7.5 } }).success).toBe(
      false,
    );
  });
});
