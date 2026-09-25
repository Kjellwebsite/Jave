import type { TestKit } from '../../testing';
import { anonymousActor } from '../../permissions/actor';
import { receiveWebhook } from '../inbound.service';
import { signGithub } from '../signatures';

/**
 * Test-only GitHub webhook helpers (MOCK / DEVELOPMENT ONLY): a fixed
 * deployment secret, a signed-delivery sender and payload builders.
 */

export const TEST_GITHUB_SECRET = 'github-webhook-secret-for-tests';

export interface GithubSendOptions {
  delivery?: string;
  secret?: string;
  slug?: string;
}

/** Sends GitHub-signed deliveries to an integration slug as an anonymous caller. */
export function githubSender(kit: TestKit) {
  let counter = 0;
  return (event: string, payload: unknown, options: GithubSendOptions = {}) => {
    const rawBody = JSON.stringify(payload);
    counter++;
    return receiveWebhook(kit.as(anonymousActor), {
      slug: options.slug ?? 'github',
      rawBody,
      headers: {
        'X-Hub-Signature-256': signGithub(options.secret ?? TEST_GITHUB_SECRET, rawBody),
        'x-github-delivery': options.delivery ?? `guid-${counter}`,
        'x-github-event': event,
      },
      secrets: { github: TEST_GITHUB_SECRET },
    });
  };
}

export const GITHUB_AUTHOR = { login: 'octodev', id: 4242, type: 'User' } as const;
export const GITHUB_REVIEWER = { login: 'reviewer', id: 7777, type: 'User' } as const;

/** A merged pull request on javelin/engine by GITHUB_AUTHOR, merged by GITHUB_REVIEWER. */
export function mergedPr(number: number, overrides: Record<string, unknown> = {}) {
  return {
    action: 'closed',
    number,
    pull_request: {
      merged: true,
      merged_at: '2026-02-28T10:00:00Z',
      title: `Faster parser\u0000 @everyone`,
      html_url: `https://github.com/Javelin/Engine/pull/${number}`,
      user: GITHUB_AUTHOR,
      merged_by: GITHUB_REVIEWER,
    },
    repository: { full_name: 'Javelin/Engine', default_branch: 'main', private: false },
    ...overrides,
  };
}

/** A push of 50 commits to javelin/engine's default branch. */
export function pushEvent(overrides: Record<string, unknown> = {}) {
  return {
    ref: 'refs/heads/main',
    commits: Array.from({ length: 50 }, (_, i) => ({ id: String(i) })),
    head_commit: { id: 'abc123', message: 'feat: ship it\n\nbody' },
    pusher: { name: 'octodev' },
    compare: 'https://github.com/javelin/engine/compare/a...b',
    repository: { full_name: 'javelin/engine', default_branch: 'main', private: false },
    ...overrides,
  };
}

/** A published release on javelin/engine. */
export function releaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    action: 'published',
    release: {
      tag_name: 'v1.0.0',
      name: 'One',
      html_url: 'https://github.com/javelin/engine/releases/v1.0.0',
    },
    repository: { full_name: 'javelin/engine', private: false },
    ...overrides,
  };
}
