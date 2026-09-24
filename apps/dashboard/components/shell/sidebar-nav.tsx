'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, Icon } from '@jave/ui';
import { isActivePath, NAV_GROUPS, visibleNav } from '@/lib/nav';

export interface SidebarNavProps {
  capabilities: readonly string[];
  onNavigate?: () => void;
}

/** Grouped primary navigation, filtered to what the viewer may open. */
export function SidebarNav({ capabilities, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const groups = visibleNav(NAV_GROUPS, capabilities);
  return (
    <nav aria-label="Primary" className="px-3 pb-6">
      {groups.map((group) => (
        <div key={group.label} className="mt-7 first:mt-4">
          <p className="type-eyebrow px-2.5 pb-2 text-[10px] text-fg-subtle">{group.label}</p>
          <ul className="space-y-px">
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    className={cx(
                      'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-body transition-colors',
                      active
                        ? 'bg-surface-raised text-fg shadow-highlight'
                        : 'text-fg-subtle hover:bg-surface-raised/60 hover:text-fg',
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 -left-3 w-0.5 rounded-full bg-fg"
                      />
                    ) : null}
                    <Icon
                      icon={item.icon}
                      className={active ? 'text-fg' : 'text-fg-faint group-hover:text-fg-subtle'}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
