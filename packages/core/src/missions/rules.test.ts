import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../kernel/clock';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import {
  ASSIGNMENT_STATUSES,
  assertValidDeadline,
  canTransitionAssignment,
  canTransitionMission,
  formatMissionNumber,
  hoursLeft,
  MAX_DEADLINE_HORIZON_MS,
  MAX_SUBMISSION_ATTEMPTS,
  MISSION_STATUSES,
  type ReminderCandidate,
  REMINDER_LEAD_MS,
  remainingSlots,
  resolveDueAt,
  shouldRemind,
} from './rules';

const now = new Date('2026-03-01T12:00:00.000Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

describe('mission state machine', () => {
  it('allows only the documented mission transitions', () => {
    const allowed = new Set([
      'draft>open',
      'draft>archived',
      'open>closed',
      'closed>open',
      'closed>archived',
    ]);
    for (const from of MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        expect(canTransitionMission(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('makes verified assignments final and lets abandoned/expired ones restart only by assignment', () => {
    for (const to of ASSIGNMENT_STATUSES)
      expect(canTransitionAssignment('verified', to)).toBe(false);
    expect(canTransitionAssignment('abandoned', 'assigned')).toBe(true);
    expect(canTransitionAssignment('abandoned', 'accepted')).toBe(false);
    expect(canTransitionAssignment('submitted', 'abandoned')).toBe(false);
    expect(canTransitionAssignment('rejected', 'submitted')).toBe(true);
    expect(canTransitionAssignment('submitted', 'expired')).toBe(false);
  });
});

describe('due dates', () => {
  it('prefers an explicit due date, then duration, then the mission deadline', () => {
    const deadline = at(72 * HOUR);
    expect(
      resolveDueAt({ now, explicitDueAt: at(10 * HOUR), durationHours: 5, deadlineAt: deadline }),
    ).toEqual(at(10 * HOUR));
    expect(
      resolveDueAt({ now, explicitDueAt: null, durationHours: 5, deadlineAt: deadline }),
    ).toEqual(at(5 * HOUR));
    expect(
      resolveDueAt({ now, explicitDueAt: null, durationHours: null, deadlineAt: deadline }),
    ).toEqual(deadline);
    expect(
      resolveDueAt({ now, explicitDueAt: null, durationHours: null, deadlineAt: null }),
    ).toBeNull();
  });

  it('refuses to schedule work once the mission deadline has passed', () => {
    for (const deadlineAt of [now, at(-HOUR)]) {
      expect(() =>
        resolveDueAt({ now, explicitDueAt: null, durationHours: 5, deadlineAt }),
      ).toThrow(InvalidStateError);
    }
  });

  it('caps durations at the mission deadline', () => {
    expect(
      resolveDueAt({ now, explicitDueAt: null, durationHours: 100, deadlineAt: at(3 * HOUR) }),
    ).toEqual(at(3 * HOUR));
  });

  it('refuses explicit due dates in the past, now, or after the deadline', () => {
    for (const explicitDueAt of [at(-1), now]) {
      expect(() =>
        resolveDueAt({ now, explicitDueAt, durationHours: null, deadlineAt: null }),
      ).toThrow(ValidationError);
    }
    expect(() =>
      resolveDueAt({ now, explicitDueAt: at(5 * HOUR), durationHours: null, deadlineAt: at(HOUR) }),
    ).toThrow(/after the mission deadline/);
  });

  it('validates deadlines against now and the planning horizon', () => {
    expect(() => assertValidDeadline(null, now)).not.toThrow();
    expect(() => assertValidDeadline(at(HOUR), now)).not.toThrow();
    expect(() => assertValidDeadline(now, now)).toThrow(/future/);
    expect(() => assertValidDeadline(at(MAX_DEADLINE_HORIZON_MS + 1), now)).toThrow(/too far/);
  });
});

describe('deadline reminders', () => {
  const base: ReminderCandidate = {
    status: 'accepted',
    assignedAt: at(-48 * HOUR),
    dueAt: at(REMINDER_LEAD_MS),
    reminderDueAt: null,
    attempts: 0,
  };

  it('fires exactly inside the 24-hour window', () => {
    expect(shouldRemind(base, now)).toBe(true);
    expect(shouldRemind({ ...base, dueAt: at(REMINDER_LEAD_MS + 1) }, now)).toBe(false);
    expect(shouldRemind({ ...base, dueAt: at(MINUTE) }, now)).toBe(true);
    expect(shouldRemind({ ...base, dueAt: now }, now)).toBe(false);
    expect(shouldRemind({ ...base, dueAt: null }, now)).toBe(false);
  });

  it('fires once per due date and re-arms when the due date moves', () => {
    expect(shouldRemind({ ...base, reminderDueAt: base.dueAt }, now)).toBe(false);
    expect(shouldRemind({ ...base, reminderDueAt: at(2 * HOUR) }, now)).toBe(true);
  });

  it('skips short assignments, finished work and exhausted rejections', () => {
    expect(shouldRemind({ ...base, assignedAt: at(-1 * HOUR), dueAt: at(12 * HOUR) }, now)).toBe(
      false,
    );
    expect(shouldRemind({ ...base, assignedAt: now, dueAt: at(REMINDER_LEAD_MS) }, now)).toBe(
      false,
    );
    expect(shouldRemind({ ...base, assignedAt: at(-1), dueAt: at(REMINDER_LEAD_MS) }, now)).toBe(
      true,
    );
    expect(shouldRemind({ ...base, status: 'submitted' }, now)).toBe(false);
    expect(shouldRemind({ ...base, status: 'verified' }, now)).toBe(false);
    expect(shouldRemind({ ...base, status: 'rejected', attempts: 1 }, now)).toBe(true);
    expect(
      shouldRemind({ ...base, status: 'rejected', attempts: MAX_SUBMISSION_ATTEMPTS }, now),
    ).toBe(false);
  });

  it('rounds hours left up and never below one', () => {
    expect(hoursLeft(at(REMINDER_LEAD_MS), now)).toBe(24);
    expect(hoursLeft(at(90 * MINUTE), now)).toBe(2);
    expect(hoursLeft(at(MINUTE), now)).toBe(1);
  });
});

describe('formatting and slots', () => {
  it('formats mission numbers', () => {
    expect(formatMissionNumber(42)).toBe('M-0042');
    expect(formatMissionNumber(12345)).toBe('M-12345');
  });

  it('computes remaining slots', () => {
    expect(remainingSlots(null, 99)).toBeNull();
    expect(remainingSlots(3, 1)).toBe(2);
    expect(remainingSlots(3, 5)).toBe(0);
  });
});
