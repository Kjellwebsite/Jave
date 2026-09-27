import { ValidationError } from '@jave/core';
import { formOptional, formStrings } from './form-data';
import { zonedInputToDate } from './trial-time';

/**
 * FormData → service input for the trials pages. Parsing only: shapes and
 * types. Every rule (lengths, ranges, keys, states) is enforced by the
 * trials and adversarial services, whose validation errors map back onto
 * the fields.
 */

/** A form-level problem, reported on its field like a service validation error. */
function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, [{ path: field, message }]);
}

const WHOLE_NUMBER = /^-?\d+$/;
/** Rubric JSON is small (≤ 10 criteria); anything bigger is not from our form. */
const MAX_RUBRIC_JSON = 12_000;

/** Optional whole number; '' → undefined. */
export function formInteger(data: FormData, name: string): number | undefined {
  const raw = formOptional(data, name);
  if (raw === undefined) return undefined;
  if (!WHOLE_NUMBER.test(raw)) throw fieldError(name, 'Enter a whole number.');
  return Number(raw);
}

export function requiredInteger(data: FormData, name: string): number {
  const value = formInteger(data, name);
  if (value === undefined) throw fieldError(name, 'Required.');
  return value;
}

/** A wall-clock time typed in `timeZone`; '' → null. */
export function formZonedDate(data: FormData, name: string, timeZone: string): Date | null {
  const raw = formOptional(data, name);
  if (raw === undefined) return null;
  const date = zonedInputToDate(raw, timeZone);
  if (!date) throw fieldError(name, 'Enter a date and time.');
  return date;
}

export interface RubricInput {
  key: string;
  label: string;
  description: string;
  weight: number;
}

type RubricJson = Omit<RubricInput, 'weight'> & { weight: number | null };

function isRubricInput(value: unknown): value is RubricJson {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.key === 'string' &&
    typeof row.label === 'string' &&
    typeof row.description === 'string' &&
    (typeof row.weight === 'number' || row.weight === null)
  );
}

/** The rubric editor's JSON field. Shape only; the service validates the content. */
export function formRubric(data: FormData, name = 'rubric'): RubricInput[] {
  const value = data.get(name);
  const raw = typeof value === 'string' ? value : '';
  if (!raw || raw.length > MAX_RUBRIC_JSON) throw fieldError(name, 'Add the rubric.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw fieldError(name, 'The rubric could not be read. Reload and try again.');
  }
  if (!Array.isArray(parsed) || !parsed.every(isRubricInput))
    throw fieldError(name, 'The rubric could not be read. Reload and try again.');
  // An emptied weight field arrives as null: the service reports it as "must be greater than 0".
  return parsed.map(({ key, label, description, weight }) => ({
    key,
    label,
    description,
    weight: weight ?? 0,
  }));
}

/** Checkbox group of facet keys, in the order the form lists them. */
export function formFacetKeys(data: FormData, name = 'facetKeys'): string[] {
  return formStrings(data, name);
}

/** 0–10 per criterion from `score:<key>` fields. Missing or blank scores are left out. */
export function formScores(data: FormData, keys: readonly string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const key of keys) {
    const value = formInteger(data, `score:${key}`);
    if (value !== undefined) scores[key] = value;
  }
  return scores;
}
