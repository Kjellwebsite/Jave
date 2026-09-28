import { isSameOriginRequest } from '@/lib/request-security';
import { getRequestContext, isUserContext } from '@/server/context';
import { DOWNLOAD_STATUS, jsonError, readSmallForm } from '@/server/download';
import { MAX_PRIVACY_FORM_BYTES, memberExportResponse } from '@/server/privacy/export';
import { trustedOrigins } from '@/server/request';

/**
 * POST /me/export — download your own data (JSON). A POST, not a GET: every
 * export is audited and rate-limited, so a cross-site link must not be able
 * to trigger one. Same-origin check, live session, then core decides.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request.headers, trustedOrigins())) {
    return jsonError(DOWNLOAD_STATUS.forbidden, 'Request origin rejected.');
  }
  const { ctx, session } = await getRequestContext();
  if (!session || !isUserContext(ctx)) {
    return jsonError(DOWNLOAD_STATUS.unauthorized, 'Your session has ended. Sign in again.');
  }
  const form = await readSmallForm(request, MAX_PRIVACY_FORM_BYTES);
  if (form instanceof Response) return form;
  return memberExportResponse(ctx, {});
}
