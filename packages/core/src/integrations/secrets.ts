import type { ServiceContext } from '../kernel/context';
import { decryptSecret, encryptSecret, randomToken } from '../kernel/crypto';
import { DisabledError } from '../kernel/errors';
import { SIGNING_SECRET_BYTES, SIGNING_SECRET_PREFIX } from './constants';

const ENCRYPTION_KEY_BYTES = 32;

/**
 * The AES-256-GCM key for secrets at rest (JAVE_ENCRYPTION_KEY, 32 bytes,
 * base64). Without it JAVE refuses to create or use signed integrations
 * rather than storing secrets in the clear.
 */
export function requireEncryptionKey(ctx: ServiceContext): string {
  const key = ctx.config.encryptionKey;
  if (!key || Buffer.from(key, 'base64').length !== ENCRYPTION_KEY_BYTES) {
    throw new DisabledError('Signed integrations (JAVE_ENCRYPTION_KEY required)');
  }
  return key;
}

export function generateSigningSecret(): string {
  return `${SIGNING_SECRET_PREFIX}${randomToken(SIGNING_SECRET_BYTES)}`;
}

export function sealSecret(ctx: ServiceContext, plaintext: string): string {
  return encryptSecret(plaintext, requireEncryptionKey(ctx));
}

export function openSecret(ctx: ServiceContext, ciphertext: string): string {
  return decryptSecret(ciphertext, requireEncryptionKey(ctx));
}
