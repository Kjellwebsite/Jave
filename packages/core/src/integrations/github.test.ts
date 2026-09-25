import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  contributions,
  domainEvents,
  evidence,
  externalAccounts,
  webhookDeliveries,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ValidationError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createProject, getProjectActivity, linkGithubRepo, updateProject } from '../projects';
import {
  getExternalAccounts,
  linkGithubAccount,
  setExternalAccountVerification,
} from './external-accounts.service';
import { mergedByAnotherPerson } from './github.processor';
import { createIntegrationJobHandlers } from './handlers';
import { createIntegration } from './registry.service';
import { testEncryptionKey } from './testing/fakes';
import {
  GITHUB_AUTHOR,
  GITHUB_REVIEWER,
  githubSender,
  mergedPr,
  pushEvent,
  releaseEvent,
} from './testing/github';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from '../projects/testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

type Visibility = 'public' | 'members' | 'private';

describe('mergedByAnotherPerson', () => {
  const bot = { login: 'merge-bot', id: 555, type: 'Bot' };
  it.each([
    ['another person', GITHUB_REVIEWER, true],
    ['the author', GITHUB_AUTHOR, false],
    ['the author under another login', { ...GITHUB_AUTHOR, login: 'renamed' }, false],
    ['a bot', bot, false],
    ['nobody (null)', null, false],
    ['nobody (missing)', undefined, false],
  ])('merged by %s → %s', (_label, mergedBy, expected) => {
    expect(mergedByAnotherPerson(GITHUB_AUTHOR, mergedBy)).toBe(expected);
  });
});

