'use client';

import { ExternalLink, Link2, Plus } from 'lucide-react';
import { Button, EmptyState, Icon, Input, Mono } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { InlineAction } from '../forms/inline-action';

export interface LinkRow {
  id: string;
  label: string;
  /** Already checked to be http(s); null when it is not safe to render as a link. */
  href: string | null;
  host: string;
}

export interface LinkManagerProps {
  projectId: string;
  links: readonly LinkRow[];
  canEdit: boolean;
  max: number;
  actions: { add: FormAction; remove: FormAction };
}

const LABEL_MAX = 48;
const URL_MAX = 2048;

/** Project links (docs, demos, papers). External links open in a new tab without referrer. */
export function LinkManager({ projectId, links, canEdit, max, actions }: LinkManagerProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-subtle">
          Docs, demos, papers. http(s) only.{' '}
          <Mono dim>
            {links.length}/{max}
          </Mono>
        </p>
        {canEdit && links.length < max ? (
          <ConfirmActionDialog
            eyebrow="LINKS"
            title="Add link"
            description="Shown on the project page to everyone who can see the project."
            confirmLabel="Add link"
            action={actions.add}
            hidden={{ projectId }}
            trigger={
              <Button variant="secondary" iconLeft={Plus} data-testid="add-link">
                Add link
              </Button>
            }
          >
            <FormField name="label" label="Label" required>
              <Input name="label" required maxLength={LABEL_MAX} placeholder="Design review" />
            </FormField>
            <FormField name="url" label="URL" required>
              <Input
                name="url"
                type="url"
                inputMode="url"
                required
                maxLength={URL_MAX}
                placeholder="https://"
                mono
              />
            </FormField>
          </ConfirmActionDialog>
        ) : null}
      </div>
      {links.length === 0 ? (
        <EmptyState compact icon={Link2} title="NO LINKS" description="Nothing linked yet." />
      ) : (
        <ul
          aria-label="Links"
          className="divide-y divide-line-subtle rounded-lg border border-line bg-surface"
        >
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                {link.href ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex max-w-full items-center gap-1.5 text-body text-fg hover:underline"
                  >
                    <span className="truncate">{link.label}</span>
                    <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
                  </a>
                ) : (
                  <span className="text-body text-fg">{link.label}</span>
                )}
                <Mono dim className="block truncate text-[12px]">
                  {link.host}
                </Mono>
              </div>
              {canEdit ? (
                <InlineAction
                  action={actions.remove}
                  hidden={{ projectId, linkId: link.id }}
                  label="Remove"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
