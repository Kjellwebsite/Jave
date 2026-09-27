import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, UserSearch } from 'lucide-react';
import { isUuid, moderation } from '@jave/core';
import { buttonStyles, EmptyState, Icon, Mono, PageHeader, Panel, StatusBadge } from '@jave/ui';
import { CaseList } from '@/components/moderation/case-list';
import { ReviewEventControls } from '@/components/moderation/moderation-dialogs';
import { RiskMeter } from '@/components/moderation/risk-meter';
import { RestrictedPage } from '@/components/restricted-page';
import {
  EVENT_SOURCE_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventSeverity,
  evidenceModifiers,
  isSnowflake,
  riskSeverity,
  SECURITY_ACTION_LABELS,
  TRIGGER_LABELS,
} from '@/lib/moderation-labels';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadRiskThresholds } from '@/server/data/moderation';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { reviewSecurityEventAction } from '../../actions';

export const metadata: Metadata = { title: 'Security event' };

const DISCORD_WEB = 'https://discord.com/channels';
const SIGNAL_MAX_WEIGHT = 100;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-small text-fg">{children}</dd>
    </div>
  );
}

/** Discord web link to a message; only built from validated snowflakes. */
function messageUrl(guildId: string | undefined, channelId: string, messageId: string) {
  if (!isSnowflake(guildId) || !isSnowflake(channelId) || !isSnowflake(messageId)) return null;
  return `${DISCORD_WEB}/${guildId}/${channelId}/${messageId}`;
}

