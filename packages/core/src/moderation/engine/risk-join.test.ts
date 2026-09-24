import { describe, expect, it } from 'vitest';
import { settingsSchemas } from '../../settings/schemas';
import { evaluateJoin, type JoinInput } from './join';
import {
  AUTOMOD_TIMEOUT_RISK_SCORE,
  combineWeights,
  decideAction,
  MAX_RISK_MULTIPLIER,
  riskModifiers,
  scoreRisk,
} from './risk';

describe('risk model', () => {
  it('combines weights as a saturating noisy-OR', () => {
    expect(combineWeights([])).toBe(0);
    expect(combineWeights([50])).toBe(50);
    expect(combineWeights([50, 50])).toBe(75);
    expect(combineWeights([100, 10])).toBe(100);
    const many = combineWeights(Array.from({ length: 10 }, () => 50));
    expect(many).toBeGreaterThan(99);
    expect(many).toBeLessThan(100);
  });

  it('clamps nonsense weights', () => {
    expect(combineWeights([-40])).toBe(0);
    expect(combineWeights([500])).toBe(100);
    expect(combineWeights([Number.NaN, 50])).toBe(50);
  });

  it('scores 0 without violations regardless of modifiers', () => {
    expect(scoreRisk([], [{ factor: 1.5 }])).toBe(0);
  });

  it('applies modifiers multiplicatively with a cap', () => {
    expect(scoreRisk([{ weight: 40 }], [{ factor: 1.2 }])).toBe(48);
    expect(scoreRisk([{ weight: 40 }], [{ factor: 3 }])).toBe(40 * MAX_RISK_MULTIPLIER);
    expect(scoreRisk([{ weight: 90 }], [{ factor: 1.6 }])).toBe(100);
    expect(scoreRisk([{ weight: 40 }], [{ factor: 0.1 }])).toBe(40);
  });

  it('walks the action ladder', () => {
    expect(decideAction(0, false, 85)).toBe('none');
    expect(decideAction(90, false, 85)).toBe('none');
    expect(decideAction(AUTOMOD_TIMEOUT_RISK_SCORE - 1, true, 85)).toBe('delete');
    expect(decideAction(AUTOMOD_TIMEOUT_RISK_SCORE, true, 85)).toBe('timeout');
    expect(decideAction(84, true, 85)).toBe('timeout');
    expect(decideAction(85, true, 85)).toBe('quarantine');
    // A quarantine threshold below the timeout threshold wins.
    expect(decideAction(55, true, 50)).toBe('quarantine');
  });

  it('derives modifiers from account age, join time and raid mode', () => {
    expect(riskModifiers({ accountAgeDays: 0 }).map((m) => m.key)).toEqual(['very_new_account']);
    expect(riskModifiers({ accountAgeDays: 3 }).map((m) => m.key)).toEqual(['new_account']);
    expect(riskModifiers({ accountAgeDays: 7 })).toEqual([]);
    expect(riskModifiers({ accountAgeDays: 30, memberAgeMinutes: 10 }).map((m) => m.key)).toEqual([
      'new_member',
    ]);
    expect(riskModifiers({ accountAgeDays: 30, memberAgeMinutes: 30 })).toEqual([]);
    expect(riskModifiers({ accountAgeDays: null, raidMode: true }).map((m) => m.key)).toEqual([
      'raid_mode',
    ]);
  });

  it('BREAK: ignores negative and non-finite ages', () => {
    expect(riskModifiers({ accountAgeDays: -3, memberAgeMinutes: -1 })).toEqual([]);
    expect(riskModifiers({ accountAgeDays: Number.NaN, memberAgeMinutes: Infinity })).toEqual([]);
  });
});

