import { describe, expect, it } from 'vitest';
import {
  caseState,
  evidenceModifiers,
  parseCaseFilters,
  parseCaseNumber,
  parseEventFilters,
  parseLookupQuery,
  REVIEW_TARGETS,
  riskSeverity,
} from './moderation-labels';

describe('moderation labels and filters', () => {
  it('parses case numbers the way staff type them', () => {
    expect(parseCaseNumber('CASE-0042')).toBe(42);
    expect(parseCaseNumber('case42')).toBe(42);
    expect(parseCaseNumber(' 7 ')).toBe(7);
    expect(parseCaseNumber('0')).toBeUndefined();
    expect(parseCaseNumber('SEC-0042')).toBeUndefined();
    expect(parseCaseNumber('12345678901')).toBeUndefined();
    expect(parseCaseNumber(undefined)).toBeUndefined();
  });

  it('keeps known case filters and flags the rest as invalid', () => {
    expect(
      parseCaseFilters({
        q: 'CASE-3',
        action: 'ban',
        source: 'automod',
        state: 'live',
        offset: '25',
      }),
    ).toEqual({
      q: 'CASE-3',
      number: 3,
      action: 'ban',
      source: 'automod',
      state: 'live',
      offset: 25,
      invalid: false,
    });
    const hostile = parseCaseFilters({
      q: '1; drop table mod_cases',
      action: 'nuke',
      state: ['live', 'x'],
      offset: '-5',
    });
    expect(hostile).toMatchObject({
      number: undefined,
      action: undefined,
      state: 'live',
      offset: 0,
      invalid: true,
    });
  });

  it('defaults security events to the review queue', () => {
    expect(parseEventFilters({})).toMatchObject({
      view: 'review',
      statuses: ['open', 'acknowledged'],
      invalid: false,
    });
    expect(parseEventFilters({ view: 'all', trigger: 'join_burst', minRisk: '85' })).toMatchObject({
      view: 'all',
      statuses: undefined,
      trigger: 'join_burst',
      minRisk: 85,
    });
    expect(parseEventFilters({ view: 'dismissed' }).statuses).toEqual(['dismissed']);
    expect(parseEventFilters({ view: 'bogus', minRisk: '101' })).toMatchObject({
      view: 'review',
      minRisk: undefined,
      invalid: true,
    });
  });

  it('recognises Discord IDs in the lookup box', () => {
    expect(parseLookupQuery('@mara')).toEqual({ query: 'mara', discordId: undefined });
    expect(parseLookupQuery(' 110000000000000011 ')).toEqual({
      query: '110000000000000011',
      discordId: '110000000000000011',
    });
    expect(parseLookupQuery('   ')).toEqual({ query: undefined, discordId: undefined });
  });

  it('derives one state per case', () => {
    const base = { inForce: false, revokedAt: null, endedAt: null, endedReason: null };
    expect(caseState(base).label).toBe('Recorded');
    expect(caseState({ ...base, inForce: true }).label).toBe('In force');
    expect(caseState({ ...base, endedAt: new Date(), endedReason: 'expired' }).label).toBe(
      'Expired',
    );
    expect(
      caseState({ ...base, inForce: true, revokedAt: new Date(), endedReason: 'revoked' }).label,
    ).toBe('Revoked');
  });

  it('grades risk like the Discord alert card', () => {
    const thresholds = { critical: 85, elevated: 50 };
    expect(riskSeverity(92, thresholds)).toBe('critical');
    expect(riskSeverity(85, thresholds)).toBe('critical');
    expect(riskSeverity(60, thresholds)).toBe('elevated');
    expect(riskSeverity(0, thresholds)).toBe('low');
  });

  it('mirrors the review state machine', () => {
    expect(REVIEW_TARGETS.open).toEqual(['acknowledged', 'dismissed', 'actioned']);
    expect(REVIEW_TARGETS.acknowledged).toEqual(['dismissed', 'actioned']);
    expect(REVIEW_TARGETS.dismissed).toEqual([]);
    expect(REVIEW_TARGETS.actioned).toEqual([]);
  });

  it('BREAK: skips malformed evidence modifiers instead of rendering them', () => {
    expect(evidenceModifiers({ signals: [] })).toEqual([]);
    expect(evidenceModifiers({ modifiers: 'x' })).toEqual([]);
    expect(
      evidenceModifiers({
        modifiers: [
          { key: 'new_account', factor: 1.35, detail: 'account < 1 day' },
          { key: 'bad', factor: 'NaN' },
          null,
          { key: 'inf', factor: Infinity },
          { key: 'no_detail', factor: 1.2 },
        ],
      }),
    ).toEqual([
      { key: 'new_account', factor: 1.35, detail: 'account < 1 day' },
      { key: 'no_detail', factor: 1.2, detail: '' },
    ]);
  });
});