export default async function SecurityEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => moderation.getSecurityEvent(ctx, id));
  if (!loaded.ok) {
    return (
      <RestrictedPage
        eyebrow="SUPPORT & SAFETY"
        title="Moderation"
        capability="canViewSecurityEvents"
      />
    );
  }
  const event = loaded.value;
  const [viewer, thresholds] = await Promise.all([loadViewer(ctx), loadRiskThresholds(ctx)]);
  const tz = viewer.timeZone;
  const severity = eventSeverity(event, thresholds);
  const { evidence } = event;
  const modifiers = evidenceModifiers(evidence);
  const channelId = evidence.channelId ?? event.channelId;
  const firstMessage = evidence.messageIds?.[0];
  const jumpUrl =
    channelId && firstMessage ? messageUrl(ctx.config.guildId, channelId, firstMessage) : null;
  const subjectHref = event.user
    ? `/moderation${toQueryString({ tab: 'lookup', q: event.user.discordId })}`
    : null;

  return (
    <div className="space-y-8">
      <Link
        href="/moderation?tab=security"
        className="inline-flex items-center gap-1.5 text-small text-fg-subtle transition-colors hover:text-fg"
      >
        <Icon icon={ArrowLeft} size="sm" />
        Security events
      </Link>
      <PageHeader
        eyebrow="SUPPORT & SAFETY / SECURITY EVENT"
        title={event.reference}
        description={`${TRIGGER_LABELS[event.trigger]} — ${event.user?.name ?? 'no specific member'}`}
        actions={
          subjectHref ? (
            <Link href={subjectHref} className={buttonStyles({ variant: 'secondary' })}>
              <Icon icon={UserSearch} size="sm" />
              Member record
            </Link>
          ) : null
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="STATUS">
          <StatusBadge
            tone={EVENT_STATUS_TONE[event.status]}
            label={EVENT_STATUS_LABELS[event.status]}
            data-testid="event-status"
          />
        </Fact>
        <Fact label="TRIGGER">{TRIGGER_LABELS[event.trigger]}</Fact>
        <Fact label="SOURCE">{EVENT_SOURCE_LABELS[event.source]}</Fact>
        <Fact label="ACTION TAKEN">{SECURITY_ACTION_LABELS[event.actionTaken]}</Fact>
        <Fact label="SUBJECT">
          {event.user ? (
            <>
              <span className="block truncate">{event.user.name}</span>
              <Mono dim className="block truncate text-[12px]">
                {event.user.discordId}
              </Mono>
            </>
          ) : (
            <span className="text-fg-subtle">None</span>
          )}
        </Fact>
        <Fact label="RAISED">
          <Mono>{formatTimestamp(event.createdAt, tz)}</Mono>
        </Fact>
      </dl>

      {/* Below lg the triage column (risk, review) comes first: it is what a moderator needs. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 min-w-0 space-y-6 lg:order-none">
          <Panel
            title="Evidence"
            description="Excerpts are redacted and truncated. Never full message history."
            actions={
              jumpUrl ? (
                <a
                  href={jumpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                >
                  Open in Discord
                  <Icon icon={ExternalLink} size="sm" />
                </a>
              ) : null
            }
          >
            <div className="space-y-5">
              {evidence.excerpt ? (
                <pre
                  data-testid="evidence-excerpt"
                  className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-fg-muted"
                >
                  {evidence.excerpt}
                </pre>
              ) : (
                <p className="text-small text-fg-subtle">No message excerpt was recorded.</p>
              )}
              {evidence.signals.length > 0 ? (
                <div className="space-y-2.5">
                  <p className="type-eyebrow text-fg-subtle">SIGNALS</p>
                  <ul className="space-y-3">
                    {evidence.signals.map((signal) => (
                      <li
                        key={signal.key}
                        className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-4"
                      >
                        <Mono className="text-small text-fg">{signal.key}</Mono>
                        <div className="min-w-0 space-y-1">
                          <RiskMeter
                            score={Math.min(SIGNAL_MAX_WEIGHT, signal.weight)}
                            severity={riskSeverity(signal.weight, thresholds)}
                          />
                          {signal.detail ? (
                            <p className="break-words text-small text-fg-subtle">{signal.detail}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {modifiers.length > 0 ? (
                <div className="space-y-2">
                  <p className="type-eyebrow text-fg-subtle">CONTEXT</p>
                  <ul className="space-y-1.5">
                    {modifiers.map((modifier) => (
                      <li key={modifier.key} className="flex flex-wrap gap-x-3 text-small">
                        <Mono className="text-fg">×{modifier.factor.toFixed(2)}</Mono>
                        <span className="text-fg-muted">{modifier.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {channelId || evidence.messageIds?.length ? (
                <p className="text-small text-fg-subtle">
                  {channelId ? (
                    <>
                      Channel <Mono dim>{channelId}</Mono>
                    </>
                  ) : null}
                  {evidence.messageIds?.length ? (
                    <>
                      {' · '}
                      {evidence.messageIds.length} message
                      {evidence.messageIds.length === 1 ? '' : 's'}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </Panel>
          <Panel title="Cases" description="Moderation cases opened from this event." flush>
            {event.cases.length === 0 ? (
              <EmptyState
                compact
                title="NO CASE"
                description="No moderation case references this event."
              />
            ) : (
              <CaseList cases={event.cases} timeZone={tz} label={`Cases from ${event.reference}`} />
            )}
          </Panel>
        </div>

        <div className="order-1 min-w-0 space-y-6 lg:order-none">
          <Panel
            title="Risk"
            description={
              event.riskScored
                ? 'Combined evidence for this event. Not a verdict on a person.'
                : 'Reports carry no automated score. Staff judgement decides.'
            }
          >
            <RiskMeter score={event.riskScore} severity={severity} size="md" showSeverity />
          </Panel>
          <Panel title="Review">
            <div className="space-y-4">
              {event.reviewedBy || event.reviewedAt ? (
                <div className="space-y-1.5">
                  <p className="text-small text-fg-muted">
                    {EVENT_STATUS_LABELS[event.status]}
                    {event.reviewedBy ? ` by ${event.reviewedBy.name}` : ''}
                  </p>
                  {event.reviewedAt ? (
                    <Mono dim className="text-[12px]">
                      {formatTimestamp(event.reviewedAt, tz)}
                    </Mono>
                  ) : null}
                  {event.reviewNote ? (
                    <p className="whitespace-pre-wrap break-words text-small text-fg">
                      {event.reviewNote}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-small text-fg-subtle">
                  {event.reportedBy
                    ? `Reported by ${event.reportedBy.name}. Not reviewed yet.`
                    : 'Not reviewed yet.'}
                </p>
              )}
              <ReviewEventControls
                securityEventId={event.id}
                reference={event.reference}
                status={event.status}
                reviewAction={reviewSecurityEventAction}
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
