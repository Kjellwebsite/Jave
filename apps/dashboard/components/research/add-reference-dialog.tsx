'use client';

import { Plus } from 'lucide-react';
import { Button, Input, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Core's field limits (research/constants.ts). */
const LIMITS = { title: 300, url: 2048, doi: 200, arxiv: 64, topic: 80, tags: 400, summary: 4000 };

/** Add a reference by hand. Duplicates (same DOI, arXiv ID or URL) open the existing item. */
export function AddReferenceDialog({ action }: { action: FormAction }) {
  return (
    <ConfirmActionDialog
      eyebrow="RESEARCH"
      title="Add reference"
      description="Give at least a title, URL, DOI or arXiv ID. It enters the library as NEW; metadata is looked up automatically and a reviewer sets its evidence level."
      confirmLabel="Add to library"
      action={action}
      trigger={
        <Button variant="primary" iconLeft={Plus} data-testid="add-reference">
          Add reference
        </Button>
      }
    >
      <FormField name="title" label="Title">
        <Input name="title" maxLength={LIMITS.title} autoComplete="off" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="doi" label="DOI">
          <Input name="doi" maxLength={LIMITS.doi} placeholder="10.1038/…" mono autoComplete="off" />
        </FormField>
        <FormField name="arxivId" label="arXiv ID">
          <Input
            name="arxivId"
            maxLength={LIMITS.arxiv}
            placeholder="2401.01234"
            mono
            autoComplete="off"
          />
        </FormField>
      </div>
      <FormField name="url" label="Link" description="http(s) only.">
        <Input name="url" type="url" maxLength={LIMITS.url} placeholder="https://…" autoComplete="off" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="topic" label="Topic">
          <Input name="topic" maxLength={LIMITS.topic} autoComplete="off" />
        </FormField>
        <FormField name="tags" label="Tags" description="Comma separated.">
          <Input name="tags" maxLength={LIMITS.tags} autoComplete="off" />
        </FormField>
      </div>
      <FormField name="summary" label="Summary">
        <Textarea name="summary" maxLength={LIMITS.summary} rows={3} />
      </FormField>
    </ConfirmActionDialog>
  );
}
