import { describe, expect, it } from 'vitest';
import { applicationStatus } from '@jave/database';
import { DAY } from '../kernel/clock';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { APPLICATION_FORM_FIELDS, DISCORD_MODAL_LIMITS } from './form';
import {
  acceptanceGrant,
  cooldownEndsAt,
  isEligibleToApply,
  missingRequirements,
  shouldGrantApplicant,
  tallyReviews,
} from './rules';
import {
  APPLICATION_FIELD_LIMITS,
  decideSchema,
  hasNoControlChars,
  isSafeHttpUrl,
  reviewSchema,
  STAFF_VISIBLE_STATUSES,
  splitLinkList,
  updateDraftSchema,
} from './schemas';
import {
  APPLICATION_TRANSITIONS,
  type ApplicationStatus,
  assertTransition,
  canTransition,
  isOpenStatus,
  isTerminalStatus,
  OPEN_STATUSES,
  staffActionsFor,
} from './state-machine';

const ALL_STATUSES = applicationStatus.enumValues;

describe('application state machine', () => {
  it('covers every database status', () => {
    expect(Object.keys(APPLICATION_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('follows DRAFT → SUBMITTED → REVIEW → INTERVIEW → ACCEPTED | REJECTED', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'review')).toBe(true);
    expect(canTransition('review', 'interview')).toBe(true);
    expect(canTransition('interview', 'accepted')).toBe(true);
    expect(canTransition('interview', 'rejected')).toBe(true);
    expect(canTransition('review', 'accepted')).toBe(true);
  });

  it('allows WITHDRAWN from every open state and nothing else', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, 'withdrawn')).toBe(isOpenStatus(status));
    }
  });

  it('acceptance always passes through REVIEW', () => {
    expect(canTransition('draft', 'accepted')).toBe(false);
    expect(canTransition('submitted', 'accepted')).toBe(false);
  });

  it('terminal states have no exits', () => {
    for (const status of ['accepted', 'rejected', 'withdrawn'] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      for (const to of ALL_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
  });

  it('never skips backwards or re-enters DRAFT', () => {
    for (const status of ALL_STATUSES) expect(canTransition(status, 'draft')).toBe(false);
    expect(canTransition('interview', 'review')).toBe(false);
    expect(canTransition('review', 'submitted')).toBe(false);
  });

  it('assertTransition raises InvalidStateError with both states', () => {
    expect(() => assertTransition('accepted', 'rejected')).toThrow(InvalidStateError);
    expect(() => assertTransition('draft', 'submitted')).not.toThrow();
  });

  it('open statuses match the partial unique index', () => {
    expect([...OPEN_STATUSES].sort()).toEqual(['draft', 'interview', 'review', 'submitted']);
  });

  it('staff actions agree with the transition table', () => {
    for (const status of ALL_STATUSES) {
      const actions = staffActionsFor(status);
      expect(actions.includes('accept')).toBe(canTransition(status, 'accepted'));
      expect(actions.includes('reject')).toBe(canTransition(status, 'rejected'));
      expect(actions.includes('start_review')).toBe(canTransition(status, 'review'));
      expect(actions.includes('schedule_interview')).toBe(
        canTransition(status, 'interview') || status === 'interview',
      );
    }
  });

  it('staff can filter every status except DRAFT', () => {
    expect([...STAFF_VISIBLE_STATUSES].sort()).toEqual(
      ALL_STATUSES.filter((s: ApplicationStatus) => s !== 'draft').sort(),
    );
  });
});

