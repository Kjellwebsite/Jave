import 'server-only';
import {
  ForbiddenError,
  isJaveError,
  isUuid,
  newErrorId,
  NotFoundError,
  type ServiceContext,
  tickets,
  UnauthenticatedError,
} from '@jave/core';

export const TRANSCRIPT_FORMATS = ['html', 'markdown'] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/** The export form carries two short fields; anything larger is not ours. */
export const MAX_EXPORT_BODY_BYTES = 2048;

const HTTP = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  tooLarge: 413,
  serverError: 500,
} as const;

/**
 * Headers for a downloaded transcript: always an attachment, never cached,
 * never sniffed, and inert if a browser renders it anyway (the HTML carries
 * its own CSP too).
 */
function downloadHeaders(contentType: string, filename: string): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Referrer-Policy': 'no-referrer',
  });
}

export function jsonError(status: number, message: string, reference?: string): Response {
  return Response.json(
    { message, ...(reference ? { reference } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export interface TranscriptRequest {
  ticketId: string;
  format: string;
  includeInternal: boolean;
}

function statusFor(error: unknown): number {
  if (error instanceof NotFoundError) return HTTP.notFound;
  if (error instanceof ForbiddenError) return HTTP.forbidden;
  if (error instanceof UnauthenticatedError) return HTTP.unauthorized;
  return HTTP.badRequest;
}

/**
 * Render and return a transcript as the signed-in user. Core authorizes
 * (opener without internal notes, or a ticket manager), audits the access
 * and records it on the ticket timeline. A ticket the caller may not see is
 * a 404, like a ticket that does not exist.
 */
export async function transcriptResponse(
  ctx: ServiceContext,
  request: TranscriptRequest,
): Promise<Response> {
  if (!isUuid(request.ticketId)) return jsonError(HTTP.notFound, 'Ticket not found.');
  const format = TRANSCRIPT_FORMATS.find((candidate) => candidate === request.format);
  if (!format) return jsonError(HTTP.badRequest, 'Choose HTML or Markdown.');
  try {
    const transcript = await tickets.renderTranscript(ctx, {
      ticketId: request.ticketId,
      format,
      includeInternal: request.includeInternal,
    });
    return new Response(transcript.content, {
      status: 200,
      headers: downloadHeaders(transcript.contentType, transcript.filename),
    });
  } catch (error) {
    if (isJaveError(error)) return jsonError(statusFor(error), error.userMessage);
    const reference = newErrorId();
    ctx.logger.error({ err: error, reference }, 'transcript export failed');
    return jsonError(
      HTTP.serverError,
      'The transcript could not be exported. If it keeps failing, report the reference.',
      reference,
    );
  }
}

/** Read the export form, refusing oversized or malformed bodies before parsing. */
export async function readTranscriptForm(
  request: Request,
): Promise<{ format: string; includeInternal: boolean } | Response> {
  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isInteger(length) || length < 0 || length > MAX_EXPORT_BODY_BYTES) {
    return jsonError(HTTP.tooLarge, 'Request too large.');
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(HTTP.badRequest, 'Malformed request.');
  }
  const format = form.get('format');
  const internal = form.get('internal');
  return {
    format: typeof format === 'string' ? format : '',
    includeInternal: internal === 'on' || internal === 'true',
  };
}

export const EXPORT_STATUS = HTTP;
