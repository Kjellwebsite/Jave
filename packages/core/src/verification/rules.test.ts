import { describe, expect, it } from 'vitest';
import { DAY } from '../kernel/clock';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { subjectNoticeCopy, verificationHeadline } from './copy';
import {
  assertOpen,
  assertTransition,
  canTransition,
  computeExpiry,
  isPastExpiry,
  MAX_EVIDENCE_PER_VERIFICATION,
  openedBy,
  targetKeys,
  VERIFICATION_EXPIRY_DAYS,
  verificationReference,
  verifierConflict,
} from './rules';
import {
  hasControlCharacters,
  isSafeHttpUrl,
  requestVerificationSchema,
  TEXT_LIMITS,
} from './schemas';
import { classifyIdentityRoles } from './strategies';
import type { VerificationStatus } from './types';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UUID_A = '8f14e45f-ceea-4e67-a9f8-6f9f0f1b2c3d';
const UUID_B = '1c1f6a4e-6c4b-4d1e-9a3a-2b7c9d0e1f23';

describe('verification state machine', () => {
  it('allows exactly the documented transitions', () => {
    const all: VerificationStatus[] = [
      'pending',
      'in_review',
      'approved',
      'rejected',
      'revoked',
      'expired',
    ];
    const allowed = new Set([
      'pending>in_review',
      'pending>approved',
      'pending>rejected',
      'pending>expired',
      'in_review>pending',
      'in_review>approved',
      'in_review>rejected',
      'in_review>expired',
      'approved>revoked',
    ]);
    for (const from of all)
      for (const to of all) expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
  });

  it('terminal states never move', () => {
    for (const terminal of ['rejected', 'revoked', 'expired'] as const)
      expect(() =>
        assertTransition({ status: terminal, expiresAt: null, number: 7 }, 'approved', NOW),
      ).toThrow(InvalidStateError);
  });

  it('treats an open verification past expiry as expired (inclusive boundary)', () => {
    const open = { status: 'pending' as const, number: 1 };
    expect(() => assertTransition({ ...open, expiresAt: NOW }, 'approved', NOW)).toThrow(/expired/);
    expect(() =>
      assertTransition({ ...open, expiresAt: new Date(NOW.getTime() + 1) }, 'approved', NOW),
    ).not.toThrow();
    expect(() => assertTransition({ ...open, expiresAt: NOW }, 'expired', NOW)).not.toThrow();
    expect(() => assertOpen({ ...open, expiresAt: NOW }, NOW)).toThrow(/expired/);
    expect(() => assertOpen({ ...open, status: 'approved', expiresAt: null }, NOW)).toThrow(
      /already approved/,
    );
  });

  it('computes expiry from a named default', () => {
    expect(computeExpiry(NOW).getTime() - NOW.getTime()).toBe(VERIFICATION_EXPIRY_DAYS * DAY);
    expect(isPastExpiry(null, NOW)).toBe(false);
    expect(isPastExpiry(new Date(NOW.getTime() - 1), NOW)).toBe(true);
  });

  it('formats human references', () => {
    expect(verificationReference(42)).toBe('VER-0042');
    expect(verificationReference(12345)).toBe('VER-12345');
  });
});

describe('two-person rule', () => {
  const subject = 'user-subject';
  const staff = 'user-staff';
  const other = 'user-other';

  it('the subject never verifies themselves', () => {
    expect(
      verifierConflict({
        verifierUserId: subject,
        subjectUserId: subject,
        requestedByUserId: subject,
      }),
    ).toBe('subject');
  });

  it('a staff member who opened a request for someone else cannot verify it', () => {
    expect(
      verifierConflict({ verifierUserId: staff, subjectUserId: subject, requestedByUserId: staff }),
    ).toBe('requester');
    expect(
      verifierConflict({ verifierUserId: other, subjectUserId: subject, requestedByUserId: staff }),
    ).toBeNull();
  });

  it('a self-opened request needs one independent verifier', () => {
    expect(
      verifierConflict({
        verifierUserId: staff,
        subjectUserId: subject,
        requestedByUserId: subject,
      }),
    ).toBeNull();
  });

  it('system actors never conflict', () => {
    expect(
      verifierConflict({ verifierUserId: null, subjectUserId: subject, requestedByUserId: null }),
    ).toBeNull();
  });

  it('labels who opened a request', () => {
    expect(openedBy({ requestedByUserId: subject, subjectUserId: subject })).toBe('subject');
    expect(openedBy({ requestedByUserId: staff, subjectUserId: subject })).toBe('staff');
    expect(openedBy({ requestedByUserId: null, subjectUserId: subject })).toBe('system');
  });
});

