'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Bell, Menu } from 'lucide-react';
import {
  Badge,
  buttonStyles,
  cx,
  Emblem,
  Icon,
  IconButton,
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@jave/ui';
import { navContext } from '@/lib/nav';
import type { Viewer } from '@/server/data/viewer';
import { BrandLockup } from './brand-lockup';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

const MAX_BADGE_COUNT = 99;

export interface TopBarProps {
  viewer: Viewer;
  unread: number;
  devAuth: boolean;
}

export function TopBar({ viewer, unread, devAuth }: TopBarProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const context = navContext(pathname);
  const unreadLabel = unread > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(unread);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line-subtle bg-canvas/85 px-3 backdrop-blur-md sm:px-6 lg:px-10">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <IconButton icon={Menu} label="Open navigation" className="lg:hidden" />
        </SheetTrigger>
        <SheetContent title="Navigation" hideTitle>
          <div className="border-b border-line-subtle px-3 py-4">
            <BrandLockup />
          </div>
          <SidebarNav capabilities={viewer.capabilities} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <Link href="/overview" aria-label="JAVELIN — overview" className="mr-1 lg:hidden">
        <Emblem size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        {context ? (
          <p className="flex min-w-0 items-center gap-2">
            {context.group !== context.label.toUpperCase() ? (
              <>
                <span className="type-eyebrow hidden text-fg-subtle sm:inline">
                  {context.group}
                </span>
                <span aria-hidden className="hidden text-fg-faint sm:inline">
                  /
                </span>
              </>
            ) : null}
            <span className="truncate text-small font-medium text-fg">{context.label}</span>
          </p>
        ) : null}
      </div>
      {devAuth ? (
        <span className="hidden sm:block">
          <Badge tone="warning" title="Dev login is enabled (MOCK / DEVELOPMENT ONLY)">
            DEV AUTH
          </Badge>
        </span>
      ) : null}
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className={cx(buttonStyles({ variant: 'ghost' }), 'relative size-9 px-0')}
      >
        <Icon icon={Bell} />
        {unread > 0 ? (
          <span
            data-testid="unread-count"
            className="absolute right-0.5 top-0.5 h-4 min-w-4 rounded-full bg-fg px-1 text-center font-mono text-[10px] font-semibold leading-4 text-fg-inverse"
          >
            {unreadLabel}
          </span>
        ) : null}
      </Link>
      <UserMenu viewer={viewer} />
    </header>
  );
}
