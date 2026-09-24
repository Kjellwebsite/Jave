import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function base32(bytes: Buffer, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

/** Correlates a single request/interaction across logs, audit and jobs. */
export function newRequestId(): string {
  return `req_${base32(randomBytes(16), 16)}`;
}

/** Short reference shown to users when something unexpected fails. */
export function newErrorId(): string {
  return `E-${base32(randomBytes(8), 8)}`;
}

/** Discord snowflake → creation time. */
export function snowflakeToDate(snowflake: string): Date {
  const DISCORD_EPOCH = 1420070400000n;
  return new Date(Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH));
}

export function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function formatNumber(prefix: string, value: number, width = 4): string {
  return `${prefix}-${String(value).padStart(width, '0')}`;
}