describe('target keys', () => {
  it('scope keys so one member cannot block another', () => {
    expect(targetKeys.project('p', 'm1')).not.toBe(targetKeys.project('p', 'm2'));
    expect(targetKeys.skill('m', 'mind.research')).toBe('skill:m:mind.research');
    expect(targetKeys.identity('m')).toBe('identity:m');
  });
});

describe('identity eligibility', () => {
  it('classifies roles per the documented rule', () => {
    expect(classifyIdentityRoles(['member'])).toBe('eligible');
    expect(classifyIdentityRoles(['applicant'])).toBe('eligible');
    expect(classifyIdentityRoles(['trial', 'supporter'])).toBe('eligible');
    expect(classifyIdentityRoles(['verified'])).toBe('verified');
    expect(classifyIdentityRoles(['verified', 'moderator'])).toBe('staff');
    expect(classifyIdentityRoles(['founder'])).toBe('staff');
    expect(classifyIdentityRoles(['supporter'])).toBe('ineligible');
    expect(classifyIdentityRoles([])).toBe('ineligible');
  });
});

describe('input hardening', () => {
  it('accepts only http(s) URLs without credentials', () => {
    expect(isSafeHttpUrl('https://example.com/work')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'https://user:secret@example.com',
      'not a url',
      '//example.com',
    ])
      expect(isSafeHttpUrl(bad)).toBe(false);
  });

  it('detects NUL and control characters but allows newlines and tabs', () => {
    expect(hasControlCharacters('line one\nline two\ttabbed\r\n')).toBe(false);
    expect(hasControlCharacters('nul\u0000byte')).toBe(true);
    expect(hasControlCharacters('bell\u0007')).toBe(true);
    expect(hasControlCharacters('del\u007f')).toBe(true);
  });

  it('caps evidence count, text length and duplicate ids', () => {
    const target = { type: 'identity' as const };
    const tooMany = Array.from({ length: MAX_EVIDENCE_PER_VERIFICATION + 1 }, (_, i) => ({
      title: `Evidence ${i}`,
    }));
    expect(() => parseInput(requestVerificationSchema, { target, evidence: tooMany })).toThrow(
      ValidationError,
    );
    const mixed = {
      target,
      evidence: Array.from({ length: 6 }, (_, i) => ({ title: `E${i}xx` })),
      evidenceIds: [
        UUID_A,
        UUID_B,
        UUID_A.replace('8f', '9f'),
        UUID_B.replace('1c', '2c'),
        UUID_A.replace('8f', '7f'),
      ],
    };
    expect(() => parseInput(requestVerificationSchema, mixed)).toThrow(/at most/);
    expect(() =>
      parseInput(requestVerificationSchema, {
        target,
        evidenceIds: [UUID_A, UUID_A.toUpperCase()],
      }),
    ).toThrow(/unique/);
    expect(() =>
      parseInput(requestVerificationSchema, {
        target,
        claim: 'x'.repeat(TEXT_LIMITS.claim + 1),
      }),
    ).toThrow(ValidationError);
  });

  it('normalizes skill targets', () => {
    const parsed = parseInput(requestVerificationSchema, {
      target: { type: 'skill', facetKey: ' mind.research ', requestedRank: 'b' },
    });
    expect(parsed.target).toEqual({
      type: 'skill',
      facetKey: 'mind.research',
      requestedRank: 'B',
    });
  });
});

describe('copy', () => {
  const v = { number: 42, type: 'skill' as const, targetLabel: 'Research' };

  it('reads calm and precise', () => {
    expect(verificationHeadline(v)).toBe('VER-0042 — SKILL: Research');
    expect(subjectNoticeCopy(v, { kind: 'approved', grantedRank: 'B' })).toEqual({
      title: 'VERIFICATION APPROVED',
      body: 'VER-0042 — SKILL: Research. Verified at B.',
    });
    expect(subjectNoticeCopy(v, { kind: 'rejected', note: 'Needs a public artifact.' }).body).toBe(
      'VER-0042 — SKILL: Research. Not verified. Note: Needs a public artifact.',
    );
    expect(
      subjectNoticeCopy(v, {
        kind: 'expired',
        requestedAt: NOW,
        expiresAt: computeExpiry(NOW),
      }).body,
    ).toBe('VER-0042 — SKILL: Research. No decision within 30 days. Request again when ready.');
  });
});