describe('join screening', () => {
  const NOW = new Date('2026-03-01T12:00:00.000Z');
  const security = settingsSchemas.security.parse({});
  const join = (overrides: Partial<JoinInput> = {}) =>
    evaluateJoin({
      accountAgeDays: 400,
      hasAvatar: true,
      username: 'ada',
      displayName: 'Ada',
      recentJoins: [NOW],
      now: NOW,
      settings: security,
      ...overrides,
    });
  const keys = (overrides: Partial<JoinInput>) => join(overrides).signals.map((s) => s.key);
  const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

  it('passes an established account', () => {
    expect(join()).toEqual({
      suspicious: false,
      raidDetected: false,
      riskScore: 0,
      signals: [],
      joinsInWindow: 1,
    });
  });

  it('flags brand-new and young accounts', () => {
    const fresh = join({ accountAgeDays: 0.2 });
    expect(fresh.signals.map((s) => s.key)).toEqual(['very_new_account']);
    expect(fresh.suspicious).toBe(true);
    expect(fresh.riskScore).toBe(50);
    const young = join({ accountAgeDays: 3 });
    expect(young.signals.map((s) => s.key)).toEqual(['new_account']);
    expect(young.suspicious).toBe(true);
    expect(join({ accountAgeDays: 7 }).suspicious).toBe(false);
  });

  it('flags names that impersonate staff or the platform', () => {
    expect(keys({ username: 'discord_support' })).toEqual(['impersonation_name']);
    expect(keys({ username: 'x', displayName: 'JAVE Adm1n' })).toEqual(['impersonation_name']);
    expect(keys({ username: 'rnoderator' })).toEqual(['impersonation_name']);
    expect(keys({ username: 'modern_artist' })).toEqual([]);
  });

  it('flags links in names and generated-looking names', () => {
    expect(keys({ displayName: 'free-nitro.xyz' })).toEqual(['username_link']);
    expect(keys({ displayName: 'join discord.gg/abc' })).toEqual([
      'username_link',
      'impersonation_name',
    ]);
    expect(keys({ username: 'user58213' })).toEqual(['generated_name']);
    expect(keys({ username: '9812734' })).toEqual(['generated_name']);
  });

  it('combines weak signals: no avatar + generated name stays below suspicious', () => {
    const result = join({ hasAvatar: false, username: 'user58213' });
    expect(result.riskScore).toBe(19);
    expect(result.suspicious).toBe(false);
  });

  it('marks an established account suspicious when the name signals add up', () => {
    const result = join({ hasAvatar: false, username: 'discord_support', displayName: 'x.xyz' });
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
    expect(result.suspicious).toBe(true);
  });

  it('detects a join burst at the configured count within the window', () => {
    const nine = Array.from({ length: 9 }, (_, i) => secondsAgo(i * 5));
    expect(join({ recentJoins: nine }).raidDetected).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => secondsAgo(i * 5));
    const burst = join({ recentJoins: ten });
    expect(burst.raidDetected).toBe(true);
    expect(burst.joinsInWindow).toBe(10);
    expect(burst.signals.map((s) => s.key)).toEqual(['join_burst']);
  });

  it('window edges: joins exactly at the cutoff or in the future do not count', () => {
    const edge = [
      ...Array.from({ length: 9 }, (_, i) => secondsAgo(i)),
      secondsAgo(security.joinBurstWindowSeconds),
      new Date(NOW.getTime() + 1000),
      new Date('invalid'),
    ];
    const result = join({ recentJoins: edge });
    expect(result.joinsInWindow).toBe(9);
    expect(result.raidDetected).toBe(false);
  });

  it('honours custom burst settings', () => {
    const tight = settingsSchemas.security.parse({ joinBurstCount: 3, joinBurstWindowSeconds: 10 });
    const joins = [secondsAgo(1), secondsAgo(2), secondsAgo(3)];
    expect(join({ settings: tight, recentJoins: joins }).raidDetected).toBe(true);
    expect(
      join({ settings: tight, recentJoins: [secondsAgo(1), secondsAgo(11)] }).raidDetected,
    ).toBe(false);
  });
});
