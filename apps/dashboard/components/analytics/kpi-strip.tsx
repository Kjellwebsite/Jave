import { formatCount, formatRate, Stat } from '@jave/ui';
import type { analytics } from '@jave/core';
import { formatHours, formatMinutes, plural, signed } from '@/lib/analytics-view';

export interface Kpi {
  key: string;
  label: string;
  value: number | string | null;
  hint: string;
}

/** The headline readouts of the organization's health for one range. */
export function overviewKpis(overview: analytics.ServerOverview): Kpi[] {
  const { members, applications, trials, missions, tickets } = overview;
  const range = overview.rangeDays;
  const d30 = members.retention.d30;
  return [
    {
      key: 'present',
      label: 'MEMBERS PRESENT',
      value: members.present,
      hint: `${formatCount(members.onboarded)} onboarded`,
    },
    {
      key: 'net',
      label: `NET MEMBERS · ${range}D`,
      value: signed(members.net),
      hint: `${plural(members.joins, 'join')} · ${plural(members.leaves, 'leave')}`,
    },
    {
      key: 'retention',
      label: 'D30 RETENTION',
      value: formatRate(d30.rate),
      hint:
        d30.cohort > 0
          ? `${formatCount(d30.retained)} of ${formatCount(d30.cohort)} joins stayed`
          : 'No cohort yet',
    },
    {
      key: 'pending',
      label: 'APPLICATIONS PENDING',
      value: applications.pending,
      hint: `Median decision ${formatHours(applications.medianHoursToDecision)}`,
    },
    {
      key: 'pass-rate',
      label: 'TRIAL PASS RATE',
      value: formatRate(trials.passRate),
      hint:
        trials.resultsPublished > 0
          ? `${formatCount(trials.passed)} of ${formatCount(trials.resultsPublished)} published`
          : 'No results published',
    },
    {
      key: 'missions',
      label: `MISSIONS DONE · ${range}D`,
      value: missions.completed,
      hint: `${formatCount(missions.open)} open now`,
    },
    {
      key: 'first-response',
      label: 'FIRST RESPONSE',
      value: formatMinutes(tickets.medianFirstResponseMinutes),
      hint: 'Median, tickets opened in range',
    },
    {
      key: 'sla',
      label: 'SLA BREACH RATE',
      value: formatRate(tickets.slaBreachRate),
      hint:
        tickets.slaTracked > 0
          ? `${formatCount(tickets.slaBreached)} of ${formatCount(tickets.slaTracked)} tracked`
          : 'No tracked tickets',
    },
  ];
}

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
