'use client';

import Link from 'next/link';
import { Crown, LogOut, UserPlus } from 'lucide-react';
import { Avatar, Badge, Button, Callout, EmptyState, Input, Mono, NativeSelect } from '@jave/ui';
import { PROJECT_ROLE_LABELS, type ProjectRoleKey } from '@/lib/project-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface TeamMemberRow {
  memberId: string;
  handle: string;
  displayName: string;
  role: ProjectRoleKey;
  joinedLabel: string;
}

export interface TeamManagerProps {
  projectId: string;
  projectTitle: string;
  members: readonly TeamMemberRow[];
  hiddenMemberCount: number;
  viewerMemberId: string | null;
  viewerRole: ProjectRoleKey | null;
  /** Owner/maintainer/staff on a non-archived project. */
  canManage: boolean;
  /** Owner or staff on a non-archived project. */
  canAdmin: boolean;
  actions: {
    add: FormAction;
    changeRole: FormAction;
    remove: FormAction;
    transfer: FormAction;
    leave: FormAction;
  };
}

const ASSIGNABLE: readonly ProjectRoleKey[] = ['contributor', 'maintainer'];
const HANDLE_MAX = 64;
const REASON_MAX = 500;

function roleOptions(canAdmin: boolean) {
  return ASSIGNABLE.filter((role) => canAdmin || role === 'contributor').map((role) => ({
    value: role,
    label: PROJECT_ROLE_LABELS[role],
  }));
}

function AddMemberDialog({
  projectId,
  canAdmin,
  action,
}: {
  projectId: string;
  canAdmin: boolean;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="TEAM"
      title="Add member"
      description="They are notified and can leave at any time. Maintainers add contributors; owners also add maintainers."
      confirmLabel="Add member"
      action={action}
      hidden={{ projectId }}
      trigger={
        <Button variant="secondary" iconLeft={UserPlus} data-testid="add-member">
          Add member
        </Button>
      }
    >
      <FormField
        name="handle"
        label="Member handle"
        description="As shown on their profile, e.g. @mara."
        required
      >
        <Input
          name="handle"
          required
          maxLength={HANDLE_MAX}
          placeholder="@handle"
          mono
          autoComplete="off"
        />
      </FormField>
      <FormField name="role" label="Role" required>
        <NativeSelect name="role" defaultValue="contributor" options={roleOptions(canAdmin)} />
      </FormField>
    </ConfirmActionDialog>
  );
}

function MemberActions({ row, props }: { row: TeamMemberRow; props: TeamManagerProps }) {
  const { projectId, projectTitle, canAdmin, canManage, actions } = props;
  if (row.role === 'owner' || row.memberId === props.viewerMemberId) return null;
  const canRemove = canAdmin || (canManage && row.role === 'contributor');
  return (
    <div className="flex flex-wrap gap-1 pl-9 sm:justify-end sm:pl-0">
      {canAdmin ? (
        <ConfirmActionDialog
          eyebrow="TEAM"
          title={`Change role — ${row.displayName}`}
          description="Maintainers edit details, milestones and links, and add contributors."
          confirmLabel="Change role"
          action={actions.changeRole}
          hidden={{ projectId, memberId: row.memberId }}
          trigger={
            <Button size="sm" variant="ghost">
              Role
            </Button>
          }
        >
          <FormField name="role" label="Role" required>
            <NativeSelect name="role" defaultValue={row.role} options={roleOptions(true)} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {canAdmin ? (
        <ConfirmActionDialog
          eyebrow="TEAM"
          title="Transfer ownership"
          description={`${row.displayName} becomes the owner of ${projectTitle}. The current owner becomes a maintainer.`}
          confirmLabel="Transfer ownership"
          tone="danger"
          action={actions.transfer}
          hidden={{ projectId, memberId: row.memberId }}
          trigger={
            <Button size="sm" variant="ghost" iconLeft={Crown}>
              Make owner
            </Button>
          }
        />
      ) : null}
      {canRemove ? (
        <ConfirmActionDialog
          eyebrow="TEAM"
          title={`Remove ${row.displayName}`}
          description="They lose access to project management immediately. Their recorded contributions stay."
          confirmLabel="Remove member"
          tone="danger"
          action={actions.remove}
          hidden={{ projectId, memberId: row.memberId }}
          trigger={
            <Button size="sm" variant="ghost">
              Remove
            </Button>
          }
        >
          <FormField
            name="reason"
            label="Reason"
            description="Optional. Recorded in the audit log."
          >
            <Input name="reason" maxLength={REASON_MAX} autoComplete="off" />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

/** The team: owner first, then maintainers and contributors, with the viewer's controls. */
export function TeamManager(props: TeamManagerProps) {
  const {
    projectId,
    projectTitle,
    members,
    hiddenMemberCount,
    viewerRole,
    canManage,
    canAdmin,
    actions,
  } = props;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-subtle">
          {canManage
            ? 'Owners manage roles and ownership; maintainers add and remove contributors.'
            : 'The people building this project.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {viewerRole && viewerRole !== 'owner' ? (
            <ConfirmActionDialog
              eyebrow="TEAM"
              title="Leave project"
              description={`You leave ${projectTitle}. Your recorded contributions stay yours. A manager can add you again.`}
              confirmLabel="Leave project"
              tone="danger"
              action={actions.leave}
              hidden={{ projectId }}
              trigger={
                <Button variant="ghost" iconLeft={LogOut} data-testid="leave-project">
                  Leave
                </Button>
              }
            />
          ) : null}
          {canManage ? (
            <AddMemberDialog projectId={projectId} canAdmin={canAdmin} action={actions.add} />
          ) : null}
        </div>
      </div>
      {viewerRole === 'owner' ? (
        <Callout tone="neutral">Owners cannot leave. Transfer ownership first.</Callout>
      ) : null}
      {members.length === 0 ? (
        <EmptyState
          compact
          title="NO VISIBLE MEMBERS"
          description="Member profiles on this project are hidden from you."
        />
      ) : (
        <ul
          aria-label="Team"
          className="divide-y divide-line-subtle rounded-lg border border-line bg-surface"
        >
          {members.map((row) => (
            <li
              key={row.memberId}
              data-member={row.handle}
              className="grid gap-x-4 gap-y-2.5 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={row.displayName} size="md" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/p/${encodeURIComponent(row.handle)}`}
                      className="truncate text-body font-medium text-fg hover:underline"
                    >
                      {row.displayName}
                    </Link>
                    <Badge>{PROJECT_ROLE_LABELS[row.role]}</Badge>
                  </div>
                  <Mono dim className="text-[12px]">
                    @{row.handle} · joined {row.joinedLabel}
                  </Mono>
                </div>
              </div>
              <MemberActions row={row} props={props} />
            </li>
          ))}
        </ul>
      )}
      {hiddenMemberCount > 0 ? (
        <p className="text-small text-fg-subtle">
          +{hiddenMemberCount} {hiddenMemberCount === 1 ? 'member' : 'members'} with a hidden
          profile.
        </p>
      ) : null}
    </div>
  );
}
