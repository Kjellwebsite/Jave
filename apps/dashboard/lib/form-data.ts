/** Hard cap on any single text field read from a form (services enforce exact limits). */
export const MAX_FORM_FIELD_LENGTH = 8_000;

/** A text field's value; files and missing fields read as ''. */
export function formString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.slice(0, MAX_FORM_FIELD_LENGTH) : '';
}

/** Trimmed text, or undefined when blank. */
export function formOptional(data: FormData, name: string): string | undefined {
  const value = formString(data, name).trim();
  return value === '' ? undefined : value;
}

/** Checkbox/switch semantics: present and 'on' (or 'true') means checked. */
export function formBoolean(data: FormData, name: string): boolean {
  const value = data.get(name);
  return value === 'on' || value === 'true';
}

/** Every string value submitted under `name` (checkbox groups). */
export function formStrings(data: FormData, name: string): string[] {
  return data
    .getAll(name)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.slice(0, MAX_FORM_FIELD_LENGTH));
}

/** The submitted value when it is one of `allowed`, otherwise undefined. */
export function formEnum<T extends string>(
  data: FormData,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = formString(data, name);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
