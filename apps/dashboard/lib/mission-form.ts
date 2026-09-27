import { formBoolean, formOptional, formString } from './form-data';
import { MISSION_TYPE_LABELS, type MissionTypeKey } from './mission-labels';

/**
 * Form → service input for the mission create/edit form. Pure: blank means
 * "none", numbers are passed through for the service schema to validate
 * (so its messages reach the inline field errors), nothing is authorized here.
 */

/** `<input type="datetime-local">` value, read as UTC. */
const UTC_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** Marks a deadline the browser sent but the calendar cannot hold (e.g. 2026-02-30). */
export const INVALID_DATE = new Date(Number.NaN);

/** A UTC `YYYY-MM-DDTHH:MM` value, null when blank, INVALID_DATE when malformed. */
export function parseUtcInput(value: string | undefined): Date | null {
  if (!value) return null;
  const match = UTC_INPUT_PATTERN.exec(value);
  if (!match) return INVALID_DATE;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : INVALID_DATE;
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

export function missionFormInput(data: FormData): MissionFormInput {
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
    deadlineAt: parseUtcInput(formOptional(data, 'deadlineAt')),
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
