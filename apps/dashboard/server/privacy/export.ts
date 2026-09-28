import 'server-only';
import { isJaveError, isUuid, newErrorId, privacy, type ServiceContext } from '@jave/core';
import { DOWNLOAD_STATUS, downloadHeaders, jsonError, statusForError } from '../download';

/** The export forms carry at most a reason; anything larger is not ours. */
export const MAX_PRIVACY_FORM_BYTES = 2048;

/**
 * A member's data as a JSON download, built by core as the signed-in user:
 * your own, or (founders, with a reason) someone else's. Core authorizes,
 * rate-limits and audits every export.
 */
export async function memberExportResponse(
  ctx: ServiceContext,
  request: { memberId?: string; reason?: string },
): Promise<Response> {
  if (request.memberId !== undefined && !isUuid(request.memberId)) {
    return jsonError(DOWNLOAD_STATUS.notFound, 'Member not found.');
  }
  try {
    const document = await privacy.exportMemberData(ctx, request);
    return new Response(JSON.stringify(document, null, 2), {
      status: DOWNLOAD_STATUS.ok,
      headers: downloadHeaders('application/json; charset=utf-8', privacy.exportFileName(document)),
    });
  } catch (error) {
    if (isJaveError(error)) return jsonError(statusForError(error), error.userMessage);
    const reference = newErrorId();
    ctx.logger.error({ err: error, reference }, 'member data export failed');
    return jsonError(
      DOWNLOAD_STATUS.serverError,
      'The export did not complete. If it keeps failing, report the reference.',
      reference,
    );
  }
}
