import { LockKeyhole, MessagesSquare, Paperclip } from 'lucide-react';
import type { tickets } from '@jave/core';
import { Avatar, Badge, cx, EmptyState, Icon, Mono } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';
import { AUTHOR_ROLE_LABELS, formatBytes } from '@/lib/ticket-view';
import { formatTimestamp } from '@/lib/time';

type Message = tickets.TicketMessageView;

function Attachments({ items }: { items: Message['attachments'] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
      {items.map((attachment, index) => {
        const href = safeExternalUrl(attachment.url);
        const label = (
          <>
            <Icon icon={Paperclip} size="sm" className="shrink-0 text-fg-subtle" />
            <span className="max-w-56 truncate">{attachment.name}</span>
            <Mono dim className="text-[11px]">
              {formatBytes(attachment.size)}
            </Mono>
          </>
        );
        const frame =
          'inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-small text-fg-muted';
        return (
          <li key={`${attachment.url}-${index}`} className="min-w-0">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cx(frame, 'transition-colors hover:border-line-strong hover:text-fg')}
              >
                {label}
              </a>
            ) : (
              <span className={frame}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MessageItem({
  message,
  staff,
  timeZone,
}: {
  message: Message;
  staff: boolean;
  timeZone: string;
}) {
  const author = message.authorName ?? 'Unknown';
  const internal = message.isInternal;
  const deleted = message.deletedAt !== null;
  return (
    <li
      data-message-kind={internal ? 'internal' : 'message'}
      className={cx(
        'rounded-lg border px-4 py-3.5 sm:px-5',
        internal
          ? 'border-dashed border-warning/40 bg-warning/5'
          : 'border-line-subtle bg-surface-sunken/40',
        deleted && 'opacity-70',
      )}
    >
      {internal ? (
        <p className="type-eyebrow mb-2.5 flex items-center gap-1.5 text-warning">
          <Icon icon={LockKeyhole} size="sm" />
          Internal note · staff only
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Avatar name={author} size="sm" />
        <span className="text-small font-medium text-fg">{author}</span>
        {internal ? null : (
          <Badge tone={message.authorRole === 'requester' ? 'neutral' : 'info'}>
            {AUTHOR_ROLE_LABELS[message.authorRole].toUpperCase()}
          </Badge>
        )}
        {message.editedAt ? <Badge>EDITED</Badge> : null}
        {deleted ? <Badge tone="danger">DELETED IN DISCORD</Badge> : null}
        <Mono dim className="ml-auto text-[12px]">
          <time dateTime={message.createdAt.toISOString()}>
            {formatTimestamp(message.createdAt, timeZone)}
          </time>
        </Mono>
      </div>
      {message.body ? (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-body text-fg-muted">
          {message.body}
        </p>
      ) : null}
      <Attachments items={message.attachments} />
      {staff && message.originalBody !== null ? (
        <details className="mt-3 text-small">
          <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
            Original text
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words border-l border-line pl-3 text-fg-subtle">
            {message.originalBody}
          </p>
        </details>
      ) : null}
    </li>
  );
}

export interface ConversationProps {
  messages: readonly Message[];
  /** Handler view: internal notes, deleted messages and edit history are included by core. */
  staff: boolean;
  truncated: boolean;
  timeZone: string;
}

/**
 * The ticket's transcript as JAVE recorded it. All text is rendered as text
 * (React escapes it); links only for validated http(s) attachment URLs.
 * Internal notes are framed apart and exist only in the staff view.
 */
export function Conversation({ messages, staff, truncated, timeZone }: ConversationProps) {
  if (messages.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessagesSquare}
        title="NO MESSAGES"
        description="Messages posted in the ticket thread appear here as they are recorded."
      />
    );
  }
  return (
    <div className="space-y-3">
      {truncated ? (
        <p className="text-small text-fg-subtle">
          Older messages are not shown here. Export the transcript for the full record.
        </p>
      ) : null}
      <ol aria-label="Conversation" className="space-y-3">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} staff={staff} timeZone={timeZone} />
        ))}
      </ol>
    </div>
  );
}
