import { describe, expect, it } from 'vitest';
import type { applications } from '@jave/core';
import { EMBED_TOTAL_CHARS, fitEmbeds, totalEmbedLength } from './embed-budget';
import { renderReviewCard } from './review-card';
import { renderStaffDetails } from './staff-views';

const AT = new Date('2026-03-01T12:00:00.000Z');
const person = (name: string): applications.PersonRef => ({
  userId: '00000000-0000-4000-8000-000000000001',
  memberId: '00000000-0000-4000-8000-000000000002',
  discordId: '123456789012345678',
  displayName: name,
  handle: name.toLowerCase(),
});
const TALLY = { accept: 1, reject: 1, interview: 0, abstain: 0, counted: 2, averageScore: 3.5 };

/** Every free-text field at its service maximum, full of markdown that escaping lengthens. */
function maximalView(): applications.StaffApplicationView {
  const long = (n: number) => '*_'.repeat(n / 2);
  return {
    id: '00000000-0000-4000-8000-000000000010',
    number: 'APP-0042',
    status: 'review',
    applicant: person('Nova'),
    domainKey: 'create',
    motivation: long(2000),
    experience: long(2000),
    projects: long(2000),
    portfolioUrl: `https://example.org/${'a'.repeat(2000)}`,
    evidenceLinks: Array.from(
      { length: 10 },
      (_, i) => `https://example.org/${i}/${'b'.repeat(2000)}`,
    ),
    references: long(1000),
    referral: { code: 'REF_CODE-1', owner: person('Vega') },
    assignedReviewer: person('Theo'),
    submittedAt: AT,
    interviewAt: AT,
    decidedAt: AT,
    decidedBy: person('Core'),
    decisionReason: long(2000),
    applicantMessage: long(1000),
    createdAt: AT,
    updatedAt: AT,
    reviews: Array.from({ length: 12 }, (_, i) => ({
      reviewer: person(`Reviewer${i}`),
      reviewerUserId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
      recommendation: 'accept' as const,
      score: 4,
      note: long(2000),
      createdAt: AT,
      updatedAt: AT,
    })),
    tally: TALLY,
    history: Array.from({ length: 20 }, () => ({
      from: 'submitted' as const,
      to: 'review' as const,
      actor: person('Theo'),
      note: null,
      at: AT,
    })),
  };
}

describe('staff views', () => {
  it('keeps the maximal staff view inside Discord’s embed budget', () => {
    const payload = renderStaffDetails(maximalView(), null, 'https://jave.test');
    expect(totalEmbedLength(payload.embeds!)).toBeLessThanOrEqual(EMBED_TOTAL_CHARS);
    for (const embed of payload.embeds!)
      for (const f of embed.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(payload.ephemeral).toBe(true);
  });

  it('fitEmbeds trims the longest fields first and never below a readable floor', () => {
    const fitted = fitEmbeds(
      [
        {
          title: 'T',
          fields: [
            { name: 'a', value: 'x'.repeat(4000) },
            { name: 'b', value: 'y'.repeat(3000) },
            { name: 'c', value: 'short' },
          ],
        },
      ],
      5000,
    );
    expect(totalEmbedLength(fitted)).toBeLessThanOrEqual(5000);
    expect(fitted[0]!.fields![2]!.value).toBe('short');
  });

  it('the review card has no link button without an http(s) public URL', () => {
    const card: applications.ReviewCard = {
      applicationId: '00000000-0000-4000-8000-000000000010',
      number: 'APP-0042',
      status: 'submitted',
      revision: 1,
      channelId: '400000000000000001',
      message: null,
      applicant: person('Nova'),
      domain: { key: 'create', label: 'Create' },
      submittedAt: AT,
      interviewAt: null,
      decidedAt: null,
      assignedReviewer: null,
      tally: { ...TALLY, counted: 0, accept: 0, reject: 0, averageScore: null },
      decisionReady: false,
      motivationExcerpt: 'x',
      projectsExcerpt: null,
      portfolioUrl: null,
      evidenceLinkCount: 1,
      referred: false,
      actions: ['start_review', 'review'],
    };
    for (const url of [undefined, 'javascript:alert(1)', 'ftp://jave.test', 'not a url']) {
      const payload = renderReviewCard(card, url);
      const buttons = payload.components!.flatMap((r) => r.components);
      expect(buttons.some((b) => 'url' in b)).toBe(false);
    }
  });
});
