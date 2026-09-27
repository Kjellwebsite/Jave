import { isSameOriginRequest } from '@/lib/request-security';
import { getRequestContext, isUserContext } from '@/server/context';
import { trustedOrigins } from '@/server/request';
import {
  EXPORT_STATUS,
  jsonError,
  readTranscriptForm,
  transcriptResponse,
} from '@/server/tickets/transcript';

/**
 * POST /tickets/:id/transcript — download a transcript (HTML or Markdown).
 * A POST, not a GET: every export is audited, so a cross-site link must not
 * be able to trigger one. Same-origin check, live session, then core decides.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOriginRequest(request.headers, trustedOrigins())) {
    return jsonError(EXPORT_STATUS.forbidden, 'Request origin rejected.');
  }
  const { ctx, session } = await getRequestContext();
  if (!session || !isUserContext(ctx)) {
    return jsonError(EXPORT_STATUS.unauthorized, 'Your session has ended. Sign in again.');
  }
  const form = await readTranscriptForm(request);
  if (form instanceof Response) return form;
  const { id } = await params;
  return transcriptResponse(ctx, { ticketId: id, ...form });
}
