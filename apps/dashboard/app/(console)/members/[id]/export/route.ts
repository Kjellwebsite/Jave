import { isSameOriginRequest } from '@/lib/request-security';
import { getRequestContext, isUserContext } from '@/server/context';
import { DOWNLOAD_STATUS, jsonError, readSmallForm } from '@/server/download';
import { MAX_PRIVACY_FORM_BYTES, memberExportResponse } from '@/server/privacy/export';
import { trustedOrigins } from '@/server/request';

/**
 * POST /members/:id/export — a founder downloads a member's data for a
 * data-subject request (reason required; core authorizes and audits).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOriginRequest(request.headers, trustedOrigins())) {
    return jsonError(DOWNLOAD_STATUS.forbidden, 'Request origin rejected.');
  }
  const { ctx, session } = await getRequestContext();
  if (!session || !isUserContext(ctx)) {
    return jsonError(DOWNLOAD_STATUS.unauthorized, 'Your session has ended. Sign in again.');
  }
  const form = await readSmallForm(request, MAX_PRIVACY_FORM_BYTES);
  if (form instanceof Response) return form;
  const reason = form.get('reason');
  const { id } = await params;
  return memberExportResponse(ctx, {
    memberId: id,
    reason: typeof reason === 'string' && reason.trim() ? reason : undefined,
  });
}
