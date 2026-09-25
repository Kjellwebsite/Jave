import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { auditLogs, domainEvents, members, projectMembers, projects } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  linkGithubAccount,
  setExternalAccountVerification,
} from '../integrations/external-accounts.service';
import {
  addMilestone,
  addProjectLink,
  addProjectMember,
  changeProjectMemberRole,
  changeProjectStatus,
  createProject,
  getProject,
  getProjectActivity,
  leaveProject,
  linkGithubRepo,
  listContributions,
  listMilestones,
  listProjectLinks,
  listProjects,
  recordContribution,
  removeProjectMember,
  transferProjectOwnership,
  verifyContribution,
} from './index';
import { applyStatusChange } from './status-change';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from './testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

type Visibility = 'public' | 'members' | 'private';

describe('projects hardening', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let owner: UserActor;
  let outsider: UserActor;
  let staff: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    owner = await kit.member({ username: 'owner' });
    outsider = await kit.member({ username: 'outsider' });
    staff = await kit.member({ roles: ['operations'], username: 'steward' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  async function withTeam(visibility: Visibility) {
    const project = await createProject(kit.as(owner), { title: 'Team Project', visibility });
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

  const setMember = (memberId: string, patch: Partial<typeof members.$inferInsert>) =>
    kit.db.update(members).set(patch).where(eq(members.id, memberId));

  describe('links and milestones reads', () => {
    it('BREAK: listProjectLinks / listMilestones enforce visibility (no IDOR)', async () => {
      const { project, contributor } = await withTeam('private');
      await addProjectLink(kit.as(owner), {
        projectId: project.id,
        label: 'Secret demo',
        url: 'https://demo.test/secret',
      });
      await addMilestone(kit.as(owner), { projectId: project.id, title: 'Stealth launch' });
      const ref = { projectId: project.id };
      for (const intruder of [kit.as(outsider), kit.as(anonymousActor)]) {
        await expect(listProjectLinks(intruder, ref)).rejects.toBeInstanceOf(NotFoundError);
        await expect(listMilestones(intruder, ref)).rejects.toBeInstanceOf(NotFoundError);
      }
      for (const viewer of [kit.as(contributor), kit.as(staff)]) {
        expect((await listProjectLinks(viewer, ref)).map((l) => l.label)).toEqual(['Secret demo']);
        expect((await listMilestones(viewer, ref)).map((m) => m.title)).toEqual(['Stealth launch']);
      }
    });

    it('members-only content is hidden from anonymous visitors only', async () => {
      const { project } = await withTeam('members');
      await addProjectLink(kit.as(owner), {
        projectId: project.id,
        label: 'Docs',
        url: 'https://docs.test',
      });
      const ref = { projectId: project.id };
      await expect(listProjectLinks(kit.as(anonymousActor), ref)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(await listProjectLinks(kit.as(outsider), ref)).toHaveLength(1);
    });
  });

  describe('GitHub repository control', () => {
    async function verifiedGithub(member: UserActor, username: string, externalId: string) {
      await linkGithubAccount(kit.as(member), { username });
      await setExternalAccountVerification(kit.as(staff), {
        memberId: member.memberId!,
        verified: true,
        externalId,
      });
    }

    it('BREAK: an owner cannot claim a repository they do not control', async () => {
      const project = await createProject(kit.as(owner), { title: 'Hijack', visibility: 'public' });
      await expect(
        linkGithubRepo(kit.as(owner), { projectId: project.id, repo: 'javelin/secret-infra' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // A self-declared (unverified) login is no proof either.
      await linkGithubAccount(kit.as(owner), { username: 'javelin' });
      await expect(
        linkGithubRepo(kit.as(owner), { projectId: project.id, repo: 'javelin/secret-infra' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const denials = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'project.repo_link_denied'));
      expect(denials).toHaveLength(2);
      expect(denials[0]).toMatchObject({ result: 'denied', targetId: project.id });
      const [row] = await kit.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row!.githubRepo).toBeNull();
    });

    it('a verified GitHub account links repositories in its own namespace only', async () => {
      const project = await createProject(kit.as(owner), { title: 'Tool' });
      await verifiedGithub(owner, 'OctoOwner', '5150');
      const linked = await linkGithubRepo(kit.as(owner), {
        projectId: project.id,
        repo: 'octoowner/tool',
      });
      expect(linked.githubRepo).toBe('octoowner/tool');
      await expect(
        linkGithubRepo(kit.as(owner), { projectId: project.id, repo: 'javelin/tool' }),
      ).rejects.toThrow(/octoowner\//);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'project.repo_linked'));
      expect(audit!.context).toMatchObject({ basis: 'verified_owner', to: 'octoowner/tool' });
    });

    it('BREAK: a contributor cannot link, even a repository their verified account owns', async () => {
      const { project, contributor } = await withTeam('public');
      await verifiedGithub(contributor, 'contrib', '6160');
      await expect(
        linkGithubRepo(kit.as(contributor), { projectId: project.id, repo: 'contrib/tool' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('staff link organization repositories; managers may unlink', async () => {
      const project = await createProject(kit.as(owner), { title: 'Org Tool' });
      const linked = await linkGithubRepo(kit.as(staff), {
        projectId: project.id,
        repo: 'javelin/engine',
      });
      expect(linked.githubRepo).toBe('javelin/engine');
      const unlinked = await linkGithubRepo(kit.as(owner), { projectId: project.id, repo: null });
      expect(unlinked.githubRepo).toBeNull();
      const audits = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'project.repo_linked'));
      expect(audits.map((a) => a.context.basis)).toEqual(['staff', null]);
    });
  });

  describe('membership races', () => {
    async function activeOwners(projectId: string) {
      return kit.db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, 'owner'),
            isNull(projectMembers.leftAt),
          ),
        );
    }

    it.each(['transfer first', 'leave first'])(
      'BREAK: leaving while ownership is transferred never strands the project (%s)',
      async (order) => {
        const { project, contributor } = await withTeam('public');
        const transfer = () =>
          transferProjectOwnership(kit.as(owner), {
            projectId: project.id,
            memberId: contributor.memberId!,
          });
        const leave = () => leaveProject(kit.as(contributor), { projectId: project.id });
        const results = await Promise.allSettled(
          order === 'transfer first' ? [transfer(), leave()] : [leave(), transfer()],
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const [row] = await kit.db.select().from(projects).where(eq(projects.id, project.id));
        const owners = await activeOwners(project.id);
        expect(owners).toHaveLength(1);
        expect(owners[0]!.memberId).toBe(row!.ownerMemberId);
      },
    );

    it('BREAK: removal re-reads the role under the project lock', async () => {
      const { project, maintainer, contributor } = await withTeam('public');
      await transferProjectOwnership(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
      });
      await expect(
        removeProjectMember(kit.as(owner), {
          projectId: project.id,
          memberId: contributor.memberId!,
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        leaveProject(kit.as(contributor), { projectId: project.id }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      // A contributor promoted meanwhile is out of a maintainer's reach.
      const other = await kit.member({ username: 'other' });
      await addProjectMember(kit.as(owner), { projectId: project.id, memberId: other.memberId! });
      await changeProjectMemberRole(kit.as(contributor), {
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
      expect(await activeOwners(project.id)).toHaveLength(1);
    });
  });

  describe('status writes', () => {
    it('BREAK: a status write from a stale snapshot is refused', async () => {
      const project = await createProject(kit.as(owner), { title: 'Stale' });
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' });
      const snapshot = await changeProjectStatus(kit.as(owner), {
        projectId: project.id,
        status: 'testing',
      });
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'archived' });
      await expect(applyStatusChange(kit.as(owner), snapshot, 'shipped')).rejects.toBeInstanceOf(
        ConflictError,
      );
      const shipped = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      expect(shipped).toHaveLength(0);
      const [row] = await kit.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row).toMatchObject({ status: 'archived', shippedAt: null });
    });
  });

  describe('member privacy', () => {
    it('BREAK: the activity feed never leaks hidden members', async () => {
      const { project, contributor } = await withTeam('public');
      await setMember(contributor.memberId!, { profileVisibility: 'staff' });
      await changeProjectMemberRole(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
        role: 'maintainer',
      });
      await transferProjectOwnership(kit.as(owner), {
        projectId: project.id,
        memberId: contributor.memberId!,
      });
      // The owner's default 'members' profile is visible to members, not to anonymous visitors.
      const viewers = [
        { ctx: kit.as(anonymousActor), from: null },
        { ctx: kit.as(outsider), from: expect.objectContaining({ handle: 'owner' }) },
      ];
      for (const viewer of viewers) {
        const feed = await getProjectActivity(viewer.ctx, { projectId: project.id, limit: 100 });
        expect(JSON.stringify(feed)).not.toContain(contributor.memberId!);
        const transfer = feed.items.find((i) => i.type === 'project.ownership_transferred');
        expect(transfer).toMatchObject({ people: { from: viewer.from, to: null } });
        expect(transfer!.payload).not.toHaveProperty('to');
        const roleChange = feed.items.find((i) => i.type === 'project.member_role_changed');
        expect(roleChange).toMatchObject({
          people: { memberId: null },
          payload: expect.objectContaining({ from: 'contributor', to: 'maintainer' }),
        });
      }
      const inside = await getProjectActivity(kit.as(owner), { projectId: project.id, limit: 100 });
      const added = inside.items.filter((i) => i.type === 'project.member_added');
      expect(added.map((i) => i.people.memberId?.handle).sort()).toEqual(['contrib', 'maint']);
    });

    it('BREAK: listProjects member filters are no oracle for hidden profiles', async () => {
      const { project, contributor } = await withTeam('public');
      await setMember(contributor.memberId!, { profileVisibility: 'staff' });
      const byMember = { memberId: contributor.memberId! };
      for (const viewer of [kit.as(anonymousActor), kit.as(outsider)]) {
        expect(await listProjects(viewer, byMember)).toMatchObject({ items: [], total: 0 });
      }
      for (const viewer of [kit.as(contributor), kit.as(staff)]) {
        const page = await listProjects(viewer, byMember);
        expect(page.items.map((p) => p.id)).toEqual([project.id]);
      }
      await setMember(owner.memberId!, { profileVisibility: 'staff' });
      const byOwner = await listProjects(kit.as(outsider), { ownerMemberId: owner.memberId! });
      expect(byOwner.total).toBe(0);
      await setMember(owner.memberId!, { profileVisibility: 'members' });
      expect((await listProjects(kit.as(outsider), { ownerMemberId: owner.memberId! })).total).toBe(
        1,
      );
      expect(
        (await listProjects(kit.as(anonymousActor), { ownerMemberId: owner.memberId! })).total,
      ).toBe(0);
    });

    it('BREAK: banned members get no ship credit and are hidden from outsiders', async () => {
      const { project, maintainer, contributor } = await withTeam('public');
      const work = await recordContribution(kit.as(contributor), {
        projectId: project.id,
        kind: 'code',
        title: 'Parser rewrite',
      });
      await verifyContribution(kit.as(owner), { contributionId: work.id });
      await setMember(contributor.memberId!, { standing: 'banned' });
      await setMember(maintainer.memberId!, { standing: 'quarantined' });
      for (const status of ['building', 'shipped'] as const) {
        await changeProjectStatus(kit.as(owner), { projectId: project.id, status });
      }
      const shipped = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.shipped'));
      expect(shipped.map((e) => e.subjectMemberId)).toEqual([owner.memberId]);
      expect(shipped[0]!.payload).toMatchObject({ teamSize: 3, verifiedContributions: 1 });

      const outside = await getProject(kit.as(outsider), { projectId: project.id });
      expect(outside.members.map((m) => m.handle)).not.toContain('contrib');
      expect(outside.hiddenMemberCount).toBe(1);
      const inside = await getProject(kit.as(owner), { projectId: project.id });
      expect(inside.members.map((m) => m.handle)).toContain('contrib');
      const visible = await listContributions(kit.as(outsider), { projectId: project.id });
      expect(visible.total).toBe(0);
      expect((await listContributions(kit.as(owner), { projectId: project.id })).total).toBe(1);

      await setMember(owner.memberId!, { standing: 'banned' });
      const directory = await listProjects(kit.as(outsider), {});
      expect(directory.items.find((p) => p.id === project.id)!.owner).toBeNull();
    });
  });
});
