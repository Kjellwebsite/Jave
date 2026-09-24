import type { ReactNode } from 'react';
import { Badge } from '@jave/ui';
import { ToastProvider } from '../toast';
import type { Viewer } from '@/server/data/viewer';
import { BrandLockup } from './brand-lockup';
import { SidebarNav } from './sidebar-nav';
import { TopBar } from './top-bar';

export interface ConsoleShellProps {
  viewer: Viewer;
  unread: number;
  devAuth: boolean;
  children: ReactNode;
}

/** Sidebar (desktop) + top bar + content column. The sidebar becomes a sheet below `lg`. */
export function ConsoleShell({ viewer, unread, devAuth, children }: ConsoleShellProps) {
  return (
    <ToastProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-surface-raised px-3 py-2 text-small text-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <div className="hidden border-r border-line-subtle bg-surface-sunken lg:block">
          <aside className="sticky top-0 flex h-dvh flex-col">
            <div className="px-3 pb-2 pt-5">
              <BrandLockup />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav capabilities={viewer.capabilities} />
            </div>
            <div className="flex items-center justify-between border-t border-line-subtle px-5 py-3.5">
              <span className="type-data text-[11px] text-fg-subtle">JAVE v0.1</span>
              {devAuth ? <Badge tone="warning">DEV AUTH</Badge> : null}
            </div>
          </aside>
        </div>
        <div className="flex min-w-0 flex-col">
          <TopBar viewer={viewer} unread={unread} devAuth={devAuth} />
          <main
            id="main"
            className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-8 sm:px-6 lg:px-10 lg:pt-10"
          >
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
