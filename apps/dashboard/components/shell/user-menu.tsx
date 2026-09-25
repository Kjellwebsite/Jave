'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { ChevronDown, ExternalLink, LogOut, SlidersHorizontal, UserRound } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  RoleBadge,
} from '@jave/ui';
import { signOutAction } from '@/server/actions/auth';
import type { Viewer } from '@/server/data/viewer';

export function UserMenu({ viewer }: { viewer: Viewer }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu for ${viewer.displayName}`}
            className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 transition-colors hover:bg-surface-raised data-[state=open]:bg-surface-raised"
          >
            <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="sm" />
            <span className="hidden max-w-40 truncate text-small text-fg-muted md:block">
              {viewer.displayName}
            </span>
            <Icon icon={ChevronDown} size="sm" className="text-fg-subtle" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-1.5 normal-case tracking-normal">
            <span className="truncate font-sans text-small text-fg">{viewer.displayName}</span>
            <span className="flex items-center gap-2">
              {viewer.primaryRole ? <RoleBadge role={viewer.primaryRole} size="sm" /> : null}
              {viewer.handle ? (
                <span className="type-data truncate text-[11px] text-fg-subtle">
                  @{viewer.handle}
                </span>
              ) : null}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/me">
              <Icon icon={UserRound} />
              My profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/me?tab=preferences">
              <Icon icon={SlidersHorizontal} />
              Preferences
            </Link>
          </DropdownMenuItem>
          {viewer.handle ? (
            <DropdownMenuItem asChild>
              <Link href={`/p/${viewer.handle}`}>
                <Icon icon={ExternalLink} />
                Public profile
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={(event) => {
              event.preventDefault();
              signOutForm.current?.requestSubmit();
            }}
          >
            <Icon icon={LogOut} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={signOutForm} action={signOutAction} hidden />
    </>
  );
}
