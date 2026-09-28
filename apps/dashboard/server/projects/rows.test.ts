import { describe, expect, it } from 'vitest';
import type { projects } from '@jave/core';
import { contributionRows, urlHost } from './rows';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function view(overrides: Partial<projects.ContributionView>): projects.ContributionView {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    memberId: OTHER,
    memberHandle: 'jun',
    memberDisplayName: 'Jun Park',
    projectId: null,
    projectSlug: null,
    projectTitle: null,
    kind: 'code',
    title: 'Parser',
    description: null,
    url: null,
    source: 'manual',
    status: 'submitted',
    reviewNote: null,
    occurredAt: new Date('2026-09-01T12:00:00Z'),
    verifiedAt: null,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  };
}

describe('contributionRows', () => {
  it('offers review only on submitted work by someone else', () => {
    const [other, mine, verified] = contributionRows(
      [view({}), view({ memberId: ME }), view({ status: 'verified' })],
      ME,
      'UTC',
    );
    expect(other).toMatchObject({ reviewable: true, own: false, kindLabel: 'Code' });
    expect(mine).toMatchObject({ reviewable: false, own: true });
    expect(verified).toMatchObject({ reviewable: false });
  });

  it('BREAK: non-http(s) links are never rendered as links', () => {
    const [row] = contributionRows([view({ url: 'javascript:alert(1)' })], ME, 'UTC');
    expect(row!.href).toBeNull();
    const [safe] = contributionRows([view({ url: 'https://example.org/pr/1' })], ME, 'UTC');
    expect(safe!.href).toBe('https://example.org/pr/1');
  });

  it('formats dates in the viewer time zone and keeps the project reference', () => {
    const [row] = contributionRows(
      [
        view({
          projectSlug: 'rocket',
          projectTitle: 'Rocket',
          occurredAt: new Date('2026-09-01T23:30:00Z'),
        }),
      ],
      null,
      'Asia/Tokyo',
    );
    expect(row!.occurredLabel).toBe('2026-09-02');
    expect(row!.project).toEqual({ slug: 'rocket', title: 'Rocket' });
  });
});

describe('urlHost', () => {
  it('shows the host, or the raw text when it does not parse', () => {
    expect(urlHost('https://docs.example.org/a?b')).toBe('docs.example.org');
    expect(urlHost('not a url')).toBe('not a url');
  });
});
