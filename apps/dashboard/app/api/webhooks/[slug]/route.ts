import { webhookDeps } from '@/server/webhooks/deps';
import { handleInboundWebhook } from '@/server/webhooks/inbound';

export const dynamic = 'force-dynamic';

/** Inbound webhook endpoint for every registered integration. Signature-authenticated only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleInboundWebhook(request, slug, webhookDeps(request));
}
