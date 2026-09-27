import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartLine } from 'lucide-react';
import { can } from '@jave/core';
import { buttonStyles, Callout, Card, EmptyState, Mono, PageHeader } from '@jave/ui';
import { KpiStrip } from '@/components/analytics/kpi-strip';
import { MembersSection } from '@/components/analytics/members-section';
import { PipelineSection } from '@/components/analytics/pipeline-section';
import { ProgressSection } from '@/components/analytics/progress-section';
import { RangeFilter } from '@/components/analytics/range-filter';
import { SafetySection } from '@/components/analytics/safety-section';
import { TrendsSection } from '@/components/analytics/trends-section';
import { RestrictedPage } from '@/components/restricted-page';
import { coveredDays, parseRange } from '@/lib/analytics-view';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatDate, formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadAnalytics } from '@/server/data/analytics';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Analytics' };

const EYEBROW = 'OVERVIEW / HEALTH';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const range = parseRange(firstParam((await searchParams).range));
  const loaded = await guarded(() => loadAnalytics(ctx, range));
  if (!loaded.ok) {
    return <RestrictedPage eyebrow={EYEBROW} title="Analytics" capability="canViewAnalytics" />;
  }
  if (loaded.value.status === 'disabled') {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow={EYEBROW} title="Analytics" />
        <Card padding="none">
          <EmptyState
            icon={ChartLine}
            title="ANALYTICS DISABLED"
            description="Analytics is switched off for this organization. No health figures are computed while it is off."
            action={
              can(ctx, 'canViewSettings') ? (
                <Link
                  href="/settings?section=analytics"
                  className={buttonStyles({ variant: 'secondary' })}
                >
                  Analytics settings
                </Link>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  const { view } = loaded.value;
  const viewer = await loadViewer(ctx);
  const tz = viewer.timeZone;
  const { window, generatedAt } = view.overview;
  const snapshotDays = coveredDays(view.series['members.joins'].points);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow={EYEBROW}
        title="Analytics"
        description="Organizational health: who arrives and stays, how fast decisions land, what gets demonstrated. Counts and rates only — never a score for a person."
        meta={
          <>
            <Mono dim>
              {formatDate(window.start, tz)} → {formatDate(window.end, tz)}
            </Mono>
            <Mono dim>
              Generated {formatTimestamp(generatedAt, tz)} {tz}
            </Mono>
          </>
        }
        actions={<RangeFilter current={range} basePath="/analytics" />}
      />

      {snapshotDays === 0 ? (
        <Callout tone="info" title="NO DAILY SNAPSHOTS YET">
          Trend charts draw from one snapshot per day, recorded just after midnight UTC by the
          analytics job. Live counts below are current; the charts fill in as days are captured.
        </Callout>
      ) : null}

      <KpiStrip overview={view.overview} />
      <MembersSection view={view} timeZone={tz} />
      <PipelineSection view={view} />
      <TrendsSection view={view} />
      <SafetySection view={view} />
      <ProgressSection view={view} />
    </div>
  );
}
