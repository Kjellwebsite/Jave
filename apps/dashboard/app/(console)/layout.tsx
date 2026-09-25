import type { ReactNode } from 'react';
import { listMyNotifications } from '@jave/core';
import { ConsoleShell } from '@/components/shell/console-shell';
import { isDevAuthEnabled } from '@/server/auth/dev-auth';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { getRuntime } from '@/server/runtime';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const { ctx } = await requireConsoleContext();
  const [viewer, inbox] = await Promise.all([
    loadViewer(ctx),
    listMyNotifications(ctx, { unreadOnly: true, limit: 1 }),
  ]);
  return (
    <ConsoleShell
      viewer={viewer}
      unread={inbox.unread}
      devAuth={isDevAuthEnabled(getRuntime().env)}
    >
      {children}
    </ConsoleShell>
  );
}
