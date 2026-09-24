/**
 * Custom ids: `namespace:action[:arg…]`. Discord caps custom ids at 100
 * characters. Arguments must not contain ':'. Custom ids are routing hints,
 * not authority — every handler re-authorizes the clicking user.
 */
export const CUSTOM_ID_MAX = 100;
const SEPARATOR = ':';

export function customId(namespace: string, action: string, ...args: (string | number)[]): string {
  const parts = [namespace, action, ...args.map(String)];
  for (const part of parts) {
    if (part.includes(SEPARATOR))
      throw new Error(`custom id part contains '${SEPARATOR}': ${part}`);
  }
  const id = parts.join(SEPARATOR);
  if (id.length > CUSTOM_ID_MAX) throw new Error(`custom id too long (${id.length}): ${id}`);
  return id;
}

export function parseCustomId(
  id: string,
): { namespace: string; action: string; args: string[] } | null {
  const [namespace, action, ...args] = id.split(SEPARATOR);
  if (!namespace || !action) return null;
  return { namespace, action, args };
}
