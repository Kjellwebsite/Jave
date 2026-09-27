/**
 * Client-safe presentation helpers for projects, contributions and their
 * activity feed. Pure: no I/O, no core imports beyond types.
 */

export type ProjectStatusKey =
  'idea' | 'planning' | 'building' | 'testing' | 'shipped' | 'archived';
export type ProjectVisibilityKey = 'public' | 'members' | 'private';
export type ProjectRoleKey = 'owner' | 'maintainer' | 'contributor';
export type ContributionStatusKey = 'submitted' | 'verified' | 'rejected';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/** The lifecycle as drawn by the pipeline; ARCHIVED sits outside it. */
export const PIPELINE_STAGES: readonly ProjectStatusKey[] = [
  'idea',
  'planning',
  'building',
  'testing',
  'shipped',
];

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatusKey, string>> = {
  idea: 'Idea',
  planning: 'Planning',
  building: 'Building',
  testing: 'Testing',
  shipped: 'Shipped',
  archived: 'Archived',
};

export const PROJECT_STATUS_TONE: Readonly<Record<ProjectStatusKey, Tone>> = {
  idea: 'neutral',
  planning: 'neutral',
  building: 'info',
  testing: 'info',
  shipped: 'success',
  archived: 'neutral',
};

export const PROJECT_VISIBILITY_LABELS: Readonly<Record<ProjectVisibilityKey, string>> = {
  public: 'Public',
  members: 'Members',
  private: 'Private',
};

export const PROJECT_VISIBILITY_HINTS: Readonly<Record<ProjectVisibilityKey, string>> = {
  public: 'Anyone, including signed-out visitors.',
  members: 'Signed-in JAVELIN members.',
  private: 'Only the team and staff.',
};

export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRoleKey, string>> = {
  owner: 'Owner',
  maintainer: 'Maintainer',
  contributor: 'Contributor',
};

export const CONTRIBUTION_KIND_LABELS = {
  code: 'Code',
  research: 'Research',
  design: 'Design',
  writing: 'Writing',
  operations: 'Operations',
  mentoring: 'Mentoring',
  review: 'Review',
  other: 'Other',
} as const;

export type ContributionKindKey = keyof typeof CONTRIBUTION_KIND_LABELS;

export const CONTRIBUTION_STATUS_LABELS: Readonly<Record<ContributionStatusKey, string>> = {
  submitted: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Rejected',
};

export const CONTRIBUTION_STATUS_TONE: Readonly<Record<ContributionStatusKey, Tone>> = {
  submitted: 'warning',
  verified: 'success',
  rejected: 'danger',
};

export const MILESTONE_STATUS_LABELS = {
  planned: 'Planned',
  active: 'Active',
  done: 'Done',
  dropped: 'Dropped',
} as const;

export type MilestoneStatusKey = keyof typeof MILESTONE_STATUS_LABELS;

export const MILESTONE_STATUS_TONE: Readonly<Record<MilestoneStatusKey, Tone>> = {
  planned: 'neutral',
  active: 'info',
  done: 'success',
  dropped: 'neutral',
};

export const PROJECT_SORT_LABELS = {
  updated_desc: 'Recently updated',
  created_desc: 'Newest',
  title: 'Title',
} as const;

export type ProjectSortKey = keyof typeof PROJECT_SORT_LABELS;

