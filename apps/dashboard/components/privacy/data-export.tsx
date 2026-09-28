'use client';

import { type FormEvent, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Callout, Mono, Textarea } from '@jave/ui';
import { type DownloadError, postForDownload } from '@/lib/download';
import { FormField } from '../forms/form-field';
import { useToast } from '../toast';

/**
 * Download a member's data as JSON. Core authorizes, rate-limits and audits
 * every export; a founder exporting someone else's data gives a reason.
 */
export function DataExport({
  url,
  requireReason = false,
  label = 'Download my data',
}: {
  url: string;
  requireReason?: boolean;
  label?: string;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DownloadError | null>(null);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const failure = await postForDownload(url, event.currentTarget, {
      filename: 'jave-export.json',
      message: 'The export did not complete. Reload and try again.',
    });
    setPending(false);
    if (failure) setError(failure);
    else toast({ text: 'DATA EXPORTED — the file is in your downloads.', tone: 'success' });
  }

  return (
    <form
      method="post"
      action={url}
      onSubmit={(event) => void download(event)}
      aria-label={label}
      className="space-y-4"
    >
      {requireReason ? (
        <FormField
          name="reason"
          label="Reason"
          description="Required. The data-subject request this answers; recorded in the audit log."
          required
        >
          <Textarea name="reason" required minLength={3} maxLength={500} rows={2} />
        </FormField>
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
        data-testid="export-data"
      >
        {label}
      </Button>
    </form>
  );
}
