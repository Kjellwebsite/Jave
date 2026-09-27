'use client';

import { Archive, ArchiveRestore } from 'lucide-react';
import { Button, Input } from '@jave/ui';
import { ActionForm, type FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const REPO_MAX = 200;
const REASON_MIN = 3;
const REASON_MAX = 500;

/** Link (or clear to unlink) the GitHub repository whose webhooks feed this project. */
export function RepoLinkForm({
  projectId,
  repo,
  action,
}: {
  projectId: string;
  repo: string | null;
  action: FormAction;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={repo ? 'Save repository' : 'Link repository'}
      submitVariant="secondary"
      aria-label="GitHub repository"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <FormField
        name="repo"
        label="Repository"
        description="owner/name or a github.com URL. Leave empty to unlink. You need a staff-verified GitHub account that owns the namespace; staff link organization repositories."
      >
        <Input
          name="repo"
          defaultValue={repo ?? ''}
          maxLength={REPO_MAX}
          placeholder="owner/name"
          mono
          autoComplete="off"
        />
      </FormField>
    </ActionForm>
  );
}

export function ArchiveControl({
  projectId,
  projectTitle,
  action,
}: {
  projectId: string;
  projectTitle: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="LIFECYCLE"
      title="Archive project"
      description={`${projectTitle} is frozen: no edits, links, milestones or membership changes. Members can still leave. Only staff can restore it.`}
      confirmLabel="Archive project"
      tone="danger"
      action={action}
      hidden={{ projectId }}
      trigger={
        <Button variant="danger" iconLeft={Archive} data-testid="archive-project">
          Archive project
        </Button>
      }
    />
  );
}

export function UnarchiveControl({
  projectId,
  projectTitle,
  action,
}: {
  projectId: string;
  projectTitle: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="LIFECYCLE"
      title="Restore project"
      description={`${projectTitle} returns to the status it was archived from. Recorded in the audit log.`}
      confirmLabel="Restore project"
      action={action}
      hidden={{ projectId }}
      trigger={
        <Button variant="secondary" iconLeft={ArchiveRestore} data-testid="unarchive-project">
          Restore project
        </Button>
      }
    >
      <FormField
        name="reason"
        label="Reason"
        description="Required. Recorded in the audit log."
        required
      >
        <Input
          name="reason"
          required
          minLength={REASON_MIN}
          maxLength={REASON_MAX}
          autoComplete="off"
        />
      </FormField>
    </ConfirmActionDialog>
  );
}
