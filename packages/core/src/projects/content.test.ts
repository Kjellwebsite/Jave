import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  addMilestone,
  addProjectLink,
  addProjectMember,
  changeProjectStatus,
  completeMilestone,
  createProject,
  getProject,
  getProjectActivity,
  linkGithubRepo,
  MAX_PROJECT_LINKS,
  removeMilestone,
  removeProjectLink,
  reorderMilestones,
  unarchiveProject,
  updateMilestone,
  updateProjectLink,
} from './index';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from './testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('project content, repository link and activity', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let owner: UserActor;
  let outsider: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    owner = await kit.member({ username: 'owner' });
    outsider = await kit.member({ username: 'outsider' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  const create = (actor: UserActor, title = 'Rocket Engine', extra = {}) =>
    createProject(kit.as(actor), { title, ...extra });

  async function withTeam(visibility: 'public' | 'members' | 'private' = 'members') {
    const project = await create(owner, 'Team Project', { visibility });
    const contributor = await kit.member({ username: 'contrib' });
    await addProjectMember(kit.as(owner), {
      projectId: project.id,
      memberId: contributor.memberId!,
    });
    return { project, contributor };
  }

  /** The `change` markers of project.updated events in the project's feed. */
  async function changesInFeed(projectId: string): Promise<unknown[]> {
    const feed = await getProjectActivity(kit.as(owner), { projectId, limit: 100 });
    return feed.items
      .filter((item) => item.type === 'project.updated')
      .map((i) => i.payload.change);
  }

  describe('links and milestones', () => {
    it('manages links with http(s) only and a hard cap', async () => {
      const project = await create(owner);
      const link = await addProjectLink(kit.as(owner), {
        projectId: project.id,
        label: 'Demo',
        url: 'https://demo.test',
      });
      await updateProjectLink(kit.as(owner), {
        projectId: project.id,
        linkId: link.id,
        label: 'Live demo',
      });
      for (const url of ['javascript:alert(1)', 'ftp://x.test', 'https://u:p@x.test']) {
        await expect(
          addProjectLink(kit.as(owner), { projectId: project.id, label: 'Bad', url }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
      for (let i = 1; i < MAX_PROJECT_LINKS; i++) {
        await addProjectLink(kit.as(owner), {
          projectId: project.id,
          label: `L${i}`,
          url: `https://x.test/${i}`,
        });
      }
      await expect(
        addProjectLink(kit.as(owner), {
          projectId: project.id,
          label: 'One more',
          url: 'https://x.test',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      const detail = await getProject(kit.as(owner), { projectId: project.id });
      expect(detail.links[0]).toMatchObject({ label: 'Live demo', ordinal: 0 });
      await removeProjectLink(kit.as(owner), { projectId: project.id, linkId: link.id });
      expect((await getProject(kit.as(owner), { projectId: project.id })).links).toHaveLength(
        MAX_PROJECT_LINKS - 1,
      );
      expect(await changesInFeed(project.id)).toEqual(
        expect.arrayContaining(['link_added', 'link_updated', 'link_removed']),
      );
    });

    it('BREAK: a link or milestone cannot be addressed through another project (IDOR)', async () => {
      const mine = await create(owner, 'Mine');
      const theirs = await create(outsider, 'Theirs');
      const link = await addProjectLink(kit.as(outsider), {
        projectId: theirs.id,
        label: 'Theirs',
        url: 'https://theirs.test',
      });
      const milestone = await addMilestone(kit.as(outsider), {
        projectId: theirs.id,
        title: 'Theirs',
      });
      await expect(
        removeProjectLink(kit.as(owner), { projectId: mine.id, linkId: link.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        completeMilestone(kit.as(owner), { projectId: mine.id, milestoneId: milestone.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        removeMilestone(kit.as(owner), { projectId: mine.id, milestoneId: milestone.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('orders, completes and reopens milestones', async () => {
      const project = await create(owner);
      const a = await addMilestone(kit.as(owner), { projectId: project.id, title: 'Prototype' });
      const b = await addMilestone(kit.as(owner), {
        projectId: project.id,
        title: 'Beta',
        dueAt: '2026-06-01T00:00:00Z',
      });
      await reorderMilestones(kit.as(owner), {
        projectId: project.id,
        milestoneIds: [b.id, a.id],
      });
      await expect(
        reorderMilestones(kit.as(owner), { projectId: project.id, milestoneIds: [a.id] }),
      ).rejects.toBeInstanceOf(ValidationError);
      const done = await completeMilestone(kit.as(owner), {
        projectId: project.id,
        milestoneId: a.id,
      });
      expect(done.completedAt).toEqual(kit.clock.now());
      await expect(
        completeMilestone(kit.as(owner), { projectId: project.id, milestoneId: a.id }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      const reopened = await updateMilestone(kit.as(owner), {
        projectId: project.id,
        milestoneId: a.id,
        status: 'active',
      });
      expect(reopened.completedAt).toBeNull();
      const detail = await getProject(kit.as(owner), { projectId: project.id });
      expect(detail.milestones.map((m) => m.title)).toEqual(['Beta', 'Prototype']);
      expect(await changesInFeed(project.id)).toEqual(
        expect.arrayContaining(['milestone_added', 'milestone_updated']),
      );
      await expect(
        addMilestone(kit.as(owner), { projectId: project.id, title: 'X', dueAt: '1970-01-01' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('GitHub repository link', () => {
    it('normalizes, enforces uniqueness and audits', async () => {
      const staff = await kit.member({ roles: ['operations'], username: 'steward' });
      const a = await create(owner, 'Alpha');
      const b = await create(outsider, 'Beta');
      const linked = await linkGithubRepo(kit.as(staff), {
        projectId: a.id,
        repo: 'https://github.com/Javelin/Engine.git',
      });
      expect(linked.githubRepo).toBe('javelin/engine');
      expect(linked.repoUrl).toBe('https://github.com/javelin/engine');
      await expect(
        linkGithubRepo(kit.as(staff), { projectId: b.id, repo: 'javelin/ENGINE' }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        linkGithubRepo(kit.as(outsider), { projectId: b.id, repo: '../../etc/passwd' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await linkGithubRepo(kit.as(owner), { projectId: a.id, repo: null });
      await linkGithubRepo(kit.as(staff), { projectId: b.id, repo: 'javelin/engine' });
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'project.repo_linked'));
      expect(audit).toHaveLength(3);
    });
  });

  describe('activity feed', () => {
    it('lists project events newest first without per-member ship duplicates', async () => {
      const { project } = await withTeam('public');
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'building' });
      await changeProjectStatus(kit.as(owner), { projectId: project.id, status: 'shipped' });
      const feed = await getProjectActivity(kit.as(outsider), { projectId: project.id });
      expect(feed.items[0]).toMatchObject({
        type: 'project.status_changed',
        payload: expect.objectContaining({ to: 'shipped' }),
        actor: expect.objectContaining({ handle: 'owner' }),
      });
      expect(feed.items.map((i) => i.type)).not.toContain('project.shipped');
      expect(feed.items.at(-1)!.type).toBe('project.created');
      expect(feed.total).toBe(feed.items.length);
    });

    it('requires authentication for members-only feeds', async () => {
      const project = await create(owner);
      await expect(
        getProjectActivity(kit.as(anonymousActor), { projectId: project.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        addProjectLink(kit.as(anonymousActor), {
          projectId: project.id,
          label: 'x',
          url: 'https://x.test',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        unarchiveProject(kit.as(anonymousActor), { projectId: project.id, reason: 'xyz' }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
