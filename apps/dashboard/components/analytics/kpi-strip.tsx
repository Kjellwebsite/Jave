import { Stat } from '@jave/ui';
import type { analytics } from '@jave/core';
import { overviewKpis } from '@/lib/analytics-kpis';

/** Eight instrument tiles: four across on wide screens, two on phones (never a lone tile). */
export function KpiStrip({ overview }: { overview: analytics.ServerOverview }) {
  return (
    <section aria-label="Health indicators" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {overviewKpis(overview).map((kpi) => (
        <Stat key={kpi.key} label={kpi.label} value={kpi.value} hint={kpi.hint} />
      ))}
    </section>
  );
}
