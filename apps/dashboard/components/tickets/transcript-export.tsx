'use client';

import { type FormEvent, useId, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Callout, Checkbox, Mono, NativeSelect } from '@jave/ui';
import { type DownloadError, postForDownload } from '@/lib/download';
import { useToast } from '../toast';

const FORMAT_OPTIONS = [
  { value: 'html', label: 'HTML — self-contained, printable' },
  { value: 'markdown', label: 'Markdown' },
];

const FALLBACK = {
  filename: 'ticket-transcript',
  message: 'The transcript could not be exported. Reload and try again.',
};

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
  const [error, setError] = useState<DownloadError | null>(null);

  async function exportTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const failure = await postForDownload(
      `/tickets/${ticketId}/transcript`,
      event.currentTarget,
      FALLBACK,
    );
    setPending(false);
    if (failure) setError(failure);
    else toast({ text: `TRANSCRIPT EXPORTED — ${reference}.`, tone: 'success' });
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
