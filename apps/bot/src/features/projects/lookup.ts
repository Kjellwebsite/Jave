import { can, findMemberByDiscordId, isUuid, NotFoundError, projects } from '@jave/core';
import type { AutocompleteChoice, HandlerContext, InteractionUser } from '../../interactions/types';
import { clip } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { CHOICE_NAME_MAX, PICKER_LIMIT } from './constants';

const MAX_SLUG_LENGTH = 64;

/** Which projects a picker offers: every project the viewer can see, or only their own. */
export type PickerScope = 'visible' | 'mine';

/** A project reference from an option value: autocomplete sends the id; typed text may be a slug. */
export function projectRef(value: string | null): { projectId: string } | { slug: string } {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (isUuid(trimmed)) return { projectId: trimmed };
  if (
    trimmed.length > 0 &&
    trimmed.length <= MAX_SLUG_LENGTH &&
    projects.SLUG_PATTERN.test(trimmed)
  )
    return { slug: trimmed };
  throw new NotFoundError('Project');
}

/** The project page as the invoking user may see it (invisible projects are not found). */
export function loadProject(
  h: HandlerContext,
  value: string | null,
): Promise<projects.ProjectDetail> {
  return projects.getProject(h.ctx, projectRef(value));
}

/**
 * A uuid argument from a custom id. Custom ids route, they never authorize:
 * a malformed or forged id reads as "not found", like a missing record.
 */
export function uuidArg(args: readonly string[], index: number, entity: string): string {
  const value = args[index];
  if (!value || !isUuid(value)) throw new NotFoundError(entity);
  return value;
}

/** The member behind a Discord user (their JVLN profile). */
export async function memberIdOf(h: HandlerContext, user: InteractionUser): Promise<string> {
  const member = await findMemberByDiscordId(h.ctx, user.id);
  if (!member) throw new NotFoundError('JVLN profile');
  return member.id;
}

/** Projects staff may manage are all of them; everyone else picks from their own. */
export function manageScope(h: HandlerContext): PickerScope {
  return can(h.ctx, 'canManageProjects') ? 'visible' : 'mine';
}

function choiceName(title: string, status: projects.ProjectStatus): string {
  return clip(`${title} ${GLYPH.dot} ${projects.STATUS_LABELS[status]}`, CHOICE_NAME_MAX);
}

/** Autocomplete choices: projects matching the typed text, newest activity first. */
export async function projectChoices(
  h: HandlerContext,
  query: string,
  scope: PickerScope,
): Promise<AutocompleteChoice[]> {
  const memberId = h.ctx.actor.kind === 'user' ? h.ctx.actor.memberId : null;
  if (scope === 'mine' && !memberId) return [];
  const search = query.trim().slice(0, MAX_SLUG_LENGTH) || undefined;
  const page = await projects.listProjects(h.ctx, {
    search,
    memberId: scope === 'mine' ? (memberId ?? undefined) : undefined,
    limit: PICKER_LIMIT,
  });
  return page.items.map((project) => ({
    name: choiceName(project.title, project.status),
    value: project.id,
  }));
}

/** Autocomplete choices: open (planned/active) milestones of the project in the `project` option. */
export async function openMilestoneChoices(
  h: HandlerContext,
  projectValue: string | null,
  query: string,
): Promise<AutocompleteChoice[]> {
  if (!projectValue || !isUuid(projectValue)) return [];
  const milestones = await projects.listMilestones(h.ctx, { projectId: projectValue });
  const q = query.trim().toLowerCase();
  return milestones
    .filter((m) => m.status === 'planned' || m.status === 'active')
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .slice(0, PICKER_LIMIT)
    .map((m) => ({
      name: clip(`${m.title} ${GLYPH.dot} ${m.status.toUpperCase()}`, CHOICE_NAME_MAX),
      value: m.id,
    }));
}

/**
 * Active projects the viewer manages (owner/maintainer; staff: every
 * project) that this member is not on yet, newest activity first — filtered
 * by core before the picker limit, so none is hidden behind busier ones.
 */
export function addableProjects(
  h: HandlerContext,
  memberId: string,
): Promise<projects.ProjectSummary[]> {
  return projects.listAddableProjects(h.ctx, { memberId, limit: PICKER_LIMIT });
}
