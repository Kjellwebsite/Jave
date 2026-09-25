import { and, count, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { capabilityDomains, externalAccounts, projectMembers, projects } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { DAY } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isUniqueViolation,
  RateLimitedError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { authorize, can } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import {
  loadManageableProject,
  loadVisibleProject,
  type ProjectAccess,
  type ProjectRecord,
  requireActiveMember,
  requireAdmin,
  requireManage,
} from './access';
import { projectEventBase } from './project-events';
import { notifyProjectMembers } from './recipients';
import { httpUrl, plainText, singleLine } from './schemas';
import { availableSlug, randomSlug, slugify } from './slug';
import {
  assertTransition,
  PROJECT_STATUSES,
  type ProjectStatus,
  restoredStatus,
  STATUS_LABELS,
} from './status';
import { applyStatusChange } from './status-change';

export { projectEventBase } from './project-events';

/** Anti-spam ceiling on non-archived projects a member can own at once. */
export const MAX_ACTIVE_OWNED_PROJECTS = 20;

/**
 * Anti-farming ceiling on projects a member can start per day, archived ones
 * included: create → ship → archive loops cannot be run at scale.
 */
export const MAX_PROJECTS_CREATED_PER_DAY = 5;
const PROJECT_CREATION_WINDOW_SECONDS = DAY / 1000;

const visibilitySchema = z.enum(['public', 'members', 'private']);
const emptyToNull = (value: string | null | undefined) => (value === '' ? null : value);

export const createProjectSchema = z.object({
  title: singleLine(120, 2),
  summary: singleLine(280, 0).optional().transform(emptyToNull),
  description: plainText(10_000).optional().transform(emptyToNull),
  goals: plainText(4000).optional().transform(emptyToNull),
  domainKey: z.string().max(32).optional(),
  visibility: visibilitySchema.default('members'),
  repoUrl: httpUrl.optional(),
  websiteUrl: httpUrl.optional(),
});

export const updateProjectSchema = z
  .object({
    projectId: z.uuid(),
    title: singleLine(120, 2).optional(),
    summary: singleLine(280, 0).nullable().optional().transform(emptyToNull),
    description: plainText(10_000).nullable().optional().transform(emptyToNull),
    goals: plainText(4000).nullable().optional().transform(emptyToNull),
    domainKey: z.string().max(32).nullable().optional(),
    visibility: visibilitySchema.optional(),
    repoUrl: httpUrl.nullable().optional(),
    websiteUrl: httpUrl.nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'projectId'), 'Nothing to update.');

export const changeProjectStatusSchema = z.object({
  projectId: z.uuid(),
  status: z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]),
});

export const unarchiveProjectSchema = z.object({
  projectId: z.uuid(),
  reason: singleLine(500, 3),
});

/** GitHub owner (≤39, no leading hyphen) / repository name (≤100). Stored lowercase. */
export const GITHUB_REPO_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/;
const GITHUB_URL_PREFIX = /^https?:\/\/(www\.)?github\.com\//i;

