import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { formatCount, formatRange, initials, pageWindow } from './format';
import { RAIL_EDGE_CLEARANCE_PX, railScrollDelta } from './rail';
import { describeRank, UNKNOWN_GLYPH } from './rank';
import { isRoleKey, ROLE_KEYS, roleVisual, treatmentClass } from './roles';

describe('describeRank', () => {
  it('prefers the verified rank over a claim', () => {
    const rank = describeRank({ verifiedRank: 'a', claimedRank: 'S' });
    expect(rank).toMatchObject({ status: 'verified', rank: 'A', glyph: 'A', label: 'VERIFIED' });
    expect(rank.ariaLabel).toBe('Rank A, verified');
  });

  it('labels an unverified claim as CLAIMED, never as a rank', () => {
    const rank = describeRank({ verifiedRank: null, claimedRank: 'S' });
    expect(rank.status).toBe('claimed');
    expect(rank.label).toBe('CLAIMED');
    expect(rank.ariaLabel).toContain('not verified');
  });

  it('renders UNKNOWN as a dash when nothing is known', () => {
    expect(describeRank({})).toMatchObject({
      status: 'unknown',
      rank: null,
      glyph: UNKNOWN_GLYPH,
      label: 'UNKNOWN',
    });
  });

  it('BREAK: ignores blank and oversized rank codes instead of rendering them', () => {
    expect(describeRank({ verifiedRank: '   ' }).status).toBe('unknown');
    expect(describeRank({ verifiedRank: '<script>' }).status).toBe('unknown');
    expect(describeRank({ verifiedRank: 'TOOLONG', claimedRank: 'B' }).status).toBe('claimed');
  });
});

describe('pageWindow', () => {
  it('describes the first page', () => {
    expect(pageWindow({ offset: 0, limit: 25, total: 132 })).toEqual({
      page: 1,
      pageCount: 6,
      from: 1,
      to: 25,
      total: 132,
      hasPrevious: false,
      hasNext: true,
    });
  });

  it('describes the last partial page', () => {
    const window = pageWindow({ offset: 125, limit: 25, total: 132 });
    expect(window).toMatchObject({
      page: 6,
      from: 126,
      to: 132,
      hasNext: false,
      hasPrevious: true,
    });
    expect(formatRange(window)).toBe('126–132 of 132');
  });

  it('handles an empty result', () => {
    const window = pageWindow({ offset: 0, limit: 25, total: 0 });
    expect(window).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0, hasNext: false });
    expect(formatRange(window)).toBe('0 of 0');
  });

  it('BREAK: survives out-of-range and hostile inputs', () => {
    const beyond = pageWindow({ offset: 9_999, limit: 25, total: 30 });
    expect(beyond).toMatchObject({ page: 2, from: 0, hasPrevious: true, hasNext: false });
    const negative = pageWindow({ offset: -50, limit: 0, total: -3 });
    expect(negative).toMatchObject({ page: 1, pageCount: 1, total: 0 });
  });
});

describe('formatCount', () => {
  it('groups digits and dashes missing values', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(12.9)).toBe('12');
  });
});

describe('initials', () => {
  it('takes up to two initials', () => {
    expect(initials('Mara Voss')).toBe('MV');
    expect(initials('dev_founder')).toBe('DF');
    expect(initials('solo')).toBe('S');
    expect(initials('   ')).toBe('?');
    expect(initials('Élan Ümit Zed')).toBe('ÉÜ');
  });
});

describe('roles', () => {
  it('gives every role a treatment class', () => {
    for (const role of ROLE_KEYS) {
      const visual = roleVisual(role);
      expect(visual.className).toBe(treatmentClass(visual.treatment));
      expect(visual.className).toMatch(/^role-/);
    }
  });

  it('keeps the identity almost monochrome: only TRIAL and SUPPORTER carry a hue', () => {
    const hued = ROLE_KEYS.filter((role) =>
      ['accent', 'special'].includes(roleVisual(role).treatment),
    );
    expect(hued).toEqual(['trial', 'supporter']);
  });

  it('recognises role keys', () => {
    expect(isRoleKey('founder')).toBe(true);
    expect(isRoleKey('admin')).toBe(false);
  });
});

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 0, 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('railScrollDelta', () => {
  const rail = { left: 0, right: 390 };
  const clearance = RAIL_EDGE_CLEARANCE_PX;

  it('leaves a fully visible item alone', () => {
    expect(railScrollDelta(rail, { left: 100, right: 200 })).toBe(0);
  });

  it('brings a clipped trailing item clear of the fade', () => {
    const delta = railScrollDelta(rail, { left: 400, right: 500 });
    expect(500 - delta).toBe(rail.right - clearance);
  });

  it('scrolls back to an item hidden off the leading edge', () => {
    const delta = railScrollDelta(rail, { left: -120, right: -20 });
    expect(-120 - delta).toBe(clearance);
  });

  it('aligns the leading edge of an item wider than the rail', () => {
    const delta = railScrollDelta(rail, { left: 400, right: 1000 });
    expect(400 - delta).toBe(clearance);
  });
});
