import type { projectStatus } from '@jave/database';
import { InvalidStateError } from '../kernel/errors';

export type ProjectStatus = (typeof projectStatus.enumValues)[number];

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'idea',
  'planning',
  'building',
  'testing',
  'shipped',
  'archived',
];

/**
 * Project lifecycle: IDEA → PLANNING → BUILDING → TESTING → SHIPPED, with
 * ARCHIVED reachable from every state. Work can step back one stage (plans
 * change, tests fail) and a shipped project can re-enter BUILDING/TESTING for
 * a new iteration. ARCHIVED is terminal here: only staff restore a project
 * (see unarchiveProject), which returns it to the status it was archived from.
 */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  idea: ['planning', 'building', 'archived'],
  planning: ['idea', 'building', 'archived'],
  building: ['planning', 'testing', 'shipped', 'archived'],
  testing: ['building', 'shipped', 'archived'],
  shipped: ['building', 'testing', 'archived'],
  archived: [],
};

export const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  idea: 'IDEA',
  planning: 'PLANNING',
  building: 'BUILDING',
  testing: 'TESTING',
  shipped: 'SHIPPED',
  archived: 'ARCHIVED',
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (from === to) throw new InvalidStateError(`The project is already ${STATUS_LABELS[to]}.`);
  if (from === 'archived') {
    throw new InvalidStateError('Archived projects can only be restored by staff.');
  }
  if (!canTransition(from, to)) {
    throw new InvalidStateError(
      `A ${STATUS_LABELS[from]} project cannot move to ${STATUS_LABELS[to]}.`,
      { from, to, allowed: PROJECT_TRANSITIONS[from] },
    );
  }
}

/**
 * Whether a transition counts as shipping. Only the first ship does: once
 * shippedAt is set, re-shipping after another iteration never re-emits
 * project.shipped (achievements count real ships, not loops).
 */
export function isFirstShip(to: ProjectStatus, shippedAt: Date | null): boolean {
  return to === 'shipped' && shippedAt === null;
}

/** Status restored by unarchiving (projects archived before tracking fall back to IDEA). */
export function restoredStatus(archivedFrom: ProjectStatus | null): ProjectStatus {
  return archivedFrom && archivedFrom !== 'archived' ? archivedFrom : 'idea';
}
