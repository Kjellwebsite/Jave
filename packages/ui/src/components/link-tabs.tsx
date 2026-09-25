import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { type LinkComponent, PlainLink } from '../lib/link';
import { RailActiveIntoView } from './rail-active-into-view';

export interface LinkTab {
  href: string;
  label: ReactNode;
  active: boolean;
  /** Optional trailing count or badge. */
  meta?: ReactNode;
}

export interface LinkTabsProps {
  tabs: readonly LinkTab[];
  label: string;
  linkComponent?: LinkComponent;
  className?: string;
}

/** URL-driven tabs (server-rendered): each tab is a link, the active one is aria-current. */
export function LinkTabs({
  tabs,
  label,
  linkComponent: Link = PlainLink,
  className,
}: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cx('border-b border-line', className)}>
      <ul className="-mb-px flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none] max-md:scroll-fade-x max-md:pr-8">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cx(
                'type-eyebrow inline-flex h-10 items-center gap-2 border-b px-3 transition-colors',
                tab.active
                  ? 'border-fg text-fg'
                  : 'border-transparent text-fg-subtle hover:text-fg-muted',
              )}
            >
              {tab.label}
              {tab.meta}
            </Link>
          </li>
        ))}
      </ul>
      <RailActiveIntoView activeKey={tabs.find((tab) => tab.active)?.href ?? ''} />
    </nav>
  );
}
