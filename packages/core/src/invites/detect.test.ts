import { describe, expect, it } from 'vitest';
import { detectUsedInvite, type InviteUsage } from './detect';

const base: InviteUsage[] = [
  { code: 'alpha', uses: 3 },
  { code: 'bravo', uses: 0, maxUses: 5 },
  { code: 'charlie', uses: 9, maxUses: 10 },
];

function bump(list: InviteUsage[], code: string, by = 1): InviteUsage[] {
  return list.map((i) => (i.code === code ? { ...i, uses: i.uses + by } : i));
}

describe('detectUsedInvite', () => {
  it('finds the single invite whose uses went up by exactly one', () => {
    expect(detectUsedInvite(base, bump(base, 'alpha'))).toEqual({
      method: 'invite',
      code: 'alpha',
    });
  });

  it('reports no_change when nothing moved', () => {
    expect(detectUsedInvite(base, base)).toEqual({
      method: 'unknown',
      code: null,
      reason: 'no_change',
    });
  });

  it('is ambiguous when two invites moved (concurrent joins)', () => {
    const after = bump(bump(base, 'alpha'), 'bravo');
    expect(detectUsedInvite(base, after)).toMatchObject({ method: 'unknown', reason: 'ambiguous' });
  });

  it('is ambiguous when one invite jumped by more than one (missed events)', () => {
    expect(detectUsedInvite(base, bump(base, 'alpha', 2))).toMatchObject({
      method: 'unknown',
      reason: 'ambiguous',
    });
  });

  it('is ambiguous when a count decreased (inconsistent snapshots)', () => {
    expect(detectUsedInvite(base, bump(base, 'alpha', -1))).toMatchObject({
      method: 'unknown',
      reason: 'ambiguous',
    });
  });

  it('detects a max-uses invite deleted by the use that consumed it', () => {
    const after = base.filter((i) => i.code !== 'charlie');
    expect(detectUsedInvite(base, after)).toEqual({ method: 'invite', code: 'charlie' });
  });

  it('ignores invites that were deleted or expired without being consumed', () => {
    const after = base.filter((i) => i.code !== 'alpha');
    expect(detectUsedInvite(base, after)).toMatchObject({ method: 'unknown', reason: 'no_change' });
  });

  it('treats a fresh invite with one use as the candidate, and an unused fresh one as noise', () => {
    expect(detectUsedInvite(base, [...base, { code: 'delta', uses: 1 }])).toEqual({
      method: 'invite',
      code: 'delta',
    });
    expect(detectUsedInvite(base, [...base, { code: 'echo', uses: 0 }])).toMatchObject({
      reason: 'no_change',
    });
  });

  it('supports the vanity URL', () => {
    const before = [...base, { code: 'javelin', uses: 40, vanity: true }];
    const after = bump(before, 'javelin');
    expect(detectUsedInvite(before, after)).toEqual({ method: 'vanity', code: 'javelin' });
  });

  it('is ambiguous when vanity and a regular invite both moved', () => {
    const before = [...base, { code: 'javelin', uses: 40, vanity: true }];
    const after = bump(bump(before, 'javelin'), 'alpha');
    expect(detectUsedInvite(before, after)).toMatchObject({ reason: 'ambiguous' });
  });

  it('handles empty snapshots (cold cache, no invites)', () => {
    expect(detectUsedInvite([], [])).toMatchObject({ reason: 'no_change' });
    expect(detectUsedInvite([], [{ code: 'x1', uses: 1 }])).toEqual({
      method: 'invite',
      code: 'x1',
    });
  });
});
