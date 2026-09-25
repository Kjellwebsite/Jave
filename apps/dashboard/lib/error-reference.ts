/**
 * Error references. Server Components throw errors whose `digest` the browser
 * receives; the server logs the same error (with its stack) in
 * `instrumentation.ts`. Both sides derive the reference from the digest, so
 * the reference a user reports finds the exact log line.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const REFERENCE_LENGTH = 8;
const BITS_PER_CHAR = 5;
const CHARS_FROM_FIRST_HASH = 6;
const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;
const SECOND_SEED = 0x050c5d1f;

function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function referenceFromDigest(digest: string): string {
  const first = fnv1a(digest, FNV_OFFSET);
  const second = fnv1a(digest, SECOND_SEED);
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    const source = i < CHARS_FROM_FIRST_HASH ? first : second;
    const shift = (i < CHARS_FROM_FIRST_HASH ? i : i - CHARS_FROM_FIRST_HASH) * BITS_PER_CHAR;
    out += ALPHABET[(source >>> shift) & 31];
  }
  return `E-${out}`;
}
