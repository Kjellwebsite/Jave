import 'server-only';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '@jave/core';

/** HTTP statuses the download routes answer with. */
export const DOWNLOAD_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  tooLarge: 413,
  tooManyRequests: 429,
  serverError: 500,
} as const;

/**
 * Headers for a downloaded file: always an attachment, never cached, never
 * sniffed, and inert if a browser renders it anyway.
 */
export function downloadHeaders(contentType: string, filename: string): Headers {
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

/** The status for a domain error a download route surfaces to the browser. */
export function statusForError(error: unknown): number {
  if (error instanceof NotFoundError) return DOWNLOAD_STATUS.notFound;
  if (error instanceof ForbiddenError) return DOWNLOAD_STATUS.forbidden;
  if (error instanceof UnauthenticatedError) return DOWNLOAD_STATUS.unauthorized;
  if (error instanceof RateLimitedError) return DOWNLOAD_STATUS.tooManyRequests;
  if (error instanceof ValidationError) return DOWNLOAD_STATUS.badRequest;
  return DOWNLOAD_STATUS.badRequest;
}

/**
 * Read a small urlencoded or multipart form, refusing oversized or malformed
 * bodies before parsing.
 */
export async function readSmallForm(
  request: Request,
  maxBytes: number,
): Promise<FormData | Response> {
  const declared = request.headers.get('content-length');
  const length = declared === null ? Number.NaN : Number(declared);
  if (!Number.isInteger(length) || length < 0 || length > maxBytes) {
    return jsonError(DOWNLOAD_STATUS.tooLarge, 'Request too large.');
  }
  try {
    return await request.formData();
  } catch {
    return jsonError(DOWNLOAD_STATUS.badRequest, 'Malformed request.');
  }
}
