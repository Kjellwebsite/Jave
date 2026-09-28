import type { ReactNode } from 'react';
import { Button, cx, Input, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { DataExport } from './data-export';

function Section({
  title,
  danger = false,
  children,
}: {
  title: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cx(
        'machined relative max-w-3xl space-y-4 rounded-lg border bg-surface p-5',
        danger ? 'border-danger/35' : 'border-line',
      )}
    >
      <h2 className={cx('type-eyebrow', danger ? 'text-danger' : 'text-fg')}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Account security and privacy controls on a member's page: end their
 * sessions (account security), export their data and erase it (founders).
 * Every control calls core as the viewer; core decides.
 */
export function MemberPrivacy({
  memberId,
  memberName,
  handle,
  departed,
  holdsStaffRole,
  canEndSessions,
  canManagePrivacy,
  endSessionsAction,
  eraseAction,
}: {
  memberId: string;
  memberName: string;
  handle: string;
  departed: boolean;
  holdsStaffRole: boolean;
  canEndSessions: boolean;
  canManagePrivacy: boolean;
  endSessionsAction: FormAction;
  eraseAction: FormAction;
}) {
  const eraseBlocker = !departed
    ? `${memberName} is still in the server. They must leave, or be removed, before their data can be erased.`
    : holdsStaffRole
      ? `${memberName} holds a staff role. Revoke it first.`
      : null;
  return (
    <div className="space-y-6">
      {canEndSessions ? (
        <Section title="SESSIONS">
          <p className="text-small text-fg-muted">
            Signs {memberName} out of the dashboard everywhere, at once. Use it when an account may
            be compromised. Their Discord access is unaffected; quarantine for that.
          </p>
          <ConfirmActionDialog
            eyebrow="SESSIONS"
            title="End all sessions"
            description={`Every dashboard session of ${memberName} ends immediately.`}
            confirmLabel="End all sessions"
            tone="danger"
            action={endSessionsAction}
            hidden={{ memberId }}
            trigger={
              <Button variant="secondary" data-testid="end-member-sessions">
                End all sessions
              </Button>
            }
          >
            <FormField
              name="reason"
              label="Reason"
              description="Required. Recorded in the audit log."
              required
            >
              <Textarea name="reason" required minLength={3} maxLength={500} rows={3} />
            </FormField>
          </ConfirmActionDialog>
        </Section>
      ) : null}
      {canManagePrivacy ? (
        <>
          <Section title="DATA EXPORT">
            <p className="text-small text-fg-muted">
              A copy of what JAVE holds about {memberName}, as they would receive it themselves, for
              a data-subject request. Staff-only assessments are listed as counts, not content.
            </p>
            <DataExport
              url={`/members/${memberId}/export`}
              requireReason
              label="Export member data"
            />
          </Section>
          <Section title="ERASE PERSONAL DATA" danger>
            <div className="space-y-2 text-small text-fg-muted">
              <p>
                Removes {memberName}’s name, profile, the text they wrote (applications, claims,
                evidence, tickets, submissions), their sessions, notifications and linked accounts,
                and their name from records other people received.
              </p>
              <p>
                Kept, without their name: the Discord ID (so a ban still holds), moderation cases,
                rank history, trial results, application decisions and the audit log. Messages in
                Discord itself are not deleted. This cannot be undone.
              </p>
            </div>
            {eraseBlocker ? (
              <p className="text-small text-fg-subtle" data-testid="erase-blocked">
                {eraseBlocker}
              </p>
            ) : (
              <ConfirmActionDialog
                eyebrow="PRIVACY"
                title={`Erase ${memberName}’s personal data`}
                description="Irreversible. Type their handle to confirm."
                confirmLabel="Erase personal data"
                tone="danger"
                action={eraseAction}
                hidden={{ memberId }}
                trigger={
                  <Button variant="danger" data-testid="erase-member">
                    Erase personal data
                  </Button>
                }
              >
                <FormField
                  name="reason"
                  label="Reason"
                  description="Required. The request this answers; recorded in the audit log."
                  required
                >
                  <Textarea name="reason" required minLength={3} maxLength={500} rows={2} />
                </FormField>
                <FormField name="confirmHandle" label={`Type ${handle} to confirm`} required>
                  <Input name="confirmHandle" required autoComplete="off" spellCheck={false} mono />
                </FormField>
              </ConfirmActionDialog>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
