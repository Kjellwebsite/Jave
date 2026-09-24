import 'server-only';
import { headers } from 'next/headers';
import { hashClientIp } from './auth/tokens';
import { clientIp, isSameOriginRequest } from '@/lib/request-security';
import { getRuntime } from './runtime';

export function trustedOrigins(): string[] {
  return [new URL(getRuntime().env.JAVE_PUBLIC_URL).origin];
}

/** For Server Actions: rejects cross-origin invocations (defence in depth over Next's own check). */
export async function isTrustedMutationRequest(): Promise<boolean> {
  return isSameOriginRequest(await headers(), trustedOrigins());
}

/** Keyed hash of the caller's IP — for rate-limit keys and session metadata. */
export async function currentClientIpHash(): Promise<string> {
  return hashClientIp(clientIp(await headers()), getRuntime().env.JAVE_SESSION_SECRET);
}

export async function currentUserAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}
