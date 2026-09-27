'use client';

import { Archive, Upload } from 'lucide-react';
import { Button, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useAnnouncedAction } from '../forms/announced-action';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const MAX_REASON_LENGTH = 1000;

export interface ItemActionsProps {
  itemId: string;
  canArchive: boolean;
  canPush: boolean;
  archiveAction: FormAction;
  pushAction: FormAction;
}

/** Push a verified item to Sidus (reviewers) and archive (submitter or reviewer). */
export function ItemActions({ itemId, canArchive, canPush, archiveAction, pushAction }: ItemActionsProps) {
  // ARCHIVE disappears once the item is archived: announce its result directly.
  const archive = useAnnouncedAction(archiveAction);
  if (!canArchive && !canPush) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canArchive ? (
        <ConfirmActionDialog
          eyebrow="RESEARCH"
          title="Archive item"
          description="It leaves the library for everyone but its submitter and reviewers. A reviewer can restore it to NEEDS REVIEW."
          confirmLabel="Archive item"
          tone="danger"
          action={archive}
          hidden={{ itemId }}
          trigger={
            <Button variant="ghost" iconLeft={Archive} data-testid="archive-item">
              Archive
            </Button>
          }
        >
          <FormField name="reason" label="Reason" description="Optional. Recorded in the audit log.">
            <Textarea name="reason" maxLength={MAX_REASON_LENGTH} rows={3} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {canPush ? (
        <ConfirmActionDialog
          eyebrow="SIDUS SCIENCE"
          title="Push to Sidus"
          description="Sends the verified reference — never member identity or Discord links — to SIDUS SCIENCE. Without Sidus credentials it is recorded as not synced."
          confirmLabel="Push to Sidus"
          action={pushAction}
          hidden={{ itemId }}
          trigger={
            <Button variant="secondary" iconLeft={Upload} data-testid="push-sidus">
              Push to Sidus
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
