import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, evidence, members, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  addProjectMember,
  changeProjectStatus,
  createProject,
  listContributions,
  MAX_PENDING_CONTRIBUTIONS,
  recordContribution,
  recordExternalContribution,
  rejectContribution,
  verifyContribution,
} from './index';

import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from './testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('contributions', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let author: UserActor;
  let owner: UserActor;
  let outsider: UserActor;
  let reviewer: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    author = await kit.member({ username: 'author' });
    owner = await kit.member({ username: 'owner' });
    outsider = await kit.member({ username: 'outsider' });
    reviewer = await kit.member({ roles: ['operations'], username: 'reviewer' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  async function teamProject(visibility: 'public' | 'members' | 'private' = 'members') {
    const project = await createProject(kit.as(owner), { title: 'Engine', visibility });
    await addProjectMember(kit.as(owner), { projectId: project.id, memberId: author.memberId! });
    return project;
  }

  it('records your own contribution on a project you belong to', async () => {
    const project = await teamProject();
    const contribution = await recordContribution(kit.as(author), {
      projectId: project.id,
      kind: 'code',
      title: 'Parser rewrite',
      url: 'https://github.com/x/y/pull/1',
    });
    expect(contribution).toMatchObject({ status: 'submitted', source: 'manual' });
    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'contribution.submitted'));
    expect(event!.subjectMemberId).toBe(author.memberId);
  });

  it('BREAK: cannot attach a contribution to a project you are not on', async () => {
    const project = await teamProject();
    await expect(
      recordContribution(kit.as(outsider), {
        projectId: project.id,
        kind: 'code',
        title: 'Not mine',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('BREAK: refuses future dates, bad kinds, huge and unsafe input', async () => {
    const tomorrow = new Date(kit.clock.now().getTime() + 86_400_000).toISOString();
    await expect(
      recordContribution(kit.as(author), {
        kind: 'code',
        title: 'Time travel',
        occurredAt: tomorrow,
      }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      recordContribution(kit.as(author), { kind: 'xp' as never, title: 'Farm' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordContribution(kit.as(author), { kind: 'code', title: 'y'.repeat(201) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordContribution(kit.as(author), {
        kind: 'code',
        title: 'Link',
        url: 'javascript:alert(document.cookie)',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordContribution(kit.as(anonymousActor), { kind: 'code', title: 'Anon' }),
    ).rejects.toThrow();
  });

  it('BREAK: caps pending contributions per member', async () => {
    for (let i = 0; i < MAX_PENDING_CONTRIBUTIONS; i++) {
      await recordContribution(kit.as(author), { kind: 'writing', title: `Post ${i}` });
    }
    await expect(
      recordContribution(kit.as(author), { kind: 'writing', title: 'One too many' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('a project owner verifies: evidence, event, audit and notification', async () => {
    const project = await teamProject();
    const contribution = await recordContribution(kit.as(author), {
      projectId: project.id,
      kind: 'design',
      title: 'Brand system',
    });
    const verified = await verifyContribution(kit.as(owner), {
      contributionId: contribution.id,
      note: 'Solid work.',
    });
    expect(verified).toMatchObject({
      status: 'verified',
      verifiedByUserId: owner.userId,
      reviewNote: 'Solid work.',
    });
    const [proof] = await kit.db
      .select()
      .from(evidence)
      .where(and(eq(evidence.sourceType, 'contribution'), eq(evidence.sourceId, contribution.id)));
    expect(proof).toMatchObject({
      kind: 'contribution',
      status: 'accepted',
      memberId: author.memberId,
    });
    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'contribution.verified'));
    expect(event!.subjectMemberId).toBe(author.memberId);
    expect(event!.payload).toMatchObject({
      evidenceId: proof!.id,
      visibility: 'members',
      verifiedBy: 'project',
    });
    const [note] = await kit.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, author.userId),
          eq(notifications.type, 'contribution.updated'),
        ),
      );
    expect(note).toMatchObject({
      title: 'CONTRIBUTION VERIFIED',
      body: 'Brand system — verified.',
    });
    await expect(
      verifyContribution(kit.as(reviewer), { contributionId: contribution.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: nobody verifies their own contribution — not even staff or the owner', async () => {
    const own = await recordContribution(kit.as(reviewer), { kind: 'review', title: 'My review' });
    await expect(
      verifyContribution(kit.as(reviewer), { contributionId: own.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const project = await teamProject();
    const ownerWork = await recordContribution(kit.as(owner), {
      projectId: project.id,
      kind: 'code',
      title: 'Owner work',
    });
    await expect(
      verifyContribution(kit.as(owner), { contributionId: ownerWork.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const blocked = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'contribution.self_review_blocked'));
    expect(blocked).toHaveLength(2);
    expect(blocked.every((row) => row.result === 'denied')).toBe(true);
  });

  it('BREAK: plain members and contributors of the project cannot verify', async () => {
    const project = await teamProject();
    const peer = await kit.member();
    await addProjectMember(kit.as(owner), { projectId: project.id, memberId: peer.memberId! });
    const contribution = await recordContribution(kit.as(author), {
      projectId: project.id,
      kind: 'code',
      title: 'Feature',
    });
    await expect(
      verifyContribution(kit.as(peer), { contributionId: contribution.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      verifyContribution(kit.as(outsider), { contributionId: contribution.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const standalone = await recordContribution(kit.as(author), { kind: 'code', title: 'Solo' });
    await expect(
      verifyContribution(kit.as(owner), { contributionId: standalone.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects with a reason and refuses re-review', async () => {
    const contribution = await recordContribution(kit.as(author), { kind: 'code', title: 'Hack' });
    await expect(
      rejectContribution(kit.as(reviewer), { contributionId: contribution.id, reason: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const rejected = await rejectContribution(kit.as(reviewer), {
      contributionId: contribution.id,
      reason: 'No evidence of authorship.',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      reviewNote: 'No evidence of authorship.',
    });
    await expect(
      verifyContribution(kit.as(reviewer), { contributionId: contribution.id }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: concurrent verifications apply once', async () => {
    const contribution = await recordContribution(kit.as(author), { kind: 'code', title: 'Race' });
    const second = await kit.member({ roles: ['operations'] });
    const results = await Promise.allSettled([
      verifyContribution(kit.as(reviewer), { contributionId: contribution.id }),
      verifyContribution(kit.as(second), { contributionId: contribution.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const proofs = await kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.sourceId, contribution.id));
    expect(proofs).toHaveLength(1);
  });

  it('lists with row-level visibility', async () => {
    const privateProject = await teamProject('private');
    const hidden = await recordContribution(kit.as(author), {
      projectId: privateProject.id,
      kind: 'code',
      title: 'Secret work',
    });
    const open = await recordContribution(kit.as(author), { kind: 'writing', title: 'Essay' });
    const pending = await recordContribution(kit.as(author), { kind: 'writing', title: 'Draft' });
    await verifyContribution(kit.as(reviewer), { contributionId: hidden.id });
    await verifyContribution(kit.as(reviewer), { contributionId: open.id });

    const own = await listContributions(kit.as(author), { memberId: author.memberId! });
    expect(own.total).toBe(3);

    const seenByOutsider = await listContributions(kit.as(outsider), {
      memberId: author.memberId!,
    });
    expect(seenByOutsider.items.map((c) => c.id)).toEqual([open.id]);
    expect(seenByOutsider.items[0]!.reviewNote).toBeNull();

    const seenByOwner = await listContributions(kit.as(owner), { projectId: privateProject.id });
    expect(seenByOwner.items.map((c) => c.id)).toEqual([hidden.id]);

    const queue = await listContributions(kit.as(reviewer), { status: 'submitted' });
    expect(queue.items.map((c) => c.id)).toEqual([pending.id]);

    expect((await listContributions(kit.as(anonymousActor), {})).total).toBe(0);
    await kit.db
      .update(members)
      .set({ profileVisibility: 'public' })
      .where(eq(members.id, author.memberId!));
    expect((await listContributions(kit.as(anonymousActor), {})).items.map((c) => c.id)).toEqual([
      open.id,
    ]);
  });

  it('archived projects stop accepting contributions', async () => {
    const project = await teamProject();
    await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'archived' });
    await expect(
      recordContribution(kit.as(author), { projectId: project.id, kind: 'code', title: 'Late' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('external contributions are idempotent per externalRef and system-only', async () => {
    const project = await teamProject();
    const input = {
      memberId: author.memberId!,
      projectId: project.id,
      kind: 'code' as const,
      title: 'PR #7 — Faster parser',
      url: 'https://github.com/o/r/pull/7',
      externalRef: 'github:pr:o/r#7',
      occurredAt: kit.clock.now(),
      source: 'github' as const,
      verified: true,
    };
    await expect(recordExternalContribution(kit.as(owner), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const first = await recordExternalContribution(kit.system, input);
    const second = await recordExternalContribution(kit.system, input);
    expect(first.created).toBe(true);
    expect(first.contribution).toMatchObject({ status: 'verified', verifiedByUserId: null });
    expect(second).toEqual({ created: false, contribution: null });
    const proofs = await kit.db.select().from(evidence).where(eq(evidence.kind, 'contribution'));
    expect(proofs).toHaveLength(1);
  });
});