/** Normalize "owner/name", "https://github.com/owner/name(.git)" → "owner/name". */
export function normalizeGithubRepo(value: string): string {
  return value
    .trim()
    .replace(GITHUB_URL_PREFIX, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

export function isValidGithubRepo(value: string): boolean {
  if (!GITHUB_REPO_PATTERN.test(value)) return false;
  const name = value.split('/')[1];
  return name !== '.' && name !== '..';
}

export const linkGithubRepoSchema = z.object({
  projectId: z.uuid(),
  /** Null unlinks. */
  repo: z
    .string()
    .max(200)
    .transform(normalizeGithubRepo)
    .refine(isValidGithubRepo, 'must look like owner/name')
    .nullable(),
});

async function assertDomainExists(ctx: ServiceContext, domainKey: string): Promise<void> {
  const [row] = await ctx.db
    .select({ key: capabilityDomains.key })
    .from(capabilityDomains)
    .where(eq(capabilityDomains.key, domainKey));
  if (!row) throw new ValidationError('Unknown domain.');
}

async function consumeProjectCreation(ctx: ServiceContext, memberId: string): Promise<void> {
  try {
    await consumeRateLimit(
      ctx,
      `project-create:${memberId}`,
      MAX_PROJECTS_CREATED_PER_DAY,
      PROJECT_CREATION_WINDOW_SECONDS,
    );
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    throw new RateLimitedError(
      error.retryAfterSeconds,
      `You can start ${MAX_PROJECTS_CREATED_PER_DAY} projects per day. Try again later.`,
    );
  }
}

/** A member starts a project and becomes its owner. The slug is derived from the title. */
export async function createProject(
  ctx: ServiceContext,
  input: z.input<typeof createProjectSchema>,
): Promise<ProjectRecord> {
  const actor = requireActiveMember(ctx);
  const data = parseInput(createProjectSchema, input);
  if (data.domainKey) await assertDomainExists(ctx, data.domainKey);

  const [owned] = await ctx.db
    .select({ value: count() })
    .from(projects)
    .where(
      and(
        eq(projects.ownerMemberId, actor.memberId),
        ne(projects.status, 'archived'),
        isNull(projects.deletedAt),
      ),
    );
  if ((owned?.value ?? 0) >= MAX_ACTIVE_OWNED_PROJECTS) {
    throw new ConflictError(
      `You already own ${MAX_ACTIVE_OWNED_PROJECTS} active projects. Ship or archive one first.`,
    );
  }
  await consumeProjectCreation(ctx, actor.memberId);

  return withTransaction(ctx, async (t) => {
    const base = slugify(data.title);
    const values = {
      title: data.title,
      summary: data.summary ?? null,
      description: data.description ?? null,
      goals: data.goals ?? null,
      domainKey: data.domainKey ?? null,
      visibility: data.visibility,
      repoUrl: data.repoUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      ownerMemberId: actor.memberId,
      createdAt: t.clock.now(),
      updatedAt: t.clock.now(),
    };
    const insert = (slug: string) =>
      withTransaction(t, async (s) => {
        const [row] = await s.db
          .insert(projects)
          .values({ ...values, slug })
          .returning();
        return row!;
      });
    let project: ProjectRecord;
    try {
      project = await insert(await availableSlug(t.db, base));
    } catch (error) {
      if (!isUniqueViolation(error, 'projects_slug_uq')) throw error;
      project = await insert(randomSlug(base));
    }
    await t.db.insert(projectMembers).values({
      projectId: project.id,
      memberId: actor.memberId,
      role: 'owner',
      joinedAt: t.clock.now(),
    });
    await publishEvent(t, {
      type: 'project.created',
      aggregateType: 'project',
      aggregateId: project.id,
      subjectMemberId: actor.memberId,
      payload: { ...projectEventBase(project), status: project.status },
    });
    return project;
  });
}

/** Edit project details. Visibility changes are owner/staff only and audited. */
export async function updateProject(
  ctx: ServiceContext,
  input: z.input<typeof updateProjectSchema>,
): Promise<ProjectRecord> {
  const data = parseInput(updateProjectSchema, input);
  const access = await loadManageableProject(ctx, data.projectId);
  const { project } = access;
  const visibilityChanged = data.visibility !== undefined && data.visibility !== project.visibility;
  if (visibilityChanged) await requireAdmin(ctx, access);
  if (data.domainKey) await assertDomainExists(ctx, data.domainKey);

  const patch: Partial<typeof projects.$inferInsert> = {};
  const fields = [
    'title',
    'summary',
    'description',
    'goals',
    'domainKey',
    'visibility',
    'repoUrl',
    'websiteUrl',
  ] as const;
  for (const field of fields) {
    const value = data[field];
    if (value !== undefined && value !== project[field]) {
      Object.assign(patch, { [field]: value });
    }
  }
  const changed = Object.keys(patch);
  if (changed.length === 0) return project;

  return withTransaction(ctx, async (t) => {
    const [updated] = await t.db
      .update(projects)
      .set({ ...patch, updatedAt: t.clock.now() })
      .where(eq(projects.id, project.id))
      .returning();
    if (visibilityChanged) {
      await recordAudit(t, {
        action: 'project.visibility_changed',
        targetType: 'project',
        targetId: project.id,
        context: { from: project.visibility, to: data.visibility },
      });
    }
    await publishEvent(t, {
      type: 'project.updated',
      aggregateType: 'project',
      aggregateId: project.id,
      payload: { ...projectEventBase(updated!), change: 'details', fields: changed },
    });
    return updated!;
  });
}

/**
 * Move a project through its lifecycle (see status.ts). Archiving is
 * owner/staff only. The first ship stamps shippedAt and emits one
 * project.shipped per credited member so achievements count per person.
 */
export async function changeProjectStatus(
  ctx: ServiceContext,
  input: z.input<typeof changeProjectStatusSchema>,
): Promise<ProjectRecord> {
  const data = parseInput(changeProjectStatusSchema, input);
  const access = await loadVisibleProject(ctx, data.projectId);
  if (data.status === 'archived') await requireAdmin(ctx, access);
  else await requireManage(ctx, access);
  assertTransition(access.project.status, data.status);
  return applyStatusChange(ctx, access.project, data.status);
}

/**
 * Staff restore an archived project to the status it was archived from
 * (IDEA when unknown). Audited with the reason.
 */
export async function unarchiveProject(
  ctx: ServiceContext,
  input: z.input<typeof unarchiveProjectSchema>,
): Promise<ProjectRecord> {
  const data = parseInput(unarchiveProjectSchema, input);
  await authorize(ctx, 'canManageProjects', { type: 'project', id: data.projectId });
  const { project } = await loadVisibleProject(ctx, data.projectId);
  if (project.status !== 'archived') throw new InvalidStateError('This project is not archived.');
  const to = restoredStatus(project.archivedFromStatus);

  return withTransaction(ctx, async (t) => {
    const [updated] = await t.db
      .update(projects)
      .set({ status: to, archivedAt: null, archivedFromStatus: null, updatedAt: t.clock.now() })
      .where(and(eq(projects.id, project.id), eq(projects.status, 'archived')))
      .returning();
    if (!updated) throw new ConflictError('The project changed in the meantime.');
    await recordAudit(t, {
      action: 'project.unarchived',
      targetType: 'project',
      targetId: project.id,
      context: { restoredTo: to, reason: data.reason },
    });
    const eventId = await publishEvent(t, {
      type: 'project.status_changed',
      aggregateType: 'project',
      aggregateId: project.id,
      payload: { ...projectEventBase(updated), from: 'archived', to, unarchived: true },
    });
    await notifyProjectMembers(t, updated, {
      title: 'PROJECT RESTORED',
      body: `${updated.title} — restored to ${STATUS_LABELS[to]}.`,
      dedupeKey: `project:${project.id}:status:${eventId}`,
    });
    return updated;
  });
}

/** Login of the member's staff-verified, id-bound GitHub account (lowercase), if any. */
async function verifiedGithubLogin(ctx: ServiceContext, memberId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ username: externalAccounts.username })
    .from(externalAccounts)
    .where(
      and(
        eq(externalAccounts.memberId, memberId),
        eq(externalAccounts.provider, 'github'),
        isNotNull(externalAccounts.verifiedAt),
        isNotNull(externalAccounts.externalId),
      ),
    );
  return row?.username ?? null;
}