/** Canonical dashboard path of a project (slugs are stable). */
export function projectPath(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}`;
}

/** Done milestones out of the ones still in scope (dropped ones do not count). */
export function milestoneProgress(milestones: readonly { status: MilestoneStatusKey }[]): {
  done: number;
  total: number;
} {
  const inScope = milestones.filter((milestone) => milestone.status !== 'dropped');
  return {
    done: inScope.filter((milestone) => milestone.status === 'done').length,
    total: inScope.length,
  };
}

/** Where the pipeline stands: stages before the current one read as passed. */
export function pipelineState(
  status: ProjectStatusKey,
  stage: ProjectStatusKey,
): 'passed' | 'current' | 'ahead' {
  if (status === stage) return 'current';
  if (status === 'archived') return 'ahead';
  return PIPELINE_STAGES.indexOf(stage) < PIPELINE_STAGES.indexOf(status) ? 'passed' : 'ahead';
}

export interface PersonName {
  displayName: string;
}

/** An activity item as the feed receives it from core (member ids already replaced). */
export interface ActivityInput {
  type: string;
  actor: PersonName | null;
  people: Record<string, PersonName | null>;
  payload: Record<string, unknown>;
}

export interface ActivityLine {
  title: string;
  detail: string | null;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

const HIDDEN_MEMBER = 'A member';

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function statusLabel(value: unknown): string {
  return typeof value === 'string' && value in PROJECT_STATUS_LABELS
    ? PROJECT_STATUS_LABELS[value as ProjectStatusKey].toUpperCase()
    : 'UNKNOWN';
}

function roleLabel(value: unknown): string {
  return typeof value === 'string' && value in PROJECT_ROLE_LABELS
    ? PROJECT_ROLE_LABELS[value as ProjectRoleKey].toUpperCase()
    : 'MEMBER';
}

function person(input: ActivityInput, field: string): string {
  return input.people[field]?.displayName ?? HIDDEN_MEMBER;
}

const DETAIL_CHANGES: Readonly<Record<string, string>> = {
  link_added: 'Link added',
  link_updated: 'Link updated',
  link_removed: 'Link removed',
  milestone_added: 'Milestone added',
  milestone_updated: 'Milestone updated',
  milestone_removed: 'Milestone removed',
};

function describeUpdate(payload: Record<string, unknown>): ActivityLine {
  const change = text(payload, 'change');
  if (change && change in DETAIL_CHANGES) {
    return {
      title: DETAIL_CHANGES[change]!,
      detail: text(payload, 'label') ?? text(payload, 'title'),
      tone: 'neutral',
    };
  }
  const fields = Array.isArray(payload.fields)
    ? payload.fields.filter((field): field is string => typeof field === 'string')
    : [];
  return {
    title: 'Details updated',
    detail: fields.length > 0 ? fields.join(', ') : null,
    tone: 'neutral',
  };
}

/**
 * One human line per project event. Unknown types fall back to the event
 * name, so new event types never break the feed. All strings are rendered
 * as React text (escaped), never as HTML.
 */
export function describeActivity(input: ActivityInput): ActivityLine {
  const { payload } = input;
  switch (input.type) {
    case 'project.created':
      return { title: 'Project started', detail: null, tone: 'info' };
    case 'project.updated':
      return describeUpdate(payload);
    case 'project.status_changed':
      return payload.unarchived === true
        ? { title: `Restored to ${statusLabel(payload.to)}`, detail: null, tone: 'info' }
        : {
            title: `${statusLabel(payload.from)} → ${statusLabel(payload.to)}`,
            detail: null,
            tone: payload.to === 'shipped' ? 'success' : 'info',
          };
    case 'project.member_added':
      return {
        title: `${person(input, 'memberId')} joined as ${roleLabel(payload.role)}`,
        detail: null,
        tone: 'neutral',
      };
    case 'project.member_removed':
      return {
        title: `${person(input, 'memberId')} ${payload.self === true ? 'left' : 'was removed'}`,
        detail: null,
        tone: 'neutral',
      };
    case 'project.member_role_changed':
      return {
        title: `${person(input, 'memberId')} is now ${roleLabel(payload.to)}`,
        detail: null,
        tone: 'neutral',
      };
    case 'project.ownership_transferred':
      return {
        title: 'Ownership transferred',
        detail: `${person(input, 'from')} → ${person(input, 'to')}`,
        tone: 'warning',
      };
    case 'project.milestone_completed':
      return { title: 'Milestone done', detail: text(payload, 'title'), tone: 'success' };
    case 'project.repo_linked': {
      const repo = text(payload, 'repo');
      return repo
        ? { title: 'GitHub repository linked', detail: repo, tone: 'neutral' }
        : {
            title: 'GitHub repository unlinked',
            detail: text(payload, 'previous'),
            tone: 'neutral',
          };
    }
    case 'project.github_push': {
      const count = typeof payload.commitCount === 'number' ? payload.commitCount : 0;
      return {
        title: `Pushed ${count} ${count === 1 ? 'commit' : 'commits'}${payload.forced === true ? ' (forced)' : ''}`,
        detail: text(payload, 'headline'),
        tone: 'neutral',
      };
    }
    case 'project.release_published':
      return {
        title: `Release ${text(payload, 'tag') ?? ''}`.trim(),
        detail: text(payload, 'name'),
        tone: 'success',
      };
    default:
      return { title: input.type, detail: null, tone: 'neutral' };
  }
}
