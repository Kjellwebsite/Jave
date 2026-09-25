import { projects, requireMember } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, failure, notice, panel, row, stringSelect } from '../../ui/components';
import { clip, userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { LINE_TEXT_MAX, LIST_PAGE_SIZE, PROJECTS_NS } from './constants';
import { projectLine, projectOptions, ROLE_LABELS, statusColor } from './render';

/** List scope: projects the viewer belongs to, or every project they can see. */
export type ListScope = 'mine' | 'all';
/** Status filter value in custom ids ('any' = no filter). */
export const ANY_STATUS = 'any';

export function parseScope(value: string | undefined): ListScope {
  return value === 'mine' ? 'mine' : 'all';
}

export function parseStatusFilter(value: string | undefined): projects.ProjectStatus | undefined {
  return projects.PROJECT_STATUSES.find((status) => status === value);
}

export function parseOffset(value: string | undefined): number {
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

/** /project list, its filter select and its page buttons all render this. */
export async function projectListPayload(
  h: HandlerContext,
  scope: ListScope,
  status: projects.ProjectStatus | undefined,
  offset: number,
): Promise<ReplyPayload> {
  const memberId = scope === 'mine' ? requireMember(h.ctx).memberId : undefined;
  const page = await projects.listProjects(h.ctx, {
    memberId,
    status,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const statusKey = status ?? ANY_STATUS;
  const heading = scope === 'mine' ? 'Your projects' : 'Projects';
  const filterLabel = status ? projects.STATUS_LABELS[status] : 'ALL ACTIVE';
  const lastPage = Math.max(1, Math.ceil(page.total / LIST_PAGE_SIZE));
  const currentPage = Math.floor(offset / LIST_PAGE_SIZE) + 1;
  const description =
    page.items.length > 0
      ? page.items.map(projectLine).join('\n')
      : scope === 'mine'
        ? 'You are not on any project in this view. Start one with `/project create`.'
        : 'No project matches this filter.';

  const filter = stringSelect(customId(PROJECTS_NS, 'filter', scope), 'Filter by status', [
    { label: 'ALL ACTIVE', value: ANY_STATUS, default: status === undefined },
    ...projects.PROJECT_STATUSES.map((s) => ({
      label: projects.STATUS_LABELS[s],
      value: s,
      default: s === status,
    })),
  ]);
  const components = [];
  if (page.items.length > 0)
    components.push(
      row(
        stringSelect(customId(PROJECTS_NS, 'open'), 'Open a project', projectOptions(page.items)),
      ),
    );
  components.push(row(filter));
  if (page.total > LIST_PAGE_SIZE) {
    components.push(
      row(
        button(
          'Previous',
          customId(PROJECTS_NS, 'list', scope, statusKey, Math.max(0, offset - LIST_PAGE_SIZE)),
          'secondary',
          offset === 0,
        ),
        button(
          'Next',
          customId(PROJECTS_NS, 'list', scope, statusKey, offset + LIST_PAGE_SIZE),
          'secondary',
          offset + LIST_PAGE_SIZE >= page.total,
        ),
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: 'JVLN PROJECTS',
        title: `${heading} ${GLYPH.dot} ${filterLabel}`,
        description,
        footer: `${page.total} total ${GLYPH.dot} page ${currentPage}/${lastPage}`,
      }),
    ],
    components,
    ephemeral: true,
  };
}

/**
 * Why the viewer cannot manage this project right now, as a reply — or null
 * when they can. A UI courtesy only: every write re-checks in core.
 */
export function editRestriction(detail: projects.ProjectDetail): ReplyPayload | null {
  if (detail.status === 'archived') {
    return {
      embeds: [
        failure(
          'ARCHIVED',
          `${userText(detail.title, LINE_TEXT_MAX)} is archived. Staff restore archived projects from the dashboard.`,
        ),
      ],
      ephemeral: true,
    };
  }
  if (!detail.viewer.canEdit) {
    return {
      embeds: [
        failure('ACCESS RESTRICTED', 'Only owners, maintainers and staff manage a project.'),
      ],
      ephemeral: true,
    };
  }
  return null;
}

/** Next-status select for a project the viewer manages. */
export function statusPickerPayload(detail: projects.ProjectDetail): ReplyPayload {
  const restricted = editRestriction(detail);
  if (restricted) return restricted;
  const targets = projects.PROJECT_TRANSITIONS[detail.status].filter(
    (target) => target !== 'archived' || detail.viewer.canAdmin,
  );
  return {
    embeds: [
      panel({
        kicker: 'PROJECT STATUS',
        title: userText(detail.title, LINE_TEXT_MAX),
        description: `Now **${projects.STATUS_LABELS[detail.status]}**. Choose where it moves next.`,
        color: statusColor(detail.status),
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(PROJECTS_NS, 'setstatus', detail.id, detail.status),
          'Move to…',
          targets.map((target) => ({
            label: projects.STATUS_LABELS[target],
            value: target,
            description:
              target === 'archived'
                ? 'Freezes edits, links, milestones and membership.'
                : target === 'shipped'
                  ? 'Credits every active member. Stamped once.'
                  : undefined,
          })),
        ),
      ),
    ],
    ephemeral: true,
  };
}

/** Confirmation before archiving (owner/staff). */
export function archiveConfirmPayload(detail: projects.ProjectDetail): ReplyPayload {
  return {
    embeds: [
      notice(
        'ARCHIVE PROJECT',
        `${userText(detail.title, LINE_TEXT_MAX)} will be frozen: no edits, links, milestones or membership changes. Only staff can restore it.`,
      ),
    ],
    components: [
      row(
        button('Archive', customId(PROJECTS_NS, 'archive', detail.id, detail.status), 'danger'),
        button('Cancel', customId(PROJECTS_NS, 'view', detail.id)),
      ),
    ],
    ephemeral: true,
  };
}

/** Select of the project's open milestones to mark done. */
export function milestonePickerPayload(detail: projects.ProjectDetail): ReplyPayload {
  const open = detail.milestones.filter((m) => m.status === 'planned' || m.status === 'active');
  if (open.length === 0) {
    return {
      embeds: [failure('NO OPEN MILESTONES', 'Every milestone is done or dropped.')],
      ephemeral: true,
    };
  }
  return {
    embeds: [
      panel({
        kicker: 'MILESTONES',
        title: userText(detail.title, LINE_TEXT_MAX),
        description: 'Choose the milestone that is done.',
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(PROJECTS_NS, 'msdonesel', detail.id),
          'Mark done…',
          open.map((m) => ({
            label: clip(m.title, LINE_TEXT_MAX),
            value: m.id,
            description: m.status.toUpperCase(),
          })),
        ),
      ),
    ],
    ephemeral: true,
  };
}

/** Confirmation before leaving a project. */
export function leaveConfirmPayload(detail: projects.ProjectDetail): ReplyPayload {
  const role = detail.viewer.role ? ROLE_LABELS[detail.viewer.role] : 'MEMBER';
  return {
    embeds: [
      notice(
        'LEAVE PROJECT',
        `You leave ${userText(detail.title, LINE_TEXT_MAX)} as ${role}. Recorded contributions stay yours. A manager can add you again.`,
      ),
    ],
    components: [
      row(
        button('Leave project', customId(PROJECTS_NS, 'leaveok', detail.id), 'danger'),
        button('Cancel', customId(PROJECTS_NS, 'view', detail.id)),
      ),
    ],
    ephemeral: true,
  };
}
