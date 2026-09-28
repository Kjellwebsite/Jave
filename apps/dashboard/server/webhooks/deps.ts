import 'server-only';
import { clientIp } from '@/lib/request-security';
import { hashClientIp } from '../auth/tokens';
import { baseContext } from '../context';
import { getRuntime } from '../runtime';
import type { InboundWebhookDeps } from './inbound';

/**
 * Production dependencies for the inbound webhook routes: an anonymous
 * context (no session cookie is ever read), the deployment's GitHub secret,
 * and a keyed hash of the sender's address for rate limiting.
 */
export function webhookDeps(request: Request): InboundWebhookDeps {
  const { env } = getRuntime();
  return {
    ctx: baseContext(),
    githubSecret: env.GITHUB_WEBHOOK_SECRET,
    clientKey: hashClientIp(clientIp(request.headers), env.JAVE_SESSION_SECRET),
  };
}
