/**
 * Metric catalog for daily analytics snapshots. Gauges are point-in-time
 * values captured when the snapshot runs (shortly after the day ends);
 * flows count what happened during the UTC day.
 *
 * Deliberately absent: message counts, voice minutes, reactions — Discord
 * activity is not capability and is not tracked as organizational health.
 */
export type MetricKind = 'gauge' | 'flow';
export type MetricDimension = 'role' | 'action' | 'trigger';

export interface MetricDefinition {
  kind: MetricKind;
  description: string;
  /** Dimensioned metrics store one row per enum value (zeros included). */
  dimension?: MetricDimension;
}

export const ANALYTICS_METRICS = {
  'members.present': { kind: 'gauge', description: 'Members currently in the server.' },
  'members.onboarded': { kind: 'gauge', description: 'Present members who completed onboarding.' },
  'members.by_role': {
    kind: 'gauge',
    description: 'Present members per progression role.',
    dimension: 'role',
  },
  'members.joins': { kind: 'flow', description: 'Server joins.' },
  'members.leaves': { kind: 'flow', description: 'Server leaves.' },
  'applications.pending': { kind: 'gauge', description: 'Applications awaiting staff.' },
  'applications.submitted': { kind: 'flow', description: 'Applications submitted.' },
  'applications.accepted': { kind: 'flow', description: 'Applications accepted.' },
  'applications.rejected': { kind: 'flow', description: 'Applications rejected.' },
  'trials.active': { kind: 'gauge', description: 'Trials in progress.' },
  'trials.completed': { kind: 'flow', description: 'Trials completed.' },
  'trials.passed': { kind: 'flow', description: 'Trial results published as pass or distinction.' },
  'missions.open': { kind: 'gauge', description: 'Open missions.' },
  'missions.completed': { kind: 'flow', description: 'Mission assignments verified.' },
  'projects.shipped': { kind: 'flow', description: 'Projects shipped.' },
  'projects.shipped_total': { kind: 'gauge', description: 'Shipped projects to date.' },
  'contributions.verified': { kind: 'flow', description: 'Contributions verified.' },
  'tickets.open': { kind: 'gauge', description: 'Open, claimed or waiting tickets.' },
  'tickets.opened': { kind: 'flow', description: 'Tickets opened.' },
  'moderation.cases': {
    kind: 'flow',
    description: 'Moderation cases by action.',
    dimension: 'action',
  },
  'security.events': {
    kind: 'flow',
    description: 'Security events by trigger.',
    dimension: 'trigger',
  },
  'referrals.attributed': { kind: 'flow', description: 'Joins attributed to a referral source.' },
  'referrals.validated': { kind: 'flow', description: 'Referrals that became VALID.' },
  'referrals.valid_total': { kind: 'gauge', description: 'VALID referrals to date.' },
} as const satisfies Record<string, MetricDefinition>;

export type AnalyticsMetric = keyof typeof ANALYTICS_METRICS;

export const ANALYTICS_METRIC_KEYS = Object.keys(ANALYTICS_METRICS) as [
  AnalyticsMetric,
  ...AnalyticsMetric[],
];

export function metricDefinition(metric: AnalyticsMetric): MetricDefinition {
  return ANALYTICS_METRICS[metric];
}

/** One snapshot row. `dimension` is '' for undimensioned metrics. */
export interface MetricPoint {
  metric: AnalyticsMetric;
  dimension: string;
  value: number;
}
