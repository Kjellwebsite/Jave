import 'server-only';
import { isUuid, ValidationError } from '@jave/core';
import { formString } from '@/lib/form-data';

/**
 * Form → service input helpers shared by the project and contribution
 * Server Actions. They only shape input; every rule (lengths, URLs,
 * authorization, state) is enforced by the core services.
 */

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HANDLE_MAX_LENGTH = 64;

/** A uuid from a hidden field; anything else reads as an unknown record. */
export function uuidField(data: FormData, name: string, entity: string): string {
  const value = formString(data, name);
  if (!isUuid(value)) throw new ValidationError(`Unknown ${entity}.`);
  return value;
}

/** Text for a nullable column: blank clears it (null), otherwise the raw text for core to validate. */
export function nullableText(data: FormData, name: string): string | null {
  const value = formString(data, name).trim();
  return value === '' ? null : value;
}

/** `YYYY-MM-DD` from a date input as UTC midnight, or undefined when blank. */
export function dateField(data: FormData, name: string): Date | undefined {
  const value = formString(data, name).trim();
  if (value === '') return undefined;
  const date = DATE_INPUT_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Use a valid date.', [{ path: name, message: 'Use a valid date.' }]);
  }
  return date;
}

/** A member handle as typed (`@mara` or `mara`), lowercased. */
export function handleField(data: FormData, name: string): string {
  const value = formString(data, name).trim().replace(/^@/, '').toLowerCase();
  if (value === '' || value.length > HANDLE_MAX_LENGTH) {
    throw new ValidationError('Enter a member handle.', [
      { path: name, message: 'Enter a member handle.' },
    ]);
  }
  return value;
}
