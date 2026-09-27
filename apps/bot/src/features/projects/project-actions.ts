import { findMemberByDiscordId, NotFoundError, projects, ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { button, failure, panel, row, success } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { type ActionMap, replaceWith, selectedValue, userSelect } from './actions';
import { LINE_TEXT_MAX, PROJECTS_NS } from './constants';
import { uuidArg } from './lookup';
import { contributionModal, MODAL_FIELDS, milestoneModal } from './modals';
import {
  ANY_STATUS,
  archiveConfirmPayload,
  editRestriction,
  leaveConfirmPayload,
  milestonePickerPayload,
  parseOffset,
  parseScope,
  parseStatusFilter,
  projectListPayload,
  statusPickerPayload,
} from './project-views';
import { projectCard, ROLE_LABELS } from './render';

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Discord snowflakes, as a user select sends them. */
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const ASSIGNABLE_ROLES = ['contributor', 'maintainer'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function loadById(h: HandlerContext, projectId: string): Promise<projects.ProjectDetail> {
  return projects.getProject(h.ctx, { projectId });
}

function shippedCopy(detail: projects.ProjectRecord): { title: string; text: string } {
  const label = projects.STATUS_LABELS[detail.status];
  return {
    title: detail.status === 'shipped' ? 'Project shipped' : 'Project updated',
    text: `${userText(detail.title, LINE_TEXT_MAX)} ${GLYPH.dot} now ${label}.`,
  };
}

/** `YYYY-MM-DD` (UTC midnight) or undefined when blank. Core checks plausibility. */
export function parseDueDate(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = DUE_DATE_PATTERN.test(trimmed) ? new Date(`${trimmed}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new ValidationError('Use YYYY-MM-DD for the due date.', [
      { path: 'dueAt', message: 'Use YYYY-MM-DD.' },
    ]);
  }
  return date;
}

const VISIBILITIES: readonly projects.ProjectVisibility[] = ['public', 'members', 'private'];

/** A submitted visibility, or a validation error for anything forged. */
function visibilityOf(value: string | undefined): projects.ProjectVisibility {
  const visibility = VISIBILITIES.find((candidate) => candidate === value);
  if (!visibility) throw new ValidationError('Choose a visibility.');
  return visibility;
}

function isAssignableRole(value: string | undefined): value is AssignableRole {
  return ASSIGNABLE_ROLES.some((role) => role === value);
}

function rolePanel(kicker: string, detail: projects.ProjectDetail) {
  return panel({
    kicker,
    title: userText(detail.title, LINE_TEXT_MAX),
    description: 'Choose their role. They are notified and can leave at any time.',
  });
}

/** CONTRIBUTOR always; MAINTAINER only for owners and staff (core enforces the same). */
function roleButtons(detail: projects.ProjectDetail, memberId: string) {
  const roles = ASSIGNABLE_ROLES.filter((role) => role === 'contributor' || detail.viewer.canAdmin);
  return row(
    ...roles.map((role) =>
      button(ROLE_LABELS[role], customId(PROJECTS_NS, 'add', detail.id, memberId, role)),
    ),
  );
}

export const projectComponentActions: ActionMap = {
  async view(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    const card = projectCard(detail, { publicUrl: h.ctx.config.publicUrl });
    await replaceWith(h, card.embeds ?? [], card.components);
  },

  async open(h) {
    const detail = await loadById(h, uuidArg([selectedValue(h)], 0, 'Project'));
    await h.respond(projectCard(detail, { publicUrl: h.ctx.config.publicUrl }));
  },

  async status(h, args) {
    await h.respond(statusPickerPayload(await loadById(h, uuidArg(args, 0, 'Project'))));
  },

  async setstatus(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const target = parseStatusFilter(selectedValue(h));
    if (!target) throw new ValidationError('Choose a status.');
    const detail = await loadById(h, projectId);
    if (detail.status !== args[1]) {
      return replaceWith(h, [
        failure(
          'STALE',
          `The project is now ${projects.STATUS_LABELS[detail.status]}. Open the status picker again.`,
        ),
      ]);
    }
    if (target === 'archived') {
      const confirm = archiveConfirmPayload(detail);
      return replaceWith(h, confirm.embeds ?? [], confirm.components);
    }
    const updated = await projects.changeProjectStatus(h.ctx, { projectId, status: target });
    const copy = shippedCopy(updated);
    await replaceWith(
      h,
      [success(copy.title, copy.text)],
      [row(button('View project', customId(PROJECTS_NS, 'view', projectId)))],
    );
  },

  async archive(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const detail = await loadById(h, projectId);
    if (detail.status !== args[1]) {
      return replaceWith(h, [
        failure(
          'STALE',
          `The project is now ${projects.STATUS_LABELS[detail.status]}. Nothing was archived.`,
        ),
      ]);
    }
    await projects.changeProjectStatus(h.ctx, { projectId, status: 'archived' });
    await replaceWith(h, [
      success('Project archived', `${userText(detail.title, LINE_TEXT_MAX)} is frozen.`),
    ]);
  },

  async filter(h, args) {
    const status =
      selectedValue(h) === ANY_STATUS ? undefined : parseStatusFilter(selectedValue(h));
    const payload = await projectListPayload(h, parseScope(args[0]), status, 0);
    await replaceWith(h, payload.embeds ?? [], payload.components);
  },

  async list(h, args) {
    const payload = await projectListPayload(
      h,
      parseScope(args[0]),
      parseStatusFilter(args[1]),
      parseOffset(args[2]),
    );
    await replaceWith(h, payload.embeds ?? [], payload.components);
  },

  async msadd(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    const restricted = editRestriction(detail);
    if (restricted) return h.respond(restricted);
    await h.interaction.showModal(milestoneModal(detail.id, detail.title));
  },

  async msdone(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    await h.respond(editRestriction(detail) ?? milestonePickerPayload(detail));
  },

  async msdonesel(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const milestoneId = uuidArg([selectedValue(h)], 0, 'Milestone');
    const milestone = await projects.completeMilestone(h.ctx, { projectId, milestoneId });
    await replaceWith(
      h,
      [success('Milestone done', userText(milestone.title, LINE_TEXT_MAX))],
      [row(button('View project', customId(PROJECTS_NS, 'view', projectId)))],
    );
  },

  async contribute(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    await h.interaction.showModal(contributionModal({ id: detail.id, title: detail.title }));
  },

  async leave(h, args) {
    await h.respond(leaveConfirmPayload(await loadById(h, uuidArg(args, 0, 'Project'))));
  },

  async leaveok(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const detail = await loadById(h, projectId);
    await projects.leaveProject(h.ctx, { projectId });
    await replaceWith(h, [
      success('Left project', `You are no longer on ${userText(detail.title, LINE_TEXT_MAX)}.`),
    ]);
  },

  /** Card → ADD MEMBER, step 1: Discord's member picker (no typing, no ids). */
  async addmember(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    const restricted = editRestriction(detail);
    if (restricted) return h.respond(restricted);
    await h.respond({
      embeds: [
        panel({
          kicker: 'ADD MEMBER',
          title: userText(detail.title, LINE_TEXT_MAX),
          description: 'Choose the member to add. They are notified and can leave at any time.',
        }),
      ],
      components: [row(userSelect(customId(PROJECTS_NS, 'addpick', detail.id), 'Member…'))],
      ephemeral: true,
    });
  },

  /** ADD MEMBER, step 2: the picked Discord user → their JVLN profile → role buttons. */
  async addpick(h, args) {
    const detail = await loadById(h, uuidArg(args, 0, 'Project'));
    const restricted = editRestriction(detail);
    if (restricted) return replaceWith(h, restricted.embeds ?? []);
    const discordId = selectedValue(h);
    const member = DISCORD_ID_PATTERN.test(discordId)
      ? await findMemberByDiscordId(h.ctx, discordId)
      : null;
    if (!member) throw new NotFoundError('JVLN profile');
    const teammate = detail.members.find((candidate) => candidate.memberId === member.id);
    if (teammate) {
      return replaceWith(h, [
        failure(
          'ALREADY ON THE TEAM',
          `${userText(teammate.displayName, LINE_TEXT_MAX)} is already on ${userText(detail.title, LINE_TEXT_MAX)}.`,
        ),
      ]);
    }
    await replaceWith(h, [rolePanel('ADD MEMBER', detail)], [roleButtons(detail, member.id)]);
  },

  /** "Add to Project" menu, step 2: the chosen project → role buttons. */
  async addto(h, args) {
    const memberId = uuidArg(args, 0, 'Member');
    const detail = await loadById(h, uuidArg([selectedValue(h)], 0, 'Project'));
    const restricted = editRestriction(detail);
    if (restricted) return replaceWith(h, restricted.embeds ?? []);
    await replaceWith(h, [rolePanel('ADD TO PROJECT', detail)], [roleButtons(detail, memberId)]);
  },

  /** ADD MEMBER / Add to Project, final step: add with the chosen role (core re-authorizes). */
  async add(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const memberId = uuidArg(args, 1, 'Member');
    const role = args[2];
    if (!isAssignableRole(role)) throw new ValidationError('Choose a role.');
    await projects.addProjectMember(h.ctx, { projectId, memberId, role });
    const detail = await loadById(h, projectId);
    await replaceWith(h, [
      success(
        'Member added',
        `${ROLE_LABELS[role]} ${GLYPH.dot} ${userText(detail.title, LINE_TEXT_MAX)}. They were notified.`,
      ),
    ]);
  },
};

export const projectModalActions: ActionMap = {
  async create(h) {
    const { modal } = h.interaction;
    const created = await projects.createProject(h.ctx, {
      title: modal.text(MODAL_FIELDS.title),
      summary: modal.text(MODAL_FIELDS.summary) || undefined,
      description: modal.text(MODAL_FIELDS.description) || undefined,
      visibility: visibilityOf(modal.select(MODAL_FIELDS.visibility)[0]),
      domainKey: modal.select(MODAL_FIELDS.domain)[0] || undefined,
    });
    const detail = await loadById(h, created.id);
    const card = projectCard(detail, { publicUrl: h.ctx.config.publicUrl });
    await h.respond({
      embeds: [
        success(
          'Project started',
          `${userText(created.title, LINE_TEXT_MAX)} ${GLYPH.dot} IDEA. You are the owner. Move it forward with STATUS; ship it when it is real.`,
        ),
        ...(card.embeds ?? []),
      ],
      components: card.components,
      ephemeral: true,
    });
  },

  async msadd(h, args) {
    const projectId = uuidArg(args, 0, 'Project');
    const { modal } = h.interaction;
    const milestone = await projects.addMilestone(h.ctx, {
      projectId,
      title: modal.text(MODAL_FIELDS.title),
      description: modal.text(MODAL_FIELDS.description) || undefined,
      dueAt: parseDueDate(modal.text(MODAL_FIELDS.dueDate)),
    });
    await h.respond({
      embeds: [success('Milestone added', userText(milestone.title, LINE_TEXT_MAX))],
      components: [row(button('View project', customId(PROJECTS_NS, 'view', projectId)))],
      ephemeral: true,
    });
  },
};
