'use client';

import { Plus } from 'lucide-react';
import { Button, EmptyState, Mono, NativeSelect, RoleBadge, Textarea } from '@jave/ui';
import type { RoleKey } from '@jave/ui/roles';
import { roleVisual } from '@jave/ui/roles';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface RoleRow {
  role: RoleKey;
  description: string;
  /** Pre-formatted provenance line (staff viewers only), e.g. "2026-09-01 · Dev Founder". */
  provenance: string | null;
  reason: string | null;
}

export interface RoleManagerProps {
  memberId: string;
  memberName: string;
  roles: readonly RoleRow[];
  /** Roles the viewer may grant or revoke on this member (empty = read-only). */
  assignable: readonly RoleKey[];
  grantAction: FormAction;
  revokeAction: FormAction;
}

function ReasonField() {
  return (
    <FormField
      name="reason"
      label="Reason"
      description="Required. Recorded in the audit log."
      required
    >
      <Textarea name="reason" required minLength={3} maxLength={500} rows={3} />
    </FormField>
  );
}

export function GrantRoleDialog({
  memberId,
  memberName,
  grantable,
  grantAction,
}: {
  memberId: string;
  memberName: string;
  grantable: readonly RoleKey[];
  grantAction: FormAction;
}) {
  if (grantable.length === 0) return null;
  return (
    <ConfirmActionDialog
      eyebrow="ROLES"
      title="Grant role"
      description={`Grants a JAVELIN role to ${memberName}. Progression roles replace each other. Discord roles follow automatically.`}
      confirmLabel="Grant role"
      action={grantAction}
      hidden={{ memberId }}
      trigger={
        <Button variant="primary" iconLeft={Plus} data-testid="grant-role">
          Grant role
        </Button>
      }
    >
      <FormField name="role" label="Role" required>
        <NativeSelect
          name="role"
          defaultValue={grantable[0]}
          options={grantable.map((role) => ({ value: role, label: roleVisual(role).label }))}
        />
      </FormField>
      <ReasonField />
    </ConfirmActionDialog>
  );
}

/** Current roles with provenance, and grant/revoke for the roles the viewer may manage. */
export function RoleManager({
  memberId,
  memberName,
  roles,
  assignable,
  grantAction,
  revokeAction,
}: RoleManagerProps) {
  const held = new Set(roles.map((row) => row.role));
  const grantable = assignable.filter((role) => !held.has(role));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-subtle">
          {assignable.length > 0
            ? 'You can manage roles below your own. Every change requires a reason.'
            : 'Roles are read-only for you.'}
        </p>
        <GrantRoleDialog
          memberId={memberId}
          memberName={memberName}
          grantable={grantable}
          grantAction={grantAction}
        />
      </div>
      {roles.length === 0 ? (
        <EmptyState compact title="NO ROLES" description="This member holds no JAVELIN role." />
      ) : (
        <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface">
          {roles.map((row) => (
            <li
              key={row.role}
              data-role-row={row.role}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 px-5 py-4 sm:grid-cols-[128px_minmax(0,1fr)_auto]"
            >
              <div>
                <RoleBadge role={row.role} />
              </div>
              <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                <p className="text-small text-fg-muted">{row.description}</p>
                {row.provenance ? (
                  <p className="mt-0.5 text-small text-fg-subtle">
                    <Mono dim className="text-[12px]">
                      {row.provenance}
                    </Mono>
                    {row.reason ? <span> — {row.reason}</span> : null}
                  </p>
                ) : null}
              </div>
              {assignable.includes(row.role) ? (
                <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
                  <ConfirmActionDialog
                    eyebrow="ROLES"
                    title={`Revoke ${roleVisual(row.role).label}`}
                    description={`Removes ${roleVisual(row.role).label.toUpperCase()} from ${memberName}. Their access changes immediately.`}
                    confirmLabel="Revoke role"
                    tone="danger"
                    action={revokeAction}
                    hidden={{ memberId, role: row.role }}
                    trigger={
                      <Button size="sm" variant="ghost">
                        Revoke
                      </Button>
                    }
                  >
                    <ReasonField />
                  </ConfirmActionDialog>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
