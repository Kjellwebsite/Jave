export type ClassValue = string | false | null | undefined | 0;

/**
 * Join class names, skipping falsy values. Components are written so that
 * caller classes extend rather than fight the defaults, so no merge logic is needed.
 */
export function cx(...values: ClassValue[]): string {
  let out = '';
  for (const value of values) {
    if (!value) continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
