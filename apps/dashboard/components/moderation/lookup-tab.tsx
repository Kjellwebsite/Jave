import Link from 'next/link';
import { Search, UserSearch } from 'lucide-react';
import { can, moderation, type ServiceContext } from '@jave/core';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Mono,
  Panel,
  Stat,
  StatusBadge,
  Toolbar,
} from '@jave/ui';
import { STANDING_LABELS, STANDING_TONE } from '@/lib/member-labels';
import { parseLookupQuery } from '@/lib/moderation-labels';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { loadLookup, loadRiskThresholds } from '@/server/data/moderation';
import { CaseList } from './case-list';
import { EventList } from './event-list';

const RECENT_EVENTS = 5;

export interface LookupTabProps {
  ctx: ServiceContext;
  rawQuery: string | undefined;
  timeZone: string;
}

function lookupHref(query: string): string {
  return `/moderation${toQueryString({ tab: 'lookup', q: query })}`;
}

function SearchForm({ query }: { query: string | undefined }) {
  return (
    <form
      method="get"
      action="/moderation"
      role="search"
      aria-label="Look up a member"
      className="border-b border-line-subtle p-4"
    >
      <input type="hidden" name="tab" value="lookup" />
      <Toolbar className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
        <label className="relative min-w-0">
          <span className="sr-only">Discord ID, handle or name</span>
          <Icon
            icon={Search}
            size="sm"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            name="q"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Discord ID, @handle or name"
            maxLength={64}
            className="pl-8"
          />
        </label>
        <Button type="submit" variant="secondary">
          Look up
        </Button>
      </Toolbar>
    </form>
  );
}

/** One member's moderation record: search by Discord ID, handle or name. */
export async function LookupTab({ ctx, rawQuery, timeZone }: LookupTabProps) {
  const input = parseLookupQuery(rawQuery);
  const result = await loadLookup(ctx, input);
  const history = result.history;
  const events =
    history && can(ctx, 'canViewSecurityEvents')
      ? await moderation.listSecurityEvents(ctx, {
          userId: history.target.userId,
          limit: RECENT_EVENTS,
        })
      : null;
  const thresholds = events && events.items.length > 0 ? await loadRiskThresholds(ctx) : null;

  return (
    <div className="space-y-6">
      <Card padding="none">
        <SearchForm query={input.query} />
        {!input.query ? (
          <EmptyState
            compact
            icon={UserSearch}
            title="LOOK UP A MEMBER"
            description="Paste a Discord ID for the full record, or search by name or handle. Records about you or staff at your rank are not shown."
          />
        ) : null}
        {input.query && !input.discordId ? (
          result.candidates.length === 0 ? (
            <EmptyState
              compact
              icon={UserSearch}
              title="NO MATCHING MEMBERS"
              description="No member matches that name or handle. Users who never joined can be found by Discord ID."
            />
          ) : (
            <ul aria-label="Matching members" className="divide-y divide-line-subtle">
              {result.candidates.map((member) => (
                <li key={member.id}>
                  <Link
                    href={lookupHref(member.discordId)}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-raised/60"
                  >
                    <Avatar name={member.displayName} src={member.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg">{member.displayName}</span>
                      <Mono dim className="block truncate text-[12px]">
                        @{member.handle} · {member.discordId}
                      </Mono>
                    </span>
                    {member.standing !== 'good' ? (
                      <StatusBadge
                        tone={STANDING_TONE[member.standing]}
                        label={STANDING_LABELS[member.standing]}
                      />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {input.discordId && !history ? (
          <EmptyState
            compact
            icon={UserSearch}
            title="NO RECORD"
            description="JAVE has no moderation record it can show you for this Discord ID."
          />
        ) : null}
      </Card>

      {history ? (
        <section aria-label={`Moderation record of ${history.target.name}`} className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="type-eyebrow text-fg-subtle">MODERATION RECORD</p>
              <h2 className="break-words text-[22px] font-semibold leading-tight tracking-tight text-fg">
                {history.target.name}
              </h2>
              <Mono dim className="select-all">
                {history.target.discordId}
              </Mono>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="WARNINGS" value={history.summary.warnings} hint="Not revoked" />
            <Stat
              label="TIMEOUT"
              value={history.summary.timeoutUntil ? 'ACTIVE' : '—'}
              hint={
                history.summary.timeoutUntil
                  ? `Until ${formatTimestamp(history.summary.timeoutUntil, timeZone)}`
                  : 'None running'
              }
            />
            <Stat
              label="RESTRICTION"
              value={history.summary.banned ? 'BANNED' : history.summary.quarantined ? 'HELD' : '—'}
              hint={
                history.summary.banned
                  ? 'Live ban'
                  : history.summary.quarantined
                    ? 'Quarantined'
                    : 'Full access'
              }
            />
            <Stat label="CASES" value={history.summary.totalCases} hint="All time" />
          </div>
          <Panel
            title="Cases"
            description={
              history.summary.totalCases > history.cases.length
                ? `Latest ${history.cases.length} of ${history.summary.totalCases}.`
                : undefined
            }
            flush
          >
            {history.cases.length === 0 ? (
              <EmptyState
                compact
                title="CLEAN RECORD"
                description="No moderation case has been recorded for this member."
              />
            ) : (
              <CaseList
                cases={history.cases}
                timeZone={timeZone}
                hideMember
                label={`Cases about ${history.target.name}`}
              />
            )}
          </Panel>
          {events && thresholds ? (
            <Panel title="Security events" description="Most recent first." flush>
              <EventList events={events.items} thresholds={thresholds} timeZone={timeZone} />
            </Panel>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
