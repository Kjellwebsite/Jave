'use client';

import { type FormEvent, useId, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Callout, Checkbox, Mono, NativeSelect } from '@jave/ui';
import { useToast } from '../toast';

const FORMAT_OPTIONS = [
  { value: 'html', label: 'HTML — self-contained, printable' },
  { value: 'markdown', label: 'Markdown' },
];

/** `ticket-0042.html` from Content-Disposition; server-built, but still checked. */
const FILENAME = /filename="([\w.-]+)"/;
const FALLBACK_FILENAME = 'ticket-transcript';
/** Revoking the object URL in the same tick can cancel the download in some browsers. */
const REVOKE_DELAY_MS = 10_000;

interface ExportError {
  message: string;
  reference?: string;
}

async function errorOf(response: Response): Promise<ExportError> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      const reference =
        'reference' in body && typeof body.reference === 'string' ? body.reference : undefined;
      return { message: body.message, reference };
    }
  }
  return { message: 'The transcript could not be exported. Reload and try again.' };
}

function saveBlob(blob: Blob, filename: string): void {
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
 * Download the transcript. Every export is audited by core and shows on the
 * timeline. The requester's export never contains internal notes; ticket
 * managers may include them.
 */
export function TranscriptExport({
  ticketId,
  reference,
  allowInternal,
}: {
  ticketId: string;
  reference: string;
  allowInternal: boolean;
}) {
  const id = useId();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ExportError | null>(null);

  async function exportTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string') body.set(key, value);
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/tickets/${ticketId}/transcript`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const disposition = response.headers.get('content-disposition') ?? '';
      if (!response.ok || !disposition.startsWith('attachment')) {
        setError(await errorOf(response));
        return;
      }
      const filename = FILENAME.exec(disposition)?.[1] ?? FALLBACK_FILENAME;
      saveBlob(await response.blob(), filename);
      toast({ text: `TRANSCRIPT EXPORTED — ${reference}.`, tone: 'success' });
    } catch {
      setError({ message: 'The network request failed. Check your connection and try again.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      method="post"
      action={`/tickets/${ticketId}/transcript`}
      onSubmit={(event) => void exportTranscript(event)}
      aria-label="Export transcript"
      className="space-y-4"
    >
      <NativeSelect
        name="format"
        aria-label="Format"
        defaultValue="html"
        options={FORMAT_OPTIONS}
      />
      {allowInternal ? (
        <Checkbox
          id={`${id}-internal`}
          name="internal"
          label="Include internal notes"
          description="Staff record: internal notes, deleted messages and edit history."
        />
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert">
          <span>{error.message}</span>
          {error.reference ? (
            <span className="mt-1 block">
              Reference <Mono className="select-all text-fg">{error.reference}</Mono>
            </span>
          ) : null}
        </Callout>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        iconLeft={Download}
        loading={pending}
        className="w-full"
        data-testid="export-transcript"
      >
        Export transcript
      </Button>
    </form>
  );
}
