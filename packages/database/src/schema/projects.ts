import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, ts, updatedAt } from './_shared';
import { capabilityDomains, members, users } from './identity';

export const projectStatus = pgEnum('project_status', [
  'idea',
  'planning',
  'building',
  'testing',
  'shipped',
  'archived',
]);
export const projectVisibility = pgEnum('project_visibility', ['public', 'members', 'private']);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    summary: varchar('summary', { length: 280 }),
    description: text('description'),
    ownerMemberId: uuid('owner_member_id')
      .notNull()
      .references(() => members.id),
    status: projectStatus('status').notNull().default('idea'),
    domainKey: varchar('domain_key', { length: 32 }).references(() => capabilityDomains.key),
    goals: text('goals'),
    visibility: projectVisibility('visibility').notNull().default('members'),
    /** "owner/name" — links inbound GitHub webhooks to this project. */
    githubRepo: varchar('github_repo', { length: 140 }),
    repoUrl: text('repo_url'),
    websiteUrl: text('website_url'),
    /** First time the project shipped. Re-shipping never moves it (no achievement farming). */
    shippedAt: ts('shipped_at'),
    archivedAt: ts('archived_at'),
    /** Status before archiving; staff unarchive restores it. */
    archivedFromStatus: projectStatus('archived_from_status'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('projects_slug_uq').on(t.slug),
    uniqueIndex('projects_github_repo_uq').on(t.githubRepo),
    index('projects_status_idx').on(t.status),
    index('projects_owner_idx').on(t.ownerMemberId),
  ],
);

export const projectMemberRole = pgEnum('project_member_role', [
  'owner',
  'maintainer',
  'contributor',
]);

export const projectMembers = pgTable(
  'project_members',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    role: projectMemberRole('role').notNull().default('contributor'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    leftAt: ts('left_at'),
  },
  (t) => [
    uniqueIndex('project_members_uq').on(t.projectId, t.memberId),
    index('project_members_member_idx').on(t.memberId),
    /** Exactly one active owner per project. */
    uniqueIndex('project_members_one_owner_uq')
      .on(t.projectId)
      .where(sql`${t.role} = 'owner' and ${t.leftAt} is null`),
  ],
);

export const projectLinks = pgTable(
  'project_links',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 48 }).notNull(),
    url: text('url').notNull(),
    ordinal: smallint('ordinal').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('project_links_project_idx').on(t.projectId)],
);

export const milestoneStatus = pgEnum('milestone_status', ['planned', 'active', 'done', 'dropped']);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description'),
    status: milestoneStatus('status').notNull().default('planned'),
    dueAt: ts('due_at'),
    completedAt: ts('completed_at'),
    ordinal: smallint('ordinal').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('project_milestones_project_idx').on(t.projectId)],
);

export const contributionKind = pgEnum('contribution_kind', [
  'code',
  'research',
  'design',
  'writing',
  'operations',
  'mentoring',
  'review',
  'other',
]);
export const contributionSource = pgEnum('contribution_source', ['manual', 'github', 'system']);
export const contributionStatus = pgEnum('contribution_status', [
  'submitted',
  'verified',
  'rejected',
]);

export const contributions = pgTable(
  'contributions',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    projectId: uuid('project_id').references(() => projects.id),
    kind: contributionKind('kind').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    url: text('url'),
    source: contributionSource('source').notNull().default('manual'),
    /** Idempotency key for integration-sourced contributions, e.g. github:pr:owner/repo#12 */
    externalRef: varchar('external_ref', { length: 200 }),
    status: contributionStatus('status').notNull().default('submitted'),
    /** Null with a verifiedAt means auto-verified (merged PR by a verified GitHub account). */
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: ts('verified_at'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNote: varchar('review_note', { length: 1000 }),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('contributions_external_ref_uq').on(t.externalRef),
    index('contributions_member_idx').on(t.memberId, t.status),
    index('contributions_project_idx').on(t.projectId),
  ],
);
