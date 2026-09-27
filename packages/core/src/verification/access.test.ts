import { describe, expect, it } from 'vitest';
import { ManualClock } from '../kernel/clock';
import { type Actor, systemActor, type UserActor } from '../permissions/actor';
import { capabilitiesForRoles } from '../permissions/capabilities';
import type { OrgRole } from '../permissions/roles';
import { verificationAccess } from './access';
import type { VerificationDetail } from './query.service';

const NOW = '2026-03-01T12:00:00.000Z';
const HOUR_MS = 3_600_000;
const clock = new ManualClock(NOW);

function user(id: string, roles: OrgRole[]): UserActor {
  return {
    kind: 'user',
    userId: `user-${id}`,
    discordId: `1000000000000000${id}`,
    memberId: `member-${id}`,
    displayName: id,
    roles,
    standing: 'good',
    capabilities: capabilitiesForRoles(roles),
  };
}

function detail(overrides: Partial<VerificationDetail> = {}): VerificationDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    number: 1,
    reference: 'VER-0001',
    type: 'project',
    status: 'pending',
    claim: 'Built it.',
    targetType: 'project',
    targetId: '00000000-0000-4000-8000-000000000002',
    targetLabel: 'Orbit tracker',
    facetKey: null,
    requestedRank: null,
    grantedRank: null,
    subject: { memberId: 'member-subject', handle: 'nova', displayName: 'Nova' },
    openedBy: 'subject',
    evidenceCount: 0,
    requestedAt: new Date(NOW),
    expiresAt: new Date(Date.parse(NOW) + HOUR_MS),
    decidedAt: null,
    revokedAt: null,
    assignedVerifier: null,
    decisionNote: null,
    revokeReason: null,
    evidence: [],
    staff: {
      requestedBy: null,
      verifier: null,
      revokedBy: null,
      reviewStartedAt: null,
      outcome: null,
    },
    ...overrides,
  };
}

const access = (actor: Actor, overrides: Partial<VerificationDetail> = {}) =>
  verificationAccess({ actor, clock }, detail(overrides));

describe('verificationAccess', () => {
  const verifier = user('01', ['operations']);
  const evaluator = user('02', ['core']);

  it('offers the controls the state allows to an eligible verifier', () => {
    expect(access(verifier)).toEqual({
      controls: ['start_review', 'approve', 'reject'],
      blocked: null,
    });
    expect(
      access(verifier, {
        status: 'in_review',
        assignedVerifier: { userId: verifier.userId, name: 'me' },
      }),
    ).toEqual({ controls: ['approve', 'reject'], blocked: null });
    expect(access(verifier, { status: 'approved' })).toEqual({
      controls: ['revoke'],
      blocked: null,
    });
    expect(access(verifier, { status: 'rejected' })).toEqual({ controls: [], blocked: 'closed' });
  });

  it('members see no controls and no reason', () => {
    expect(access(user('03', ['trial']))).toEqual({ controls: [], blocked: null });
    expect(access(user('subject', ['trial']))).toEqual({ controls: [], blocked: null });
  });

  it('BREAK: the subject, the staff opener and a bystander to an assignment are blocked', () => {
    const subject = user('subject', ['operations']);
    expect(access(subject)).toEqual({ controls: [], blocked: 'subject' });
    expect(access(subject, { status: 'approved' })).toEqual({ controls: [], blocked: 'subject' });

    const opened = {
      openedBy: 'staff' as const,
      staff: {
        requestedBy: { userId: verifier.userId, name: 'opener' },
        verifier: null,
        revokedBy: null,
        reviewStartedAt: null,
        outcome: null,
      },
    };
    expect(access(verifier, opened)).toEqual({ controls: [], blocked: 'requester' });
    expect(access(evaluator, opened).controls).toEqual(['start_review', 'approve', 'reject']);
    expect(access(verifier, { ...opened, status: 'approved' }).controls).toEqual(['revoke']);

    const assigned = {
      status: 'in_review' as const,
      assignedVerifier: { userId: evaluator.userId, name: 'other' },
    };
    expect(access(verifier, assigned)).toEqual({ controls: [], blocked: 'assigned_elsewhere' });
  });

  it('BREAK: type capabilities and expiry close the controls', () => {
    expect(access(verifier, { type: 'skill' })).toEqual({ controls: [], blocked: 'capability' });
    expect(access(evaluator, { type: 'skill' }).controls).toContain('approve');
    expect(access(verifier, { expiresAt: new Date(NOW) })).toEqual({
      controls: [],
      blocked: 'closed',
    });
  });

  it('system actors hold every capability but are never an assignee', () => {
    expect(access(systemActor('job')).controls).toEqual(['start_review', 'approve', 'reject']);
  });
});
