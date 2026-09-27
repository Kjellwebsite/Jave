import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { isUuid, tickets } from '@jave/core';
import { Badge, buttonStyles, Callout, cx, Icon, Mono, PageHeader, Panel } from '@jave/ui';
import { AiSummaryPanel } from '@/components/tickets/ai-summary';
import { Conversation } from '@/components/tickets/conversation';
import { TicketNoteForm } from '@/components/tickets/note-form';
import { SlaTimer } from '@/components/tickets/sla-timer';
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/tickets/ticket-badges';
import { ClaimAction, TicketControlList } from '@/components/tickets/ticket-controls';
import { referencedUserIds, TicketTimeline } from '@/components/tickets/ticket-timeline';
import { TranscriptExport } from '@/components/tickets/transcript-export';
import { CATEGORY_LABELS, formatMinutes, ticketControls } from '@/lib/ticket-view';
import { toQueryString } from '@/lib/search-params';
import { formatRelative, formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { getRuntime } from '@/server/runtime';
import { getTicketAi } from '@/server/tickets/ai';
import { listTicketHandlers, peopleNames } from '@/server/tickets/people';
import {
  addNoteAction,
  archiveTicketAction,
  claimTicketAction,
  closeTicketAction,
  reopenTicketAction,
  resumeTicketAction,
  setPriorityAction,
  setWaitingAction,
  summarizeTicketAction,
  transferTicketAction,
  unclaimTicketAction,
} from './actions';

export const metadata: Metadata = { title: 'Ticket' };

const SNOWFLAKE = /^\d{17,20}$/;

/** Deep link to the private thread; only ever built from validated snowflakes. */
function threadUrl(guildId: string | undefined, threadId: string): string | null {
  if (!guildId || !SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(threadId)) return null;
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 truncate text-small text-fg-muted">{children}</dd>
    </div>
  );
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, actor } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // A ticket the viewer may not see is "not found" (and audited by core).
  const loaded = await guarded(() => tickets.getTicket(ctx, { ticketId: id }));
  if (!loaded.ok) notFound();
  const ticket = loaded.value;
  const staff = ticket.viewer === 'handler';
  const controls = ticketControls(ticket, {
    userId: actor.userId,
    capabilities: [...actor.capabilities],
  });
  const [viewer, handlers, names] = await Promise.all([
    loadViewer(ctx),
    controls.transfer ? listTicketHandlers(ctx) : [],
    staff ? peopleNames(ctx, referencedUserIds(ticket.events)) : new Map<string, string>(),
  ]);
  const tz = viewer.timeZone;
  const now = ctx.clock.now();
  const thread = ticket.thread
    ? threadUrl(getRuntime().coreConfig.guildId, ticket.thread.threadId)
    : null;
  const transferTargets = handlers.filter(
    (person) =>
      person.userId !== ticket.assignee?.userId && person.userId !== ticket.opener?.userId,
  );
  const actionSet = {
    claim: claimTicketAction,
    unclaim: unclaimTicketAction,
    transfer: transferTicketAction,
    priority: setPriorityAction,
    waiting: setWaitingAction,
    resume: resumeTicketAction,
    close: closeTicketAction,
    reopen: reopenTicketAction,
    archive: archiveTicketAction,
  };
  const hasControls =
    controls.transfer ||
    controls.priority ||
    controls.waiting ||
    controls.resume ||
    controls.unclaim ||
    controls.close ||
    controls.reopen ||
    controls.archive;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <Link href="/tickets" className="inline-flex items-center gap-1.5 hover:text-fg-muted">
            <Icon icon={ArrowLeft} size="sm" />
            {staff ? 'TICKET QUEUE' : 'YOUR TICKETS'}
          </Link>
        }
        title={ticket.reference}
        description={<span className="text-fg">{ticket.subject}</span>}
        meta={
          <>
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            <Badge>{CATEGORY_LABELS[ticket.category].toUpperCase()}</Badge>
            {staff && ticket.sla ? (
              <SlaTimer
                sla={ticket.sla}
                ticket={{ createdAt: ticket.createdAt, status: ticket.status }}
                renderedAt={now}
                dueLabel={ticket.sla.dueAt ? formatTimestamp(ticket.sla.dueAt, tz) : undefined}
              />
            ) : null}
          </>
        }
        actions={
          <>
            {thread ? (
              <a
                href={thread}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles({ variant: 'secondary' })}
              >
                Open thread
                <Icon icon={ExternalLink} size="sm" />
              </a>
            ) : null}
            {controls.claim ? (
              <ClaimAction ticketId={ticket.id} action={claimTicketAction} />
            ) : null}
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="REQUESTER">
          {staff && ticket.opener ? (
            <Link
              href={`/tickets${toQueryString({ opener: ticket.opener.userId, status: 'all' })}`}
              className="underline decoration-line-strong decoration-dotted underline-offset-4 hover:text-fg hover:decoration-fg-subtle"
              title={`Every ticket from ${ticket.opener.displayName}`}
              data-testid="requester-history"
            >
              {ticket.opener.displayName}
            </Link>
          ) : (
            (ticket.opener?.displayName ?? 'Unknown')
          )}
        </Fact>
        <Fact label="HANDLER">
          {ticket.assignee ? (
            ticket.assignee.displayName
          ) : (
            <span className="text-fg-subtle">Unassigned</span>
          )}
        </Fact>
        <Fact label="OPENED">
          <Mono>{formatTimestamp(ticket.createdAt, tz)}</Mono>
        </Fact>
        <Fact label="LAST ACTIVITY">
          <Mono>{formatRelative(ticket.lastActivityAt, now, tz)}</Mono>
        </Fact>
        {staff && ticket.sla ? (
          <Fact label="FIRST RESPONSE">
            <Mono>
              {ticket.sla.firstResponseMinutes === null
                ? '—'
                : `${formatMinutes(ticket.sla.firstResponseMinutes)} after opening`}
            </Mono>
          </Fact>
        ) : null}
        <Fact label="THREAD">
          {ticket.thread ? 'In Discord' : <span className="text-fg-subtle">Being prepared</span>}
        </Fact>
      </dl>

      {ticket.status === 'closed' || ticket.status === 'archived' ? (
        <Callout
          tone="neutral"
          title={ticket.status === 'archived' ? 'ARCHIVED — READ-ONLY' : 'CLOSED'}
        >
          <span className="whitespace-pre-wrap break-words">
            {ticket.closeReason ?? 'No reason recorded.'}
          </span>
          {ticket.closedBy ? (
            <span className="mt-1 block text-fg-subtle">
              Closed by {ticket.closedBy.displayName}
              {ticket.closedAt ? ` · ${formatTimestamp(ticket.closedAt, tz)}` : ''}
            </span>
          ) : null}
        </Callout>
      ) : null}

      {/* Phones: actions, conversation, details. Desktop: conversation left, the rest right. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
        {hasControls ? (
          <Panel
            title="Actions"
            description={
              staff
                ? undefined
                : 'Close it once you are helped. It can be reopened until it is archived.'
            }
            className="min-w-0 lg:col-start-2 lg:row-start-1"
          >
            <TicketControlList
              ticketId={ticket.id}
              reference={ticket.reference}
              priority={ticket.priority}
              controls={controls}
              handlers={transferTargets}
              actions={actionSet}
            />
          </Panel>
        ) : null}
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Panel
            title="Conversation"
            description={
              staff
                ? 'Recorded from the private thread. Internal notes are framed and never leave staff.'
                : 'Recorded from your private thread.'
            }
          >
            <Conversation
              messages={ticket.messages}
              staff={staff}
              truncated={ticket.messagesTruncated}
              timeZone={tz}
            />
          </Panel>
          {controls.note ? (
            <Panel title="Internal note" description="Visible to ticket handlers only.">
              <TicketNoteForm ticketId={ticket.id} action={addNoteAction} />
            </Panel>
          ) : null}
        </div>

        <aside
          className={cx(
            'min-w-0 space-y-6 lg:col-start-2',
            hasControls ? 'lg:row-start-2' : 'lg:row-start-1 lg:row-span-2',
          )}
          aria-label="Ticket details"
        >
          {staff ? (
            <Panel title="AI summary" description="Staff only.">
              <AiSummaryPanel
                ticketId={ticket.id}
                summary={ticket.aiSummary}
                available={getTicketAi().deps !== null}
                canGenerate={controls.summary}
                action={summarizeTicketAction}
                timeZone={tz}
              />
            </Panel>
          ) : null}
          {controls.transcript ? (
            <Panel
              title="Transcript"
              description={
                controls.transcriptInternal
                  ? 'Every export is audited.'
                  : 'Your copy of the conversation. Every export is recorded.'
              }
            >
              <TranscriptExport
                ticketId={ticket.id}
                reference={ticket.reference}
                allowInternal={controls.transcriptInternal}
              />
            </Panel>
          ) : null}
          <Panel title="Timeline">
            <TicketTimeline events={ticket.events} names={names} timeZone={tz} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
