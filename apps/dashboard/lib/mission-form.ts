import { fromDatetimeLocal, toDatetimeLocal } from './datetime-local';
import { formBoolean, formOptional, formString } from './form-data';
import { MISSION_TYPE_LABELS, type MissionTypeKey } from './mission-labels';

/**
 * Form → service input for the mission create/edit form. Pure: blank means
 * "none", numbers are passed through for the service schema to validate
 * (so its messages reach the inline field errors), nothing is authorized here.
 * The deadline is entered in the viewer's time zone, the zone every
 * timestamp on the page is shown in.
 */

/** Marks a deadline the browser sent but the calendar cannot hold (e.g. 2026-02-30). */
export const INVALID_DATE = new Date(Number.NaN);

/** A `datetime-local` deadline in `timeZone`: null when blank, INVALID_DATE when malformed. */
export function parseDeadlineInput(value: string | undefined, timeZone: string): Date | null {
  if (!value) return null;
  return fromDatetimeLocal(value, timeZone) ?? INVALID_DATE;
}

/** The value the deadline input shows for a stored deadline. */
export function deadlineInputValue(deadline: Date | null, timeZone: string): string {
  return deadline ? toDatetimeLocal(deadline, timeZone) : '';
}

/**
 * The deadline of an edit. The form shows the stored deadline to the minute;
 * left as shown, it stays exactly as stored (undefined), so the edit neither
 * shifts it nor re-validates a deadline that has already passed.
 */
export function editedDeadline(
  data: FormData,
  stored: Date | null,
  timeZone: string,
): Date | null | undefined {
  const value = formOptional(data, 'deadlineAt');
  if ((value ?? '') === deadlineInputValue(stored, timeZone)) return undefined;
  return parseDeadlineInput(value, timeZone);
}

/** Blank → null; anything else is handed to the schema as a number (NaN fails it). */
export function optionalNumber(data: FormData, name: string): number | null {
  const value = formOptional(data, name);
  return value === undefined ? null : Number(value);
}

export function missionTypeFrom(data: FormData): MissionTypeKey | undefined {
  const value = formString(data, 'type');
  return Object.hasOwn(MISSION_TYPE_LABELS, value) ? (value as MissionTypeKey) : undefined;
}

export interface MissionFormInput {
  title: string;
  brief: string;
  type: MissionTypeKey | undefined;
  facetKey: string | null;
  evidenceRequired: boolean;
  rewardAchievementKey: string | null;
  rewardNote: string | null;
  maxAssignees: number | null;
  selfAssignable: boolean;
  deadlineAt: Date | null;
  durationHours: number | null;
}

export function missionFormInput(data: FormData, timeZone: string): MissionFormInput {
  return {
    title: formString(data, 'title'),
    brief: formString(data, 'brief'),
    type: missionTypeFrom(data),
    facetKey: formOptional(data, 'facetKey') ?? null,
    evidenceRequired: formBoolean(data, 'evidenceRequired'),
    rewardAchievementKey: formOptional(data, 'rewardAchievementKey') ?? null,
    rewardNote: formOptional(data, 'rewardNote') ?? null,
    maxAssignees: optionalNumber(data, 'maxAssignees'),
    selfAssignable: formBoolean(data, 'selfAssignable'),
    deadlineAt: parseDeadlineInput(formOptional(data, 'deadlineAt'), timeZone),
    durationHours: optionalNumber(data, 'durationHours'),
  };
}

/** Form fields the mission service validates, for inline errors. */
export const MISSION_FORM_FIELDS = [
  'title',
  'brief',
  'type',
  'facetKey',
  'rewardAchievementKey',
  'rewardNote',
  'maxAssignees',
  'deadlineAt',
  'durationHours',
] as const;
