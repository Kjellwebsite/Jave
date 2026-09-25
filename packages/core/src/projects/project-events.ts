import type { ProjectRecord } from './access';

/** Payload fields every project event carries (outbound webhooks skip non-public ones). */
export function projectEventBase(project: Pick<ProjectRecord, 'id' | 'slug' | 'visibility'>) {
  return { projectId: project.id, slug: project.slug, visibility: project.visibility };
}

/**
 * Fields of GitHub activity payloads (project.github_push,
 * project.release_published) that reveal a repository's content: commit
 * headlines and ids, pushers, compare/release links, tags and release names.
 */
export const REPO_CONTENT_FIELDS = [
  'headCommit',
  'headline',
  'pusher',
  'compareUrl',
  'tag',
  'name',
  'url',
] as const;

/** Payload flag set on GitHub activity from a private (or unmarked) repository. */
export const REPO_PRIVATE_FLAG = 'repoPrivate';

/**
 * Content of a private repository is shown only on private projects, whose
 * audience is the team and staff. On public and members-only projects the
 * activity keeps its shape (commit count, prerelease flag) without content.
 */
export function repoContentVisible(
  repoPrivate: boolean,
  projectVisibility: ProjectRecord['visibility'],
): boolean {
  return !repoPrivate || projectVisibility === 'private';
}

/** Null out every repository-content field present in the payload. */
export function redactRepoContent<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = { ...payload };
  for (const field of REPO_CONTENT_FIELDS) {
    if (field in out) out[field] = null;
  }
  return out as T;
}
