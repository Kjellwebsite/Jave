import { webhookDeps } from '@/server/webhooks/deps';
import { handleInboundWebhook } from '@/server/webhooks/inbound';

export const dynamic = 'force-dynamic';

/** The integration registered with slug "github" (GitHub signature scheme). */
const GITHUB_SLUG = 'github';

/** GitHub webhook endpoint. Authenticated by X-Hub-Signature-256 only. */
export async function POST(request: Request): Promise<Response> {
  return handleInboundWebhook(request, GITHUB_SLUG, webhookDeps(request));
}
