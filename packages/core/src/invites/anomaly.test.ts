import { describe, expect, it } from 'vitest';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import {
  ANOMALY_FLAGS,
  type AnomalyInput,
  DEFAULT_ANOMALY_RULES,
  detectAnomalies,
  isSimilarUsername,
  type ReferralSubject,
  scoreFlags,
  withFlag,
} from './anomaly';

const JOIN = new Date('2026-05-01T12:00:00Z');
const OLD_ACCOUNT = new Date('2020-01-01T00:00:00Z');
const INVITER = 'inviter-1';
const INVITEE = 'invitee-1';

function subject(overrides: Partial<ReferralSubject> = {}): ReferralSubject {
  return {
    joinedAt: JOIN,
    accountCreatedAt: OLD_ACCOUNT,
    username: 'ada_lovelace',
    leftAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<AnomalyInput> = {}): AnomalyInput {
  return {
    inviterUserId: INVITER,
    inviteeUserId: INVITEE,
    subject: subject(),
    cohort: [],
    rejoin: false,
    ...overrides,
  };
}

const distinctNames = ['grace', 'linus', 'margaret', 'dennis', 'barbara', 'ken', 'radia', 'tim'];

describe('referral anomaly detection', () => {
  it('a normal referral is clean', () => {
    expect(detectAnomalies(input())).toEqual({ flags: [], score: 0 });
  });

  it('inviter == invitee is a self-invite with the maximum score', () => {
    const result = detectAnomalies(input({ inviteeUserId: INVITER }));
    expect(result.flags).toContain('self_invite');
    expect(result.score).toBe(100);
  });

  it('flags very new accounts using the configured age', () => {
    const young = subject({ accountCreatedAt: new Date(JOIN.getTime() - 2 * DAY) });
    expect(detectAnomalies(input({ subject: young })).flags).toEqual(['new_account']);
    const rules = { ...DEFAULT_ANOMALY_RULES, newAccountDays: 1 };
    expect(detectAnomalies(input({ subject: young }), rules).flags).toEqual([]);
  });

  it('boundary: exactly newAccountDays old is not new', () => {
    const edge = subject({ accountCreatedAt: new Date(JOIN.getTime() - 7 * DAY) });
    expect(detectAnomalies(input({ subject: edge })).flags).not.toContain('new_account');
  });

  it('detects an inviter join burst (5 inside one hour) but not 4', () => {
    const four = [1, 2, 3].map((i) =>
      subject({
        joinedAt: new Date(JOIN.getTime() + i * 10 * MINUTE),
        username: distinctNames[i]!,
      }),
    );
    expect(detectAnomalies(input({ cohort: four })).flags).not.toContain('join_burst');
    const five = [
      ...four,
      subject({ joinedAt: new Date(JOIN.getTime() + 50 * MINUTE), username: 'zed' }),
    ];
    expect(detectAnomalies(input({ cohort: five })).flags).toContain('join_burst');
  });

  it('a burst far from this join does not taint it', () => {
    const later = [1, 2, 3, 4, 5].map((i) =>
      subject({
        joinedAt: new Date(JOIN.getTime() + 5 * DAY + i * MINUTE),
        username: distinctNames[i]!,
      }),
    );
    expect(detectAnomalies(input({ cohort: later })).flags).not.toContain('join_burst');
  });

  it('flags a high share of very new accounts only with enough samples', () => {
    const young = (name: string, i: number) =>
      subject({
        joinedAt: new Date(JOIN.getTime() - i * DAY),
        accountCreatedAt: new Date(JOIN.getTime() - i * DAY - HOUR),
        username: name,
      });
    const twoYoung = [young('grace', 1), young('linus', 2)];
    expect(detectAnomalies(input({ cohort: twoYoung })).flags).not.toContain('new_account_share');
    const threeYoung = [...twoYoung, young('margaret', 3)];
    expect(detectAnomalies(input({ cohort: threeYoung })).flags).toContain('new_account_share');
  });

  it('flags a fast leave and an inviter with a high fast-leave share', () => {
    const quickLeaver = subject({ leftAt: new Date(JOIN.getTime() + 2 * HOUR) });
    expect(detectAnomalies(input({ subject: quickLeaver })).flags).toEqual(['fast_leave']);
    const cohort = ['grace', 'linus', 'margaret'].map((name, i) =>
      subject({
        joinedAt: new Date(JOIN.getTime() - (i + 1) * DAY),
        leftAt: new Date(JOIN.getTime() - (i + 1) * DAY + HOUR),
        username: name,
      }),
    );
    expect(detectAnomalies(input({ cohort })).flags).toContain('fast_leave_share');
  });

  it('boundary: leaving after exactly 24h is not a fast leave', () => {
    const stayed = subject({ leftAt: new Date(JOIN.getTime() + DAY) });
    expect(detectAnomalies(input({ subject: stayed })).flags).not.toContain('fast_leave');
  });

  it('flags similar usernames among the inviter’s invitees', () => {
    const farm = ['farm_bot_01', 'farm_bot_02', 'farmbot03'].map((username, i) =>
      subject({ joinedAt: new Date(JOIN.getTime() - (i + 1) * DAY), username }),
    );
    const result = detectAnomalies(
      input({ subject: subject({ username: 'farm_bot_04' }), cohort: farm }),
    );
    expect(result.flags).toContain('similar_usernames');
  });

  it('cohort signals need an inviter (vanity/unknown joins)', () => {
    const cohort = [1, 2, 3, 4, 5].map((i) =>
      subject({ joinedAt: new Date(JOIN.getTime() + i * MINUTE), username: `farm${i}` }),
    );
    const result = detectAnomalies(input({ inviterUserId: null, cohort }));
    expect(result.flags).toEqual([]);
  });

  it('flags rejoins', () => {
    expect(detectAnomalies(input({ rejoin: true })).flags).toEqual(['rejoin']);
  });

  it('scores are additive, capped at 100, and order-independent', () => {
    expect(scoreFlags([])).toBe(0);
    expect(scoreFlags(['new_account'])).toBe(15);
    expect(scoreFlags(['join_burst', 'similar_usernames'])).toBe(60);
    expect(scoreFlags(['similar_usernames', 'join_burst'])).toBe(60);
    expect(scoreFlags(['join_burst', 'join_burst'])).toBe(30);
    expect(scoreFlags([...ANOMALY_FLAGS].filter((f) => f !== 'self_invite'))).toBe(100);
  });

  it('flags come back in catalog order and withFlag is idempotent', () => {
    expect(withFlag(['rejoin'], 'fast_leave')).toEqual(['fast_leave', 'rejoin']);
    expect(withFlag(['fast_leave'], 'fast_leave')).toEqual(['fast_leave']);
    expect(withFlag(['not_a_flag'], 'rejoin')).toEqual(['rejoin']);
  });
});

describe('isSimilarUsername', () => {
  it.each([
    ['farm_bot_01', 'farm_bot_02', true],
    ['FarmBot', 'farm.bot.99', true],
    ['johnsmith', 'johnsmyth', true],
    ['alice', 'bob', false],
    ['alice', 'alicia', false],
    ['ab1', 'ab2', false],
    ['kjell', 'kjellwebsite', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(isSimilarUsername(a, b)).toBe(expected);
  });

  it('BREAK: does not blow up on huge or exotic names', () => {
    const huge = 'a'.repeat(64);
    expect(isSimilarUsername(huge, `${huge.slice(1)}b`)).toBe(true);
    expect(isSimilarUsername('ｆａｒｍ', 'farm')).toBe(true);
    expect(isSimilarUsername('', '')).toBe(false);
    expect(isSimilarUsername('💀💀💀', '💀💀💀')).toBe(false);
  });
});
