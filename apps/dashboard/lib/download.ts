/**
 * Browser helpers for POST-then-download routes (transcripts, data exports):
 * read the server's error message, or save the returned file.
 */

/** `name.ext` from Content-Disposition; server-built, but still checked. */
export const DOWNLOAD_FILENAME = /filename="([\w.-]+)"/;
/** Revoking the object URL in the same tick can cancel the download in some browsers. */
const REVOKE_DELAY_MS = 10_000;

export interface DownloadError {
  message: string;
  reference?: string;
}

export async function downloadErrorOf(
  response: Response,
  fallback: string,
): Promise<DownloadError> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      const reference =
        'reference' in body && typeof body.reference === 'string' ? body.reference : undefined;
      return { message: body.message, reference };
    }
  }
  return { message: fallback };
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * POST the form to `url`; save the attachment it returns, or return the error
 * to show. Network failures come back as an error too.
 */
export async function postForDownload(
  url: string,
  form: HTMLFormElement,
  fallback: { filename: string; message: string },
): Promise<DownloadError | null> {
  const body = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') body.set(key, value);
  }
  try {
    const response = await fetch(url, { method: 'POST', body, credentials: 'same-origin' });
    const disposition = response.headers.get('content-disposition') ?? '';
    if (!response.ok || !disposition.startsWith('attachment')) {
      return downloadErrorOf(response, fallback.message);
    }
    saveBlob(await response.blob(), DOWNLOAD_FILENAME.exec(disposition)?.[1] ?? fallback.filename);
    return null;
  } catch {
    return { message: 'The network request failed. Check your connection and try again.' };
  }
}
