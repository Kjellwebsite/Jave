import {
  Bell,
  ChartNoAxesColumn,
  LayoutGrid,
  type LucideIcon,
  ScrollText,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react';
import type { Capability } from '@jave/core';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to actors holding this capability. `null` = every signed-in user. */
  capability: Capability | null;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

/**
 * The console's information architecture. Adding a page is one line in its
 * group; groups without visible items are not rendered.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [{ href: '/overview', label: 'Overview', icon: LayoutGrid, capability: null }],
  },
  {
    label: 'PEOPLE',
    items: [
      { href: '/members', label: 'Members', icon: Users, capability: 'canViewMembers' },
      { href: '/ranking', label: 'Ranking', icon: ChartNoAxesColumn, capability: 'canViewMembers' },
    ],
  },
  { label: 'OPERATIONS', items: [] },
  { label: 'SUPPORT & SAFETY', items: [] },
  { label: 'INTELLIGENCE', items: [] },
  {
    label: 'SYSTEM',
    items: [
      { href: '/audit', label: 'Audit Log', icon: ScrollText, capability: 'canViewAuditLogs' },
      { href: '/settings', label: 'Settings', icon: Settings2, capability: 'canViewSettings' },
    ],
  },
];

/** Account pages live in the user menu and top bar, not the sidebar. */
export const ACCOUNT_ITEMS: readonly NavItem[] = [
  { href: '/me', label: 'My profile', icon: UserRound, capability: null },
  { href: '/notifications', label: 'Notifications', icon: Bell, capability: null },
];

export function visibleNav(
  groups: readonly NavGroup[],
  capabilities: readonly string[],
): NavGroup[] {
  const held = new Set(capabilities);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.capability === null || held.has(item.capability)),
    }))
    .filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Group + page label for the top bar, from the current path. */
export function navContext(pathname: string): { group: string; label: string } | null {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isActivePath(pathname, candidate.href));
    if (item) return { group: group.label, label: item.label };
  }
  const account = ACCOUNT_ITEMS.find((candidate) => isActivePath(pathname, candidate.href));
  return account ? { group: 'ACCOUNT', label: account.label } : null;
}
