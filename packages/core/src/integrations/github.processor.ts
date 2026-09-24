import { z } from 'zod';
import { members } from '@jave/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { ServiceContext } from '../kernel/context';
import { publishEvent } from '../events/bus';
import { getSettings } from '../settings/settings.service';
import { recordExternalContribution } from '../projects/contributions.service';
import { findProjectByGithubRepo, projectEventBase } from '../projects/projects.service';
import { isHttpUrl } from '../projects/schemas';
import { findGithubAccount } from './external-accounts.service';
import { cleanLine, headline } from './payload';
import type { DeliveryProcessor, ProcessingResult } from './processors';

/**
 * GitHub delivery processing. Only facts that prove work become
 * contributions: a pull request merged into a linked repository. Pushes
 * and releases are project activity — never contributions (no farming by
 * commit count).
 */

const MAX_TITLE = 200;
const MAX_HEADLINE = 120;
const MAX_TAG = 100;
const MAX_LOGIN = 64;
const BOT_USER_TYPE = 'Bot';

const githubUser = z.object({
  login: z.string().min(1).max(MAX_LOGIN),
  id: z.number().int().nonnegative(),
  type: z.string().max(32).optional(),
});

const repository = z.object({
  full_name: z.string().min(3).max(200),
  default_branch: z.string().max(255).optional(),
});

const pullRequestEvent = z.object({
  action: z.string().max(64),
  number: z.number().int().positive(),
  pull_request: z.object({
    merged: z.boolean().nullish(),
    merged_at: z.string().max(64).nullish(),
    title: z.string(),
    html_url: z.string().max(2048),
    user: githubUser,
  }),
  repository,
});

const pushEvent = z.object({
  ref: z.string().max(255),
  deleted: z.boolean().optional(),
  forced: z.boolean().optional(),
  commits: z.array(z.unknown()).optional(),
  head_commit: z.object({ id: z.string().max(64), message: z.string() }).nullish(),
  compare: z.string().max(2048).optional(),
  pusher: z.object({ name: z.string().max(MAX_LOGIN) }).optional(),
  repository,
});

const releaseEvent = z.object({
  action: z.string().max(64),
  release: z.object({
    tag_name: z.string().max(255),
    name: z.string().nullish(),
    html_url: z.string().max(2048),
    prerelease: z.boolean().optional(),
  }),
  repository,
});

const ignored = (reason: string): ProcessingResult => ({ status: 'ignored', reason });
const processed = (reason: string): ProcessingResult => ({ status: 'processed', reason });

function safeUrl(value: string | undefined): string | null {
  return value && isHttpUrl(value) ? new URL(value).href : null;
}

/** GitHub's timestamp, unless missing, unparsable or in the future. */
function occurredAt(ctx: ServiceContext, value: string | null | undefined): Date {
  const now = ctx.clock.now();
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) && parsed <= now ? parsed : now;
}

async function processPullRequest(
  ctx: ServiceContext,
  payload: unknown,
): Promise<ProcessingResult> {
  const event = pullRequestEvent.safeParse(payload);
  if (!event.success) return ignored('unrecognized pull_request payload');
  const { action, number, pull_request: pr, repository: repo } = event.data;
  if (action !== 'closed' || pr.merged !== true) return ignored('pull request not merged');
  if (pr.user.type === BOT_USER_TYPE) return ignored('bot author');
  const project = await findProjectByGithubRepo(ctx, repo.full_name);
  if (!project) return ignored('repository not linked to a project');
  if (project.status === 'archived') return ignored('project archived');
  const settings = await getSettings(ctx, 'integrations');
  if (!settings.githubAutoContributions) return ignored('automatic contributions disabled');
  const account = await findGithubAccount(ctx, pr.user);
  if (!account) return ignored('author has no linked JAVE account');
  const [member] = await ctx.db
    .select({ standing: members.standing })
    .from(members)
    .where(and(eq(members.id, account.memberId), isNull(members.deletedAt)));
  if (!member || member.standing === 'banned' || member.standing === 'quarantined') {
    return ignored('author not eligible');
  }

  const repoName = project.githubRepo ?? repo.full_name.toLowerCase();
  const result = await recordExternalContribution(ctx, {
    memberId: account.memberId,
    projectId: project.id,
    kind: 'code',
    title: cleanLine(`PR #${number} — ${pr.title}`, MAX_TITLE),
    url: safeUrl(pr.html_url),
    externalRef: `github:pr:${repoName}#${number}`,
    occurredAt: occurredAt(ctx, pr.merged_at),
    source: 'github',
    // Auto-verify only when staff bound the GitHub user id: a login alone can be re-registered.
    verified: account.verifiedAt !== null && account.externalId === String(pr.user.id),
  });
  return processed(result.created ? 'contribution recorded' : 'contribution already recorded');
}

async function processPush(ctx: ServiceContext, payload: unknown): Promise<ProcessingResult> {
  const event = pushEvent.safeParse(payload);
  if (!event.success) return ignored('unrecognized push payload');
  const push = event.data;
  if (push.deleted) return ignored('branch deleted');
  const defaultBranch = push.repository.default_branch;
  if (!defaultBranch || push.ref !== `refs/heads/${defaultBranch}`) {
    return ignored('not the default branch');
  }
  const project = await findProjectByGithubRepo(ctx, push.repository.full_name);
  if (!project) return ignored('repository not linked to a project');
  await publishEvent(ctx, {
    type: 'project.github_push',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: {
      ...projectEventBase(project),
      repo: project.githubRepo,
      branch: cleanLine(defaultBranch, MAX_TAG),
      commitCount: push.commits?.length ?? 0,
      headCommit: push.head_commit ? cleanLine(push.head_commit.id, 64) : null,
      headline: push.head_commit ? headline(push.head_commit.message, MAX_HEADLINE) : null,
      forced: push.forced ?? false,
      pusher: push.pusher ? cleanLine(push.pusher.name, MAX_LOGIN) : null,
      compareUrl: safeUrl(push.compare),
    },
  });
  return processed('project activity recorded');
}

async function processRelease(ctx: ServiceContext, payload: unknown): Promise<ProcessingResult> {
  const event = releaseEvent.safeParse(payload);
  if (!event.success) return ignored('unrecognized release payload');
  if (event.data.action !== 'published')
    return ignored(`release ${cleanLine(event.data.action, 32)}`);
  const project = await findProjectByGithubRepo(ctx, event.data.repository.full_name);
  if (!project) return ignored('repository not linked to a project');
  const { release } = event.data;
  await publishEvent(ctx, {
    type: 'project.release_published',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: {
      ...projectEventBase(project),
      repo: project.githubRepo,
      tag: cleanLine(release.tag_name, MAX_TAG),
      name: release.name ? cleanLine(release.name, MAX_HEADLINE) : null,
      url: safeUrl(release.html_url),
      prerelease: release.prerelease ?? false,
    },
  });
  return processed('release recorded');
}

export const processGithubDelivery: DeliveryProcessor = async (ctx, delivery) => {
  switch (delivery.eventType) {
    case 'ping':
      return processed('ping acknowledged');
    case 'pull_request':
      return processPullRequest(ctx, delivery.payload);
    case 'push':
      return processPush(ctx, delivery.payload);
    case 'release':
      return processRelease(ctx, delivery.payload);
    default:
      return ignored(`unsupported event ${cleanLine(delivery.eventType, 64)}`);
  }
};
