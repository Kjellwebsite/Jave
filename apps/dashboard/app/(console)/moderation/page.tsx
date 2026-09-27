import type { Metadata } from 'next';
import { LinkTabs, PageHeader, Stat } from '@jave/ui';
import { CasesTab } from '@/components/moderation/cases-tab';
import { LookupTab } from '@/components/moderation/lookup-tab';
import { RaidTab } from '@/components/moderation/raid-tab';
import { SecurityTab } from '@/components/moderation/security-tab';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import { parseCaseFilters, parseEventFilters } from '@/lib/moderation-labels';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import {
  loadModerationSummary,
  type ModerationSummary,
  type ModerationTab,
  visibleTabs,
} from '@/server/data/moderation';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { setRaidModeAction } from './actions';

export const metadata: Metadata = { title: 'Moderation' };

const TAB_LABELS: Record<ModerationTab, string> = {
  cases: 'Cases',
  security: 'Security events',
  lookup: 'Member lookup',
  raid: 'Raid mode',
};

function tabHref(tab: ModerationTab): string {
  return tab === 'cases' ? '/moderation' : `/moderation?tab=${tab}`;
}

function SummaryStrip({ summary }: { summary: ModerationSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="RAID MODE"
        value={summary.raidMode ? 'ON' : 'OFF'}
        hint={summary.raidMode ? 'New joins are held' : 'Joins screened normally'}
        href={tabHref('raid')}
        linkComponent={NextLink}
      />
      <Stat
        label="NEEDS REVIEW"
        value={summary.needsReview}
        hint="Open security events"
        href={summary.needsReview === null ? undefined : tabHref('security')}
        linkComponent={NextLink}
      />
      <Stat
        label="QUARANTINED"
        value={summary.quarantined}
        hint="Held for review"
        href="/moderation?action=quarantine&state=live"
        linkComponent={NextLink}
      />
      <Stat
        label="BANNED"
        value={summary.banned}
        hint="Live bans"
        href="/moderation?action=ban&state=live"
        linkComponent={NextLink}
      />
    </div>
  );
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const tabs = visibleTabs(ctx);
  const summary = tabs.length > 0 ? await guarded(() => loadModerationSummary(ctx)) : null;
  if (!summary?.ok) {
    return (
      <RestrictedPage eyebrow="SUPPORT & SAFETY" title="Moderation" capability="canModerate" />
    );
  }
  const params = await searchParams;
  const requested = firstParam(params.tab);
  const tab = tabs.find((candidate) => candidate === requested) ?? tabs[0]!;
  const viewer = await loadViewer(ctx);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SUPPORT & SAFETY"
        title="Moderation"
        description="Cases, security events and raid posture. Every action is an audited case; the bot mirrors it in Discord."
      />

      <SummaryStrip summary={summary.value} />

      <div className="space-y-6">
        <LinkTabs
          label="Moderation sections"
          linkComponent={NextLink}
          tabs={tabs.map((key) => ({
            href: tabHref(key),
            label: TAB_LABELS[key],
            active: key === tab,
          }))}
        />
        {tab === 'cases' ? (
          <CasesTab ctx={ctx} filters={parseCaseFilters(params)} timeZone={viewer.timeZone} />
        ) : null}
        {tab === 'security' ? (
          <SecurityTab ctx={ctx} filters={parseEventFilters(params)} timeZone={viewer.timeZone} />
        ) : null}
        {tab === 'lookup' ? (
          <LookupTab ctx={ctx} rawQuery={firstParam(params.q)} timeZone={viewer.timeZone} />
        ) : null}
        {tab === 'raid' ? <RaidTab ctx={ctx} raidAction={setRaidModeAction} /> : null}
      </div>
    </div>
  );
}
