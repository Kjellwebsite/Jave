import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, evidence, memberRoles, verifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY } from '../kernel/clock';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { loadCatalog } from '../identity/ranks';
import {
  assignVerifier,
  decideVerification,
  getVerification,
  MAX_OPEN_VERIFICATIONS_PER_MEMBER,
  requestVerification,
  revokeVerification,
  startReview,
} from './index';
import { KIT_SETUP_TIMEOUT_MS, KIT_TEST_OPTIONS } from './testing/fixtures';

describe('verification — BREAK: input, state, concurrency, time', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  let subject: UserActor;
  let ops: UserActor;
  beforeEach(async () => {
    kit = await createTestKit();
    subject = await kit.member();
    ops = await kit.member({ roles: ['operations'] });
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  const identity = { type: 'identity' as const };

  it('BREAK: malformed and hostile input is a ValidationError, never a database error', async () => {
    const as = kit.as(subject);
    const cases: unknown[] = [
      { target: { type: 'citizenship' } },
      { target: { type: 'project', projectId: "1' OR '1'='1" } },
      { target: identity, claim: 'x'.repeat(100_000) },
      { target: identity, claim: 'null\u0000byte' },
      { target: identity, evidence: [{ title: 'xss', url: 'javascript:alert(1)' }] },
      {
        target: identity,
        evidence: [{ title: 'creds', url: 'https://admin:hunter2@example.com' }],
      },
      { target: identity, evidence: [{ title: 'x'.repeat(201) }] },
      { target: identity, evidenceIds: ['not-a-uuid'] },
      { target: identity, subjectMemberId: 'robert"); drop table members;--' },
    ];
    for (const input of cases) {
      await expect(requestVerification(as, input as never)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(getVerification(as, '../../etc/passwd')).rejects.toBeInstanceOf(ValidationError);
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: 'nope',
        decision: 'approve',
        note: 'x',
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await kit.db.select().from(verifications)).toHaveLength(0);
  });

  it('BREAK: injection-shaped text is stored verbatim; smuggled fields are ignored', async () => {
    const claim = "'; drop table verifications; -- <script>alert(1)</script>";
    const created = await requestVerification(kit.as(subject), {
      target: identity,
      claim,
      status: 'approved',
      verifierUserId: ops.userId,
    } as never);
    expect(created.claim).toBe(claim);
    expect(created.status).toBe('pending');
    expect(created.staff).toBeNull();
    const [row] = await kit.db.select().from(verifications);
    expect(row!.verifierUserId).toBeNull();
  });

  it('BREAK: duplicate requests — sequential and concurrent', async () => {
    const first = await requestVerification(kit.as(subject), { target: identity });
    await expect(requestVerification(kit.as(subject), { target: identity })).rejects.toThrow(
      `${first.reference} is already open for this target.`,
    );
    // Staff cannot sidestep the rule by opening a parallel one.
    await expect(
      requestVerification(kit.as(ops), { subjectMemberId: subject.memberId!, target: identity }),
    ).rejects.toBeInstanceOf(ConflictError);

    const other = await kit.member({ roles: ['trial'] });
    const target = { type: 'skill' as const, facetKey: 'mind.reasoning', requestedRank: 'B' };
    const results = await Promise.allSettled([
      requestVerification(kit.as(other), { target }),
      requestVerification(kit.as(other), { target }),
      requestVerification(kit.as(other), { target }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    const open = await kit.db
      .select()
      .from(verifications)
      .where(eq(verifications.subjectMemberId, other.memberId!));
    expect(open).toHaveLength(1);
  });

  it('BREAK: concurrent approvals apply exactly once', async () => {
    const second = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: identity });
    const results = await Promise.allSettled([
      decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'first',
      }),
      decideVerification(kit.as(second), {
        verificationId: requested.id,
        decision: 'reject',
        note: 'second',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InvalidStateError);
    const decisions = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification.approved'));
    const rejections = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification.rejected'));
    expect(decisions.length + rejections.length).toBe(1);
    const grants = await kit.db
      .select()
      .from(memberRoles)
      .where(and(eq(memberRoles.memberId, subject.memberId!), eq(memberRoles.role, 'verified')));
    expect(grants.length).toBeLessThanOrEqual(1);
  });

  it('BREAK: invalid transitions are refused', async () => {
    const requested = await requestVerification(kit.as(subject), { target: identity });
    await expect(
      revokeVerification(kit.as(ops), { verificationId: requested.id, reason: 'too early' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await decideVerification(kit.as(ops), {
      verificationId: requested.id,
      decision: 'reject',
      note: 'No evidence.',
    });
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'changed my mind',
      }),
    ).rejects.toThrow(/is rejected and cannot move to approved/);
    await expect(startReview(kit.as(ops), { verificationId: requested.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(
      assignVerifier(kit.as(ops), { verificationId: requested.id, verifierMemberId: null }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      revokeVerification(kit.as(ops), { verificationId: requested.id, reason: 'not approved' }),
    ).rejects.toBeInstanceOf(InvalidStateError);

    const again = await requestVerification(kit.as(subject), { target: identity });
    await decideVerification(kit.as(ops), {
      verificationId: again.id,
      decision: 'approve',
      note: 'Confirmed.',
    });
    await revokeVerification(kit.as(ops), {
      verificationId: again.id,
      reason: 'Duplicate account.',
    });
    await expect(
      revokeVerification(kit.as(ops), { verificationId: again.id, reason: 'twice' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: again.id,
        decision: 'approve',
        note: 'resurrect',
      }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: grantedRank only applies to skill approvals', async () => {
    const requested = await requestVerification(kit.as(subject), { target: identity });
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'sneak a rank in',
        grantedRank: 'S',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const core = await kit.member({ roles: ['core'] });
    const skill = await requestVerification(kit.as(subject), {
      target: { type: 'skill', facetKey: 'mind.research', requestedRank: 'B' },
    });
    await expect(
      decideVerification(kit.as(core), {
        verificationId: skill.id,
        decision: 'reject',
        note: 'Not yet.',
        grantedRank: 'C',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: time edges — decisions stop exactly at expiresAt', async () => {
    const requested = await requestVerification(kit.as(subject), { target: identity });
    const later = await kit.member({ roles: ['trial'] });
    const second = await requestVerification(kit.as(later), { target: identity });

    kit.clock.advance(30 * DAY - 1);
    const onTime = await decideVerification(kit.as(ops), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Just in time.',
    });
    expect(onTime.status).toBe('approved');

    kit.clock.advance(1);
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: second.id,
        decision: 'approve',
        note: 'Too late.',
      }),
    ).rejects.toThrow(/has expired/);
    await expect(startReview(kit.as(ops), { verificationId: second.id })).rejects.toThrow(
      /has expired/,
    );
    await expect(
      assignVerifier(kit.as(ops), { verificationId: second.id, verifierMemberId: ops.memberId! }),
    ).rejects.toThrow(/has expired/);
  });

  it('BREAK: a member cannot flood the queue; staff are not capped', async () => {
    const catalog = await loadCatalog(kit.system);
    const facets = catalog.facets.slice(0, MAX_OPEN_VERIFICATIONS_PER_MEMBER);
    expect(facets).toHaveLength(MAX_OPEN_VERIFICATIONS_PER_MEMBER);
    for (const facet of facets) {
      await requestVerification(kit.as(subject), {
        target: { type: 'skill', facetKey: facet.key, requestedRank: 'C' },
        evidence: [{ title: 'Some work', url: 'https://example.com' }],
      });
    }
    await expect(requestVerification(kit.as(subject), { target: identity })).rejects.toThrow(
      /open verifications/,
    );
    // Nothing from the refused request persisted (evidence rolled back too).
    const rows = await kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.memberId, subject.memberId!));
    expect(rows).toHaveLength(MAX_OPEN_VERIFICATIONS_PER_MEMBER);
    const opened = await requestVerification(kit.as(ops), {
      subjectMemberId: subject.memberId!,
      target: identity,
    });
    expect(opened.status).toBe('pending');
  });

  it('BREAK: unknown capability and rank on skill requests', async () => {
    await expect(
      requestVerification(kit.as(subject), {
        target: { type: 'skill', facetKey: 'mind.telepathy', requestedRank: 'S' },
      }),
    ).rejects.toThrow('Unknown capability.');
    await expect(
      requestVerification(kit.as(subject), {
        target: { type: 'skill', facetKey: 'mind.reasoning', requestedRank: 'Z' },
      }),
    ).rejects.toThrow('Unknown rank.');
  });
});
