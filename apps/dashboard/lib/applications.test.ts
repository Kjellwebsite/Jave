import { describe, expect, it } from 'vitest';
import {
  DRAFT_INTENT_FIELD,
  DRAFT_SUBMIT_INTENT,
  draftPatchFrom,
  parseApplicationNumber,
  recommendationFrom,
  scoreFrom,
  statusesFor,
  withdrawalCostLine,
} from './applications';
import { fromDatetimeLocal, toDatetimeLocal } from './datetime-local';
import {
  capabilityLabelFor,
  IDENTITY_TARGET_LINE,
  MY_VERIFICATIONS_HREF,
  verificationStatusesFor,
  verificationTargetLine,
} from './verification';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('application page helpers', () => {
  it('maps queue filters to service statuses', () => {
    expect(statusesFor('in_flight')).toEqual(['submitted', 'review', 'interview']);
    expect(statusesFor('rejected')).toEqual(['rejected']);
    expect(statusesFor('all')).toBeUndefined();
    expect(verificationStatusesFor('open')).toEqual(['pending', 'in_review']);
    expect(verificationStatusesFor('all')).toBeUndefined();
  });

  it('reads application numbers in every human form', () => {
    expect(parseApplicationNumber('APP-0042')).toBe(42);
    expect(parseApplicationNumber('app-42')).toBe(42);
    expect(parseApplicationNumber(' 7 ')).toBe(7);
    for (const bad of ['', 'APP-', '0', '-3', 'APP-1; drop', '1e3', '9999999999', undefined])
      expect(parseApplicationNumber(bad), String(bad)).toBeUndefined();
  });

  it('builds a full draft patch so emptied fields clear', () => {
    expect(
      draftPatchFrom(
        form({
          domainKey: 'create',
          motivation: 'Ship it.',
          status: 'accepted',
          [DRAFT_INTENT_FIELD]: DRAFT_SUBMIT_INTENT,
        }),
      ),
    ).toEqual({
      domainKey: 'create',
      motivation: 'Ship it.',
      experience: '',
      projects: '',
      portfolioUrl: '',
      evidenceLinks: '',
      references: '',
      referralCode: '',
    });
  });

  it('states what withdrawing costs in the viewer’s zone', () => {
    const at = new Date('2026-10-28T09:00:00.000Z');
    expect(withdrawalCostLine(at, 'Europe/Oslo')).toBe(
      'You could submit again from 2026-10-28 10:00 Europe/Oslo.',
    );
    expect(withdrawalCostLine(null, 'UTC')).toBe('You can start again at any time.');
  });

  it('links a member’s own verifications, decided ones included', () => {
    expect(MY_VERIFICATIONS_HREF).toBe('/verification?subject=me&status=all');
  });

  it('BREAK: review inputs outside the allowed values are dropped', () => {
    expect(recommendationFrom(form({ recommendation: 'accept' }))).toBe('accept');
    expect(recommendationFrom(form({ recommendation: 'promote' }))).toBeUndefined();
    expect(scoreFrom(form({ score: '4' }))).toBe(4);
    expect(scoreFrom(form({ score: '9' }))).toBeUndefined();
    expect(scoreFrom(form({ score: '4.5' }))).toBeUndefined();
  });

  it('writes the verification target in one line', () => {
    const base = { type: 'skill' as const, targetLabel: 'MIND · Research' };
    expect(verificationTargetLine({ ...base, requestedRank: 'A', grantedRank: null })).toBe(
      'MIND · Research at A',
    );
    expect(verificationTargetLine({ ...base, requestedRank: 'A', grantedRank: 'B' })).toBe(
      'MIND · Research · verified at B',
    );
    // Identity's stored label is only the handle; the line says what approval does.
    expect(
      verificationTargetLine({
        type: 'identity',
        targetLabel: '@tomas',
        requestedRank: null,
        grantedRank: null,
      }),
    ).toBe(IDENTITY_TARGET_LINE);
  });

  it('names a capability by domain and facet from the catalog', () => {
    const catalog = {
      domains: [{ key: 'mind', label: 'Mind' }],
      facets: [
        { key: 'mind.research', label: 'Research', domainKey: 'mind' },
        { key: 'x.orphan', label: 'Orphan', domainKey: 'x' },
      ],
    };
    expect(capabilityLabelFor(catalog, 'mind.research')).toBe('Mind · Research');
    expect(capabilityLabelFor(catalog, 'x.orphan')).toBe('x · Orphan');
    expect(capabilityLabelFor(catalog, 'nope')).toBeNull();
    expect(capabilityLabelFor(catalog, null)).toBeNull();
    expect(
      verificationTargetLine(
        { type: 'skill', targetLabel: 'Research', requestedRank: 'A', grantedRank: null },
        capabilityLabelFor(catalog, 'mind.research'),
      ),
    ).toBe('Mind · Research at A');
  });
});

describe('datetime-local in the viewer’s zone', () => {
  it('round-trips wall time', () => {
    const at = new Date('2026-10-02T16:00:00.000Z');
    expect(toDatetimeLocal(at, 'Europe/Berlin')).toBe('2026-10-02T18:00');
    expect(fromDatetimeLocal('2026-10-02T18:00', 'Europe/Berlin')?.toISOString()).toBe(
      at.toISOString(),
    );
    expect(fromDatetimeLocal('2026-10-02T18:00', 'UTC')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
  });

  it('resolves daylight-saving gaps forward and falls back to UTC for unknown zones', () => {
    expect(fromDatetimeLocal('2026-03-29T02:30', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(fromDatetimeLocal('2026-10-02T18:00', 'Not/AZone')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
  });

  it('BREAK: rejects malformed and impossible values', () => {
    for (const bad of ['', '2026-02-30T10:00', '2026-10-02T24:00', '2026-10-02 18:00', 'soon'])
      expect(fromDatetimeLocal(bad, 'UTC'), bad).toBeNull();
  });
});
