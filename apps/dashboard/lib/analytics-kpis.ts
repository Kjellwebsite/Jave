/**
 * The analytics page's headline readouts, derived from core's overview. Pure
 * and client-safe.
 */
import { formatCount, formatRate } from '@jave/ui';
import type { analytics } from '@jave/core';
import { formatHours, formatMinutes, plural, signed } from './analytics-view';

/** Two KPI tiles share a phone's width: a longer label would wrap and misalign the numerals. */
export const KPI_LABEL_MAX_LENGTH = 15;

export interface Kpi {
  key: string;
  /** At most KPI_LABEL_MAX_LENGTH characters. */
  label: string;
  value: number | string | null;
  hint: string;
}

/**
 * The headline readouts of the organization's health. Flows and rates cover
 * the selected range (the filter above the strip); the hint says when a
 * figure is a current state instead.
 */
export function overviewKpis(overview: analytics.ServerOverview): Kpi[] {
  const { members, applications, trials, missions, tickets } = overview;
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
      label: 'NET MEMBERS',
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
      label: 'PENDING REVIEW',
      value: applications.pending,
      hint:
        applications.medianHoursToDecision === null
          ? 'Applications waiting on staff'
          : `Median decision ${formatHours(applications.medianHoursToDecision)}`,
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
      label: 'MISSIONS DONE',
      value: missions.completed,
      hint: `${formatCount(missions.open)} open now`,
    },
    {
      key: 'first-response',
      label: 'FIRST RESPONSE',
      value: formatMinutes(tickets.medianFirstResponseMinutes),
      hint: 'Median, new tickets',
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
