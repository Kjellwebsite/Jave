import { LogOut } from 'lucide-react';
import { Button, Mono, StatusBadge } from '@jave/ui';
import { describeUserAgent } from '@/lib/user-agent';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';

export interface SessionRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  current: boolean;
}

/** Your live dashboard sessions, with a way to end any of them, or all. */
export function SessionList({
  sessions,
  timeZone,
  endAction,
  endAllAction,
}: {
  sessions: readonly SessionRow[];
  timeZone: string;
  endAction: FormAction;
  endAllAction: FormAction;
}) {
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface">
        {sessions.map((session) => (
          <li
            key={session.id}
            data-session-row
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-body text-fg">
                {describeUserAgent(session.userAgent)}
                {session.current ? <StatusBadge tone="success" label="THIS BROWSER" /> : null}
              </p>
              <p className="mt-0.5 text-small text-fg-subtle">
                Signed in <Mono dim>{formatTimestamp(session.createdAt, timeZone)}</Mono> · last
                active <Mono dim>{formatTimestamp(session.lastSeenAt, timeZone)}</Mono>
              </p>
            </div>
            {session.current ? null : (
              <ConfirmActionDialog
                eyebrow="SESSIONS"
                title="End this session"
                description="That browser is signed out on its next request."
                confirmLabel="End session"
                action={endAction}
                hidden={{ sessionId: session.id }}
                trigger={
                  <Button size="sm" variant="ghost">
                    End
                  </Button>
                }
              />
            )}
          </li>
        ))}
      </ul>
      <ConfirmActionDialog
        eyebrow="SESSIONS"
        title="Sign out everywhere"
        description="Ends every session, this browser included. You sign in again with Discord."
        confirmLabel="Sign out everywhere"
        tone="danger"
        action={endAllAction}
        trigger={
          <Button variant="secondary" iconLeft={LogOut} data-testid="sign-out-everywhere">
            Sign out everywhere
          </Button>
        }
      />
    </div>
  );
}