/** Why a repository link was allowed (recorded in the audit log). */
type RepoLinkBasis = 'staff' | 'verified_owner';

/**
 * A link routes every delivery for the repository (merged pull requests →
 * contributions, pushes and releases → activity) into this project, so the
 * linker must control the repository: staff (canManageProjects or
 * canManageIntegrations), or a project manager whose staff-verified GitHub
 * account owns the repository's namespace (a personal repository).
 * Organization repositories are linked by staff. Refusals are audited.
 */
async function requireRepoControl(
  ctx: ServiceContext,
  access: ProjectAccess,
  repo: string,
): Promise<RepoLinkBasis> {
  if (access.staff || can(ctx, 'canManageIntegrations')) return 'staff';
  const [namespace] = repo.split('/');
  const memberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  const login = memberId ? await verifiedGithubLogin(ctx, memberId) : null;
  if (login !== null && login === namespace) return 'verified_owner';
  await recordAudit(
    ctx,
    {
      action: 'project.repo_link_denied',
      targetType: 'project',
      targetId: access.project.id,
      context: { repo, verifiedLogin: login },
      result: 'denied',
    },
    { durable: true },
  );
  throw new ForbiddenError(
    login === null
      ? 'Link repositories through a staff-verified GitHub account, or ask staff to link it.'
      : `Your verified GitHub account can link repositories under ${login}/ only. Staff link organization repositories.`,
  );
}

/**
 * Link (or unlink with null) the GitHub repository whose webhooks feed this
 * project. One project per repository; linking requires control of the
 * repository (see requireRepoControl), unlinking only project management.
 * Audited: the link routes merged pull requests into contributions.
 */
export async function linkGithubRepo(
  ctx: ServiceContext,
  input: z.input<typeof linkGithubRepoSchema>,
): Promise<ProjectRecord> {
  const data = parseInput(linkGithubRepoSchema, input);
  const access = await loadManageableProject(ctx, data.projectId);
  const { project } = access;
  if (project.githubRepo === data.repo) return project;
  const basis = data.repo ? await requireRepoControl(ctx, access, data.repo) : null;
  const conflict = () => new ConflictError('That repository is already linked to another project.');
  if (data.repo) {
    const [taken] = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.githubRepo, data.repo));
    if (taken) throw conflict();
  }
  try {
    return await withTransaction(ctx, async (t) => {
      const [updated] = await t.db
        .update(projects)
        .set({
          githubRepo: data.repo,
          updatedAt: t.clock.now(),
          ...(data.repo && !project.repoUrl ? { repoUrl: `https://github.com/${data.repo}` } : {}),
        })
        .where(eq(projects.id, project.id))
        .returning();
      await recordAudit(t, {
        action: 'project.repo_linked',
        targetType: 'project',
        targetId: project.id,
        context: { from: project.githubRepo, to: data.repo, basis },
      });
      await publishEvent(t, {
        type: 'project.repo_linked',
        aggregateType: 'project',
        aggregateId: project.id,
        payload: { ...projectEventBase(updated!), repo: data.repo, previous: project.githubRepo },
      });
      return updated!;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'projects_github_repo_uq')) throw conflict();
    throw error;
  }
}

/**
 * Lookup for inbound GitHub webhooks. Bypasses visibility, so it is
 * restricted to the system actor (the job worker).
 */
export async function findProjectByGithubRepo(
  ctx: ServiceContext,
  fullName: string,
): Promise<ProjectRecord | null> {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
  const repo = normalizeGithubRepo(fullName);
  if (!isValidGithubRepo(repo)) return null;
  const [row] = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.githubRepo, repo), isNull(projects.deletedAt)));
  return row ?? null;
}
