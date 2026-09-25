import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, members, notifications, projectMembers } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import {
  addProjectLink,
  addProjectMember,
  changeProjectMemberRole,
  changeProjectStatus,
  createProject,
  getProject,
  getProjectActivity,
  leaveProject,
  listProjects,
  MAX_PROJECTS_CREATED_PER_DAY,
  recordContribution,
  removeProjectMember,
  transferProjectOwnership,
  unarchiveProject,
  updateProject,
  verifyContribution,
} from './index';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from './testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('projects', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let owner: UserActor;
  let outsider: UserActor;
  let staff: UserActor;

  beforeEach(async () => {
    kit = await createTestKit({ publicUrl: 'https://jave.test' });
    owner = await kit.member({ roles: ['member'], username: 'owner' });
    outsider = await kit.member({ roles: ['member'], username: 'outsider' });
    staff = await kit.member({ roles: ['operations'], username: 'ops' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  const create = (actor: UserActor, title = 'Rocket Engine', extra = {}) =>
    createProject(kit.as(actor), { title, ...extra });

  async function withTeam(visibility: 'public' | 'members' | 'private' = 'members') {
    const project = await create(owner, 'Team Project', { visibility });
    const maintainer = await kit.member({ username: 'maint' });
    const contributor = await kit.member({ username: 'contrib' });
    await addProjectMember(kit.as(owner), {
      projectId: project.id,
      memberId: maintainer.memberId!,
      role: 'maintainer',
    });
    await addProjectMember(kit.as(owner), {
      projectId: project.id,
      memberId: contributor.memberId!,
    });
    return { project, maintainer, contributor };
  }

  describe('creation and slugs', () => {
    it('creates a project owned by the creator with a unique slug', async () => {
      const a = await create(owner, 'Rocket Engine');
      const b = await create(outsider, 'Rocket Engine');
      expect(a.slug).toBe('rocket-engine');
      expect(b.slug).toBe('rocket-engine-2');
      const detail = await getProject(kit.as(owner), { projectId: a.id });
      expect(detail.members).toEqual([expect.objectContaining({ role: 'owner' })]);
      expect(detail.viewer).toMatchObject({ role: 'owner', canEdit: true, canAdmin: true });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.created'));
      expect(events.map((e) => e.subjectMemberId).sort()).toEqual(
        [owner.memberId, outsider.memberId].sort(),
      );
    });

    it('treats dashboard route names as reserved slugs', async () => {
      const project = await create(owner, 'New');
      expect(project.slug).toBe('new-2');
      expect((await getProject(kit.as(owner), { slug: 'NEW-2' })).id).toBe(project.id);
    });

    it('requires a member in good standing', async () => {
      await expect(create(anonymousActor as never)).rejects.toThrow();
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, outsider.memberId!));
      const restricted = await resolveUserActor(kit.system, outsider.userId);
      await expect(create(restricted)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('BREAK: caps project starts per day so create → ship → archive cannot farm', async () => {
      for (let i = 0; i < MAX_PROJECTS_CREATED_PER_DAY; i++) {
        const project = await create(owner, `Throwaway ${i}`);
        await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'archived' });
      }
      const refused = create(owner, 'One more');
      await expect(refused).rejects.toBeInstanceOf(RateLimitedError);
      await expect(refused).rejects.toThrow(`${MAX_PROJECTS_CREATED_PER_DAY} projects per day`);
      // Other members are unaffected; the cap resets after a day.
      await expect(create(outsider, 'Unrelated')).resolves.toMatchObject({ title: 'Unrelated' });
      kit.clock.advance(DAY + 1);
      await expect(create(owner, 'Next day')).resolves.toMatchObject({ title: 'Next day' });
    });

    it('rejects unknown domains and non-http links', async () => {
      await expect(create(owner, 'X project', { domainKey: 'nope' })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        create(owner, 'X project', { websiteUrl: 'javascript:alert(1)' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updates', () => {
    it('lets owners and maintainers edit, but only owners/staff change visibility', async () => {
      const { project, maintainer } = await withTeam();
      await updateProject(kit.as(maintainer), { projectId: project.id, summary: 'Faster.' });
      await expect(
        updateProject(kit.as(maintainer), { projectId: project.id, visibility: 'public' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const updated = await updateProject(kit.as(owner), {
        projectId: project.id,
        visibility: 'public',
      });
      expect(updated.visibility).toBe('public');
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'project.visibility_changed'));
      expect(audit).toHaveLength(1);
      await updateProject(kit.as(staff), { projectId: project.id, title: 'Renamed by staff' });
    });

    it('BREAK: a non-owner member cannot edit a project, and the denial is audited', async () => {
      const { project, contributor } = await withTeam();
      await expect(
        updateProject(kit.as(contributor), { projectId: project.id, title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        updateProject(kit.as(outsider), { projectId: project.id, title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const denials = await kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.targetId, project.id)));
      expect(denials).toHaveLength(2);
      expect((await getProject(kit.as(owner), { projectId: project.id })).title).toBe(
        'Team Project',
      );
    });

    it('BREAK: a quarantined owner loses management rights', async () => {
      const project = await create(owner);
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, owner.memberId!));
      const quarantined = await resolveUserActor(kit.system, owner.userId);
      await expect(
        updateProject(kit.as(quarantined), { projectId: project.id, title: 'Still mine' }),
      ).rejects.toThrow();
    });

    it('BREAK: rejects oversized, control-character and empty updates', async () => {
      const project = await create(owner);
      await expect(
        updateProject(kit.as(owner), { projectId: project.id, title: 'x'.repeat(10_000) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        updateProject(kit.as(owner), { projectId: project.id, title: 'null\u0000byte' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        updateProject(kit.as(owner), { projectId: project.id, title: 'two\nlines' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(updateProject(kit.as(owner), { projectId: project.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('status', () => {
    it('ships once, stamps shippedAt and emits project.shipped per active member', async () => {
      const { project, maintainer, contributor } = await withTeam();
      const leaver = await kit.member();
      await addProjectMember(kit.as(owner), { projectId: project.id, memberId: leaver.memberId! });
      await leaveProject(kit.as(leaver), { projectId: project.id });

      await changeProjectStatus(kit.as(maintainer), { projectId: project.id, status: 'building' });
      kit.clock.advance(60_000);
      const shipped = await changeProjectStatus(kit.as(owner), {
        projectId: project.id,
        status: 'shipped',
      });
      expect(shipped.shippedAt).toEqual(kit.clock.now());
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      expect(events.map((e) => e.subjectMemberId).sort()).toEqual(
        [owner.memberId, maintainer.memberId, contributor.memberId].sort(),
      );

      // A new iteration and a re-ship never re-emit (no achievement farming).
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' });
      const reshipped = await changeProjectStatus(kit.as(owner), {
        projectId: project.id,
        status: 'shipped',
      });
      expect(reshipped.shippedAt).toEqual(shipped.shippedAt);
      const after = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      expect(after).toHaveLength(3);
    });

    it('project.shipped carries the verified-work evidence achievements need', async () => {
      const { project, contributor } = await withTeam();
      const contribution = await recordContribution(kit.as(contributor), {
        projectId: project.id,
        kind: 'code',
        title: 'Parser rewrite',
      });
      await verifyContribution(kit.as(owner), { contributionId: contribution.id });
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' });
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'shipped' });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      const bySubject = new Map(events.map((e) => [e.subjectMemberId, e.payload]));
      expect(bySubject.get(contributor.memberId)).toMatchObject({
        teamSize: 3,
        verifiedContributions: 1,
        memberVerifiedContributions: 1,
      });
      expect(bySubject.get(owner.memberId)).toMatchObject({
        verifiedContributions: 1,
        memberVerifiedContributions: 0,
      });
    });

    it('notifies other members, not the actor', async () => {
      const { project, maintainer } = await withTeam();
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'planning' });
      const rows = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'project.updated'));
      const statusRows = rows.filter((n) => n.title === 'PROJECT UPDATE');
      expect(statusRows).toHaveLength(2);
      expect(statusRows.map((n) => n.recipientUserId)).not.toContain(owner.userId);
      expect(statusRows.map((n) => n.recipientUserId)).toContain(maintainer.userId);
      expect(statusRows[0]!.body).toBe('Team Project — now PLANNING.');
      expect(statusRows[0]!.url).toBe(`https://jave.test/projects/${project.slug}`);
    });

    it('BREAK: refuses invalid transitions', async () => {
      const project = await create(owner);
      await expect(
        changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'shipped' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'idea' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        changeProjectStatus(kit.as(owner), {
          projectId: project.id,
          status: 'launched' as never,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('archives (owner/staff only), freezes edits, and staff restore the previous status', async () => {
      const { project, maintainer } = await withTeam();
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' });
      await expect(
        changeProjectStatus(kit.as(maintainer), { projectId: project.id, status: 'archived' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const archived = await changeProjectStatus(kit.as(owner), {
        projectId: project.id,
        status: 'archived',
      });
      expect(archived.archivedFromStatus).toBe('building');
      await expect(
        updateProject(kit.as(owner), { projectId: project.id, title: 'Edited' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        unarchiveProject(kit.as(owner), { projectId: project.id, reason: 'please' }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const restored = await unarchiveProject(kit.as(staff), {
        projectId: project.id,
        reason: 'Revived by the team',
      });
      expect(restored.status).toBe('building');
      expect(restored.archivedAt).toBeNull();
      const audit = await kit.db.select().from(auditLogs).where(eq(auditLogs.targetId, project.id));
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(['project.archived', 'project.unarchived']),
      );
      await expect(
        unarchiveProject(kit.as(staff), { projectId: project.id, reason: 'again' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('BREAK: concurrent status changes never both apply from the same state', async () => {
      const project = await create(owner);
      for (const status of ['building', 'testing'] as const) {
        await changeProjectStatus(kit.as(owner), { projectId: project.id, status });
      }
      // Both are legal from TESTING, but SHIPPED → ARCHIVED → SHIPPED is not a chain.
      const results = await Promise.allSettled([
        changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'shipped' }),
        changeProjectStatus(kit.as(staff), { projectId: project.id, status: 'archived' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toSatisfy(
            (error) => error instanceof ConflictError || error instanceof InvalidStateError,
          );
        }
      }
      const changes = await kit.db
        .select()
        .from(domainEvents)
        .where(
          and(
            eq(domainEvents.type, 'project.status_changed'),
            eq(domainEvents.aggregateId, project.id),
          ),
        )
        .orderBy(domainEvents.id);
      // Every applied change starts where the previous one ended: no stale writer slipped in.
      const chain = changes.map((e) => e.payload as { from: string; to: string });
      for (const [index, change] of chain.entries()) {
        if (index > 0) expect(change.from).toBe(chain[index - 1]!.to);
      }
      expect(chain).toHaveLength(2 + fulfilled.length);
      const shipped = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      expect(shipped.length).toBeLessThanOrEqual(1);
      const final = await getProject(kit.as(staff), { projectId: project.id });
      expect(final.status).toBe(chain.at(-1)!.to);
    });
  });

  describe('visibility', () => {
    it('BREAK: a private project is invisible (not forbidden) to outsiders — no IDOR', async () => {
      const { project, contributor } = await withTeam('private');
      await expect(getProject(kit.as(outsider), { projectId: project.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getProject(kit.as(outsider), { slug: project.slug })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        getProjectActivity(kit.as(outsider), { projectId: project.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        addProjectLink(kit.as(outsider), {
          projectId: project.id,
          label: 'x',
          url: 'https://x.test',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        changeProjectStatus(kit.as(outsider), { projectId: project.id, status: 'archived' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const listed = await listProjects(kit.as(outsider), {});
      expect(listed.items.map((p) => p.id)).not.toContain(project.id);

      expect((await getProject(kit.as(contributor), { projectId: project.id })).id).toBe(
        project.id,
      );
      expect((await getProject(kit.as(staff), { projectId: project.id })).viewer.isStaff).toBe(
        true,
      );
      expect((await listProjects(kit.as(staff), {})).items.map((p) => p.id)).toContain(project.id);
    });

    it('members-only projects are hidden from anonymous visitors; public ones are not', async () => {
      const membersOnly = await create(owner, 'Members Only');
      const open = await create(owner, 'Open Source', { visibility: 'public' });
      const anonymous = kit.as(anonymousActor);
      await expect(getProject(anonymous, { projectId: membersOnly.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await getProject(anonymous, { projectId: open.id })).title).toBe('Open Source');
      expect((await listProjects(anonymous, {})).items.map((p) => p.slug)).toEqual(['open-source']);
      expect((await listProjects(kit.as(outsider), {})).total).toBe(2);
    });

    it('removed members lose access to private projects', async () => {
      const { project, contributor } = await withTeam('private');
      await removeProjectMember(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
      });
      await expect(
        getProject(kit.as(contributor), { projectId: project.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('hides staff-only profiles from outsiders on public project pages', async () => {
      const { project, contributor } = await withTeam('public');
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, contributor.memberId!));
      const view = await getProject(kit.as(outsider), { projectId: project.id });
      expect(view.members.map((m) => m.memberId)).not.toContain(contributor.memberId);
      expect(view.hiddenMemberCount).toBe(1);
      expect(view.memberCount).toBe(3);
      const insiderView = await getProject(kit.as(owner), { projectId: project.id });
      expect(insiderView.members).toHaveLength(3);
    });

    it('filters, searches and paginates the directory', async () => {
      await create(owner, 'Alpha Rocket', { visibility: 'public' });
      await create(owner, 'Beta Rocket', { visibility: 'public' });
      await create(outsider, 'Gamma Tool', { visibility: 'public' });
      const page = await listProjects(kit.as(outsider), { search: 'rocket', limit: 1 });
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(1);
      const mine = await listProjects(kit.as(outsider), { memberId: outsider.memberId! });
      expect(mine.items.map((p) => p.title)).toEqual(['Gamma Tool']);
      const wildcard = await listProjects(kit.as(outsider), { search: '%' });
      expect(wildcard.total).toBe(0);
      const sorted = await listProjects(kit.as(outsider), { sort: 'title' });
      expect(sorted.items.map((p) => p.title)).toEqual([
        'Alpha Rocket',
        'Beta Rocket',
        'Gamma Tool',
      ]);
      expect(sorted.items[0]!.owner?.handle).toBe('owner');
    });
  });

  describe('membership', () => {
    it('maintainers manage contributors only', async () => {
      const { project, maintainer, contributor } = await withTeam();
      const newcomer = await kit.member();
      await addProjectMember(kit.as(maintainer), {
        projectId: project.id,
        memberId: newcomer.memberId!,
      });
      await expect(
        addProjectMember(kit.as(maintainer), {
          projectId: project.id,
          memberId: (await kit.member()).memberId!,
          role: 'maintainer',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        changeProjectMemberRole(kit.as(maintainer), {
          projectId: project.id,
          memberId: contributor.memberId!,
          role: 'maintainer',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await removeProjectMember(kit.as(maintainer), {
        projectId: project.id,
        memberId: newcomer.memberId!,
      });
      const other = await kit.member();
      await addProjectMember(kit.as(owner), {
        projectId: project.id,
        memberId: other.memberId!,
        role: 'maintainer',
      });
      await expect(
        removeProjectMember(kit.as(maintainer), {
          projectId: project.id,
          memberId: other.memberId!,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('BREAK: owners cannot be removed or demoted, and ownership cannot be granted directly', async () => {
      const { project } = await withTeam();
      await expect(
        removeProjectMember(kit.as(staff), { projectId: project.id, memberId: owner.memberId! }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        changeProjectMemberRole(kit.as(staff), {
          projectId: project.id,
          memberId: owner.memberId!,
          role: 'contributor',
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        addProjectMember(kit.as(owner), {
          projectId: project.id,
          memberId: outsider.memberId!,
          role: 'owner' as never,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(leaveProject(kit.as(owner), { projectId: project.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });

    it('BREAK: refuses duplicate members and banned members', async () => {
      const { project, contributor } = await withTeam();
      await expect(
        addProjectMember(kit.as(owner), {
          projectId: project.id,
          memberId: contributor.memberId!,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, outsider.memberId!));
      await expect(
        addProjectMember(kit.as(owner), { projectId: project.id, memberId: outsider.memberId! }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('transfers ownership; the previous owner stays as maintainer', async () => {
      const { project, maintainer, contributor } = await withTeam();
      await expect(
        transferProjectOwnership(kit.as(owner), {
          projectId: project.id,
          memberId: outsider.memberId!,
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        transferProjectOwnership(kit.as(maintainer), {
          projectId: project.id,
          memberId: contributor.memberId!,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const updated = await transferProjectOwnership(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
      });
      expect(updated.ownerMemberId).toBe(contributor.memberId);
      const detail = await getProject(kit.as(owner), { projectId: project.id });
      expect(detail.members.find((m) => m.memberId === owner.memberId)?.role).toBe('maintainer');
      expect(detail.members[0]).toMatchObject({ memberId: contributor.memberId, role: 'owner' });
      const owners = await kit.db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.role, 'owner')));
      expect(owners).toHaveLength(1);
      // The former owner can now leave.
      await leaveProject(kit.as(owner), { projectId: project.id });
    });

    it('re-adding a former member reactivates the membership', async () => {
      const { project, contributor } = await withTeam();
      await leaveProject(kit.as(contributor), { projectId: project.id });
      await addProjectMember(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
        role: 'maintainer',
      });
      const rows = await kit.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.memberId, contributor.memberId!));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ role: 'maintainer', leftAt: null });
    });

    it('notifies added members', async () => {
      const { contributor } = await withTeam();
      const rows = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, contributor.userId));
      expect(rows.map((n) => n.body)).toContain('Team Project — you were added as CONTRIBUTOR.');
    });
  });
});