describe('GitHub delivery processing', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let admin: UserActor;
  let dev: UserActor;
  let github: ReturnType<typeof githubSender>;
  const handlers = createIntegrationJobHandlers();

  beforeEach(async () => {
    kit = await createTestKit({ encryptionKey: testEncryptionKey() });
    admin = await kit.member({ roles: ['core'], username: 'admin' });
    dev = await kit.member({ username: 'octodev' });
    await createIntegration(kit.as(admin), { provider: 'github', name: 'GitHub', slug: 'github' });
    github = githubSender(kit);
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  /** Dev's project; staff link the organization repository javelin/engine. */
  async function linkedProject(visibility: Visibility = 'public') {
    const project = await createProject(kit.as(dev), { title: 'Engine', visibility });
    await linkGithubRepo(kit.as(admin), { projectId: project.id, repo: 'javelin/engine' });
    await linkGithubAccount(kit.as(dev), { username: 'OctoDev' });
    return project;
  }

  const verifyDev = () =>
    setExternalAccountVerification(kit.as(admin), {
      memberId: dev.memberId!,
      verified: true,
      externalId: String(GITHUB_AUTHOR.id),
    });

  async function eventPayload(type: 'project.github_push' | 'project.release_published') {
    const [event] = await kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));
    return event!.payload;
  }

  describe('pull requests', () => {
    it('merged PR on a linked repo → submitted contribution, idempotent across redelivery', async () => {
      const project = await linkedProject();
      await github('pull_request', mergedPr(12));
      // Same PR delivered again under a different GUID (e.g. a second hook): same externalRef.
      await github('pull_request', { ...mergedPr(12), sender: { login: 'someone' } });
      await kit.drain(handlers);
      const rows = await kit.db.select().from(contributions);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        memberId: dev.memberId,
        projectId: project.id,
        kind: 'code',
        source: 'github',
        status: 'submitted',
        externalRef: 'github:pr:javelin/engine#12',
        url: 'https://github.com/Javelin/Engine/pull/12',
      });
      expect(rows[0]!.title).toBe('PR #12 — Faster parser @everyone');
      expect(rows[0]!.occurredAt).toEqual(new Date('2026-02-28T10:00:00Z'));
      const statuses = (await kit.db.select().from(webhookDeliveries)).map((d) => d.statusReason);
      expect(statuses.sort()).toEqual(['contribution already recorded', 'contribution recorded']);
    });

    it('a verified author whose PR someone else merged gets a verified contribution', async () => {
      await linkedProject();
      await verifyDev();
      await github('pull_request', mergedPr(3));
      await kit.drain(handlers);
      const [row] = await kit.db.select().from(contributions);
      expect(row).toMatchObject({ status: 'verified', verifiedByUserId: null });
      const verified = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'contribution.verified'));
      expect(verified[0]!.payload).toMatchObject({
        automatic: true,
        verifiedBy: 'github',
        visibility: 'public',
      });
      expect(await kit.db.select().from(evidence)).toHaveLength(1);
    });

    it.each([
      ['self-merged', GITHUB_AUTHOR],
      ['merged by a bot', { login: 'merge-bot', id: 555, type: 'Bot' }],
      ['merger unknown', null],
    ])(
      'BREAK: a verified author’s PR %s stays submitted, with no evidence',
      async (_label, mergedBy) => {
        await linkedProject();
        await verifyDev();
        const pr = mergedPr(21);
        await github('pull_request', {
          ...pr,
          pull_request: { ...pr.pull_request, merged_by: mergedBy },
        });
        await kit.drain(handlers);
        const [row] = await kit.db.select().from(contributions);
        expect(row).toMatchObject({ status: 'submitted', verifiedAt: null });
        expect(await kit.db.select().from(evidence)).toHaveLength(0);
      },
    );

    it('BREAK: verification requires a bound GitHub id, and an unbound one never auto-verifies', async () => {
      await linkedProject();
      await expect(
        setExternalAccountVerification(kit.as(admin), { memberId: dev.memberId!, verified: true }),
      ).rejects.toBeInstanceOf(ValidationError);
      const [view] = await getExternalAccounts(kit.as(dev), { memberId: dev.memberId! });
      expect(view).toMatchObject({ verified: false, externalId: null });

      // Defense in depth: a verified row without an id (legacy data) still never auto-verifies.
      await kit.db
        .update(externalAccounts)
        .set({ verifiedAt: kit.clock.now() })
        .where(eq(externalAccounts.memberId, dev.memberId!));
      await github('pull_request', mergedPr(8));
      await kit.drain(handlers);
      const [row] = await kit.db.select().from(contributions);
      expect(row).toMatchObject({ status: 'submitted', memberId: dev.memberId });
    });

    it('re-verifying an account keeps its bound id', async () => {
      await linkedProject();
      await verifyDev();
      await setExternalAccountVerification(kit.as(admin), {
        memberId: dev.memberId!,
        verified: false,
      });
      const again = await setExternalAccountVerification(kit.as(admin), {
        memberId: dev.memberId!,
        verified: true,
      });
      expect(again).toMatchObject({ verified: true, externalId: String(GITHUB_AUTHOR.id) });
    });

    it.each([
      [
        'unmerged PR',
        mergedPr(1, {
          action: 'closed',
          pull_request: { ...mergedPr(1).pull_request, merged: false },
        }),
        'pull request not merged',
      ],
      [
        'unlinked repo',
        mergedPr(2, { repository: { full_name: 'other/repo' } }),
        'repository not linked to a project',
      ],
      [
        'unknown author',
        mergedPr(3, {
          pull_request: { ...mergedPr(3).pull_request, user: { login: 'stranger', id: 1 } },
        }),
        'author has no linked JAVE account',
      ],
      [
        'bot author',
        mergedPr(4, {
          pull_request: {
            ...mergedPr(4).pull_request,
            user: { login: 'octodev', id: 4242, type: 'Bot' },
          },
        }),
        'bot author',
      ],
      ['garbage payload', { action: 'closed', number: 'x' }, 'unrecognized pull_request payload'],
    ])('ignores %s', async (_label, payload, reason) => {
      await linkedProject();
      await github('pull_request', payload);
      await kit.drain(handlers);
      const [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery).toMatchObject({ status: 'ignored', statusReason: reason });
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });

    it('respects the githubAutoContributions setting', async () => {
      await linkedProject();
      await updateSettings(kit.system, 'integrations', { githubAutoContributions: false });
      await github('pull_request', mergedPr(5));
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });

    it('BREAK: a renamed-and-reclaimed login does not inherit a bound identity', async () => {
      await linkedProject();
      await verifyDev();
      // Same login, different GitHub user id (the name was re-registered by someone else).
      await github(
        'pull_request',
        mergedPr(6, {
          pull_request: { ...mergedPr(6).pull_request, user: { login: 'octodev', id: 9999 } },
        }),
      );
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });
  });

  describe('pushes and releases', () => {
    it('BREAK: a push to the default branch is activity, never a contribution', async () => {
      const project = await linkedProject();
      await github('push', pushEvent());
      await github('push', pushEvent({ ref: 'refs/heads/feature' }));
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.github_push'));
      expect(event).toMatchObject({ aggregateId: project.id, subjectMemberId: null });
      expect(event!.payload).toMatchObject({
        commitCount: 50,
        headline: 'feat: ship it',
        pusher: 'octodev',
        repoPrivate: false,
      });
      const reasons = (await kit.db.select().from(webhookDeliveries)).map((d) => d.statusReason);
      expect(reasons).toContain('not the default branch');
    });

    it('records published releases as project activity', async () => {
      await linkedProject();
      await github('release', releaseEvent());
      await kit.drain(handlers);
      expect(await eventPayload('project.release_published')).toMatchObject({
        tag: 'v1.0.0',
        visibility: 'public',
        repoPrivate: false,
      });
    });

    it.each([
      ['private', { full_name: 'javelin/engine', default_branch: 'main', private: true }],
      ['unmarked', { full_name: 'javelin/engine', default_branch: 'main' }],
    ])(
      'BREAK: %s repository content never reaches a public project',
      async (_label, repository) => {
        const project = await linkedProject('public');
        await github('push', pushEvent({ repository }));
        await github('release', releaseEvent({ repository }));
        await kit.drain(handlers);
        expect(await eventPayload('project.github_push')).toMatchObject({
          repoPrivate: true,
          commitCount: 50,
          headCommit: null,
          headline: null,
          pusher: null,
          compareUrl: null,
        });
        expect(await eventPayload('project.release_published')).toMatchObject({
          repoPrivate: true,
          tag: null,
          name: null,
          url: null,
        });
        const feed = await getProjectActivity(kit.as(anonymousActor), { projectId: project.id });
        const text = JSON.stringify(feed);
        for (const secret of ['feat: ship it', 'abc123', 'v1.0.0', 'compare/a...b']) {
          expect(text).not.toContain(secret);
        }
      },
    );

    it('BREAK: private repository details stay with a private project, even after it goes public', async () => {
      const project = await linkedProject('private');
      const repository = { full_name: 'javelin/engine', default_branch: 'main', private: true };
      await github('push', pushEvent({ repository }));
      await kit.drain(handlers);
      const inside = await getProjectActivity(kit.as(dev), { projectId: project.id });
      const push = () => inside.items.find((i) => i.type === 'project.github_push')!;
      expect(push().payload).toMatchObject({ headline: 'feat: ship it', pusher: 'octodev' });

      await updateProject(kit.as(dev), { projectId: project.id, visibility: 'public' });
      for (const viewer of [kit.as(anonymousActor), kit.as(dev)]) {
        const feed = await getProjectActivity(viewer, { projectId: project.id });
        const item = feed.items.find((i) => i.type === 'project.github_push')!;
        expect(item.payload).toMatchObject({ repoPrivate: true, headline: null, pusher: null });
        expect(JSON.stringify(feed)).not.toContain('feat: ship it');
      }
    });
  });
});
