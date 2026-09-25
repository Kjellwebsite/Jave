import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { listMyNotifications, NOTIFICATION_TYPES, type NotificationType } from '@jave/core';
import { Card, cx, EmptyState, LinkTabs, Mono, PageHeader } from '@jave/ui';
import { SubmitButton } from '@/components/forms/submit-button';
import { NextLink } from '@/components/next-link';
import { MarkAllRead } from '@/components/notifications/mark-all-read';
import { safeInternalPath } from '@/lib/safe-url';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatRelative } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { markAllReadAction, markReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

const INBOX_LIMIT = 100;

const SEVERITY_MARK: Record<string, string> = {
  info: 'bg-fg-faint',
  notice: 'bg-fg-subtle',
  important: 'bg-info',
  critical: 'bg-danger',
};

function typeLabel(type: string): string {
  return type in NOTIFICATION_TYPES ? NOTIFICATION_TYPES[type as NotificationType].label : type;
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const unreadOnly = firstParam((await searchParams).filter) === 'unread';
  const [inbox, viewer] = await Promise.all([
    listMyNotifications(ctx, { unreadOnly, limit: INBOX_LIMIT }),
    loadViewer(ctx),
  ]);
  const now = ctx.clock.now();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ACCOUNT"
        title="Notifications"
        description="Everything JAVE sent you. Discord DMs follow your preferences; this inbox keeps it all."
        meta={<Mono dim>{inbox.unread} unread</Mono>}
        actions={<MarkAllRead action={markAllReadAction} disabled={inbox.unread === 0} />}
      />
      <LinkTabs
        label="Inbox filter"
        linkComponent={NextLink}
        tabs={[
          { href: '/notifications', label: 'All', active: !unreadOnly },
          {
            href: '/notifications?filter=unread',
            label: 'Unread',
            active: unreadOnly,
            meta:
              inbox.unread > 0 ? <Mono className="text-[11px] text-fg">{inbox.unread}</Mono> : null,
          },
        ]}
      />
      <Card padding="none">
        {inbox.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={unreadOnly ? 'ALL CAUGHT UP' : 'INBOX EMPTY'}
            description={
              unreadOnly
                ? 'No unread notifications.'
                : 'Rank changes, results and assignments will arrive here.'
            }
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {inbox.items.map((item) => {
              const href = safeInternalPath(item.url);
              const unread = item.readAt === null;
              return (
                <li
                  key={item.id}
                  data-unread={unread || undefined}
                  className={cx('relative flex gap-4 px-5 py-4', unread && 'bg-surface-raised/40')}
                >
                  {unread ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-fg"
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cx(
                      'mt-2 size-1.5 shrink-0 rounded-full',
                      SEVERITY_MARK[item.severity],
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className={cx('type-eyebrow', unread ? 'text-fg' : 'text-fg-muted')}>
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                        {unread ? <span className="sr-only"> (unread)</span> : null}
                      </p>
                      <Mono dim className="text-[12px]" title={item.createdAt.toISOString()}>
                        {formatRelative(item.createdAt, now, viewer.timeZone)}
                      </Mono>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-body text-fg-muted">
                      {item.body}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Mono dim className="text-[11px]">
                        {typeLabel(item.type)}
                      </Mono>
                      {unread ? (
                        <form action={markReadAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Mark read
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