describe('application rules', () => {
  const complete = {
    domainKey: 'mind',
    motivation: 'm'.repeat(40),
    experience: 'e'.repeat(40),
    projects: null,
    portfolioUrl: null,
    evidenceLinks: ['https://example.com'],
  };

  it('lists missing requirements', () => {
    expect(missingRequirements(complete)).toEqual([]);
    expect(
      missingRequirements({
        domainKey: null,
        motivation: 'short',
        experience: null,
        projects: null,
        portfolioUrl: null,
        evidenceLinks: [],
      }),
    ).toEqual(['domain', 'motivation', 'experience', 'proof_of_work']);
  });

  it('accepts any one kind of proof of work', () => {
    const none = { ...complete, evidenceLinks: [] };
    expect(missingRequirements(none)).toEqual(['proof_of_work']);
    expect(missingRequirements({ ...none, projects: 'Built X' })).toEqual([]);
    expect(missingRequirements({ ...none, portfolioUrl: 'https://x.dev' })).toEqual([]);
  });

  it('only people outside JAVELIN may apply', () => {
    expect(isEligibleToApply(['member'])).toBe(true);
    expect(isEligibleToApply(['member', 'supporter'])).toBe(true);
    expect(isEligibleToApply([])).toBe(true);
    expect(isEligibleToApply(['applicant'])).toBe(true);
    expect(isEligibleToApply(['trial'])).toBe(false);
    expect(isEligibleToApply(['verified'])).toBe(false);
    expect(isEligibleToApply(['member', 'moderator'])).toBe(false);
  });

  it('grants APPLICANT only to plain members', () => {
    expect(shouldGrantApplicant(['member'])).toBe(true);
    expect(shouldGrantApplicant(['member', 'supporter'])).toBe(true);
    expect(shouldGrantApplicant([])).toBe(true);
    expect(shouldGrantApplicant(['applicant'])).toBe(false);
    expect(shouldGrantApplicant(['trial'])).toBe(false);
  });

  it('acceptance never demotes', () => {
    expect(acceptanceGrant(['applicant'], 'trial')).toBe('trial');
    expect(acceptanceGrant(['member'], 'verified')).toBe('verified');
    expect(acceptanceGrant(['verified'], 'trial')).toBeNull();
    expect(acceptanceGrant(['trial'], 'trial')).toBeNull();
  });

  it('computes the rejection cooldown, including the boundary', () => {
    const rejectedAt = new Date('2026-01-01T00:00:00Z');
    const justBefore = new Date(rejectedAt.getTime() + 30 * DAY - 1);
    const exactly = new Date(rejectedAt.getTime() + 30 * DAY);
    expect(cooldownEndsAt(rejectedAt, 30, justBefore)?.toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
    expect(cooldownEndsAt(rejectedAt, 30, exactly)).toBeNull();
    expect(cooldownEndsAt(rejectedAt, 0, justBefore)).toBeNull();
    expect(cooldownEndsAt(null, 30, justBefore)).toBeNull();
  });

  it('tallies reviews; abstentions do not count toward the minimum', () => {
    const tally = tallyReviews([
      { recommendation: 'accept', score: 5 },
      { recommendation: 'interview', score: 4 },
      { recommendation: 'abstain', score: null },
      { recommendation: 'reject', score: 2 },
    ]);
    expect(tally).toMatchObject({ accept: 1, interview: 1, abstain: 1, reject: 1, counted: 3 });
    expect(tally.averageScore).toBe(3.7);
    expect(tallyReviews([]).averageScore).toBeNull();
  });
});

describe('application input schemas', () => {
  it('turns blank modal fields into cleared values', () => {
    const parsed = parseInput(updateDraftSchema, {
      motivation: '   ',
      portfolioUrl: '',
      referralCode: '',
      domainKey: '',
    });
    expect(parsed).toMatchObject({
      motivation: null,
      portfolioUrl: null,
      referralCode: null,
      domainKey: null,
    });
    expect(parsed.experience).toBeUndefined();
  });

  it('splits a modal block of links, dedupes and normalizes them', () => {
    const parsed = parseInput(updateDraftSchema, {
      evidenceLinks: 'https://EXAMPLE.com/a\nhttps://example.com/a\n\n https://x.dev/q?ids=1,2',
    });
    expect(parsed.evidenceLinks).toEqual(['https://example.com/a', 'https://x.dev/q?ids=1,2']);
    expect(splitLinkList('  a \n\n b,c ')).toEqual(['a', 'b,c']);
  });

  it('accepts only http(s) URLs without credentials', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/path?q=1')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'https://user:pass@example.com',
      '//example.com',
      'example.com',
    ]) {
      expect(isSafeHttpUrl(bad)).toBe(false);
    }
  });

  it('caps evidence links at 10', () => {
    const links = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    expect(() => parseInput(updateDraftSchema, { evidenceLinks: links })).toThrow(ValidationError);
    expect(() => parseInput(updateDraftSchema, { evidenceLinks: links.join('\n') })).toThrow(
      /at most 10/,
    );
  });

  it('rejects control characters but keeps newlines and tabs', () => {
    expect(hasNoControlChars('line one\nline two\ttabbed\r\n')).toBe(true);
    expect(hasNoControlChars('nul\u0000byte')).toBe(false);
    expect(hasNoControlChars('bell\u0007')).toBe(false);
    expect(hasNoControlChars('del\u007f')).toBe(false);
  });

  it('requires a score unless abstaining', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(
      parseInput(reviewSchema, { applicationId: id, recommendation: 'accept', score: '4' }).score,
    ).toBe(4);
    for (const score of [true, '', ' ', '4.5', null]) {
      expect(() =>
        parseInput(reviewSchema, { applicationId: id, recommendation: 'accept', score }),
      ).toThrow(ValidationError);
    }
    expect(() => parseInput(reviewSchema, { applicationId: id, recommendation: 'accept' })).toThrow(
      /score/,
    );
    expect(() =>
      parseInput(reviewSchema, { applicationId: id, recommendation: 'abstain', score: 3 }),
    ).toThrow(/abstention/);
    expect(() =>
      parseInput(reviewSchema, { applicationId: id, recommendation: 'accept', score: 6 }),
    ).toThrow(ValidationError);
  });

  it('requires an internal reason for decisions', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(() =>
      parseInput(decideSchema, { applicationId: id, decision: 'accept', reason: '  ' }),
    ).toThrow(/reason/);
  });
});

describe('application form', () => {
  it('fits Discord modal limits', () => {
    for (const field of APPLICATION_FORM_FIELDS) {
      expect(field.label.length).toBeLessThanOrEqual(DISCORD_MODAL_LIMITS.labelChars);
      expect(field.placeholder.length).toBeLessThanOrEqual(DISCORD_MODAL_LIMITS.placeholderChars);
      expect(field.maxLength).toBeLessThanOrEqual(DISCORD_MODAL_LIMITS.inputChars);
    }
    for (const page of [1, 2] as const) {
      const inputs = APPLICATION_FORM_FIELDS.filter((field) => field.modalPage === page);
      expect(inputs.length).toBeLessThanOrEqual(DISCORD_MODAL_LIMITS.inputsPerModal);
    }
  });

  it('uses the brief’s field caps', () => {
    expect(APPLICATION_FIELD_LIMITS).toMatchObject({
      motivation: 2000,
      experience: 2000,
      projects: 2000,
      references: 1000,
      evidenceLinks: 10,
    });
  });

  it('marks references as the only private field', () => {
    expect(APPLICATION_FORM_FIELDS.filter((f) => f.private).map((f) => f.key)).toEqual([
      'references',
    ]);
  });
});
