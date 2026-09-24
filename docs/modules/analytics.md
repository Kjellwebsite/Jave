# Module: analytics

`packages/core/src/analytics` · `import { analytics } from '@jave/core'`

## Purpose

Organizational health for staff: is JAVELIN attracting people who stay, are
applications decided promptly, do trials, missions and projects produce
outcomes, are tickets answered on time, is moderation load changing.

Principles:

- Descriptive counts and rates only. No engagement score, no per-member
  ranking, no cross-domain aggregate of capability.
- Discord activity (messages, voice, reactions) is not tracked. It is not
  capability, and it is not organizational health.
- Every read requires `canViewAnalytics` (operations and above) and honours
  the kill switch `settings.analytics.enabled` (`DisabledError` when off).

## Services

### `getServerOverview(ctx, { rangeDays: 7 | 30 | 90 })` (default 30)

Window = the last `rangeDays` ending now, half-open `[start, end)`.

| Section       | Fields and definitions                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| members       | `present`, `onboarded` (now); `joins`, `leaves`, `net` (in range, from `guild_member_events`); `retention.d7` / `d30`                                                                        |
| retention     | DN cohort = joins in a window of `rangeDays` that **ended N days ago** (so every join had N days to mature); retained = no leave within N days of that join                                  |
| applications  | `byStatus` (all, every status present), `pending` (submitted/review/interview), `submitted`, `accepted`, `rejected` in range, `acceptanceRate` = accepted / decided, `medianHoursToDecision` |
| trials        | `byStatus`, `active`, `completed` (completedAt in range), `resultsPublished`, `passed` (pass + distinction), `passRate`                                                                      |
| missions      | `open` (now), `completed` (assignments verified in range)                                                                                                                                    |
| projects      | `byStatus` (not deleted), `shipped` (shippedAt in range)                                                                                                                                     |
| tickets       | `open` (open/claimed/waiting now), `opened`, `medianFirstResponseMinutes`, `slaTracked`, `slaBreached`, `slaBreachRate`                                                                      |
| moderation    | `casesByAction`, `securityEventsByTrigger` (every enum value present)                                                                                                                        |
| contributions | `verified` (verifiedAt in range)                                                                                                                                                             |
| referrals     | `attributed` (joins in range), `validated` (became VALID in range)                                                                                                                           |

SLA: a ticket opened in range is _tracked_ once its outcome is known (a first
response exists or the due time passed). It is _breached_ when a breach was
recorded, the first response came after the due time, or there is no response
past the due time. Rates are `null` (never `NaN`) when the denominator is 0.

### `getJavelinProgress(ctx)`

All-time outcomes — `trialsPassed` (published pass/distinction),
`projectsShipped`, `verifiedContributions`, `missionsCompleted` — plus
`progression` (present members per progression role) and
`capabilityDistribution`: per domain, present members by **peak verified
tier**, plus `claimedOnly` and `unknown`, so VERIFIED / CLAIMED / UNKNOWN stay
separate. Ranks on tiers disabled later are still reported.

### `getTimeSeries(ctx, { metric, rangeDays: 7 | 30 | 90 | 365, dimension? })`

One point per completed UTC day, oldest first; `value: null` means no snapshot
exists for that day (distinct from 0). For dimensioned metrics, omitting
`dimension` returns the total across dimensions.

## Jobs

| Type                 | Schedule | Work                                                                        |
| -------------------- | -------- | --------------------------------------------------------------------------- |
| `analytics.snapshot` | daily    | Upsert yesterday's flows and today's gauges (labelled yesterday) per metric |

- Idempotent upsert on `(day, metric, dimension)`; re-running overwrites.
- Backfill: flows for up to 7 earlier days that have no snapshot (worker
  downtime). Gauges cannot be reconstructed for the past, so backfilled days
  carry flows only.
- Payload `{ day: 'YYYY-MM-DD' }` recomputes one completed day (≤ 365 days
  old) — flows only unless it is yesterday.
- System actor only; skipped when analytics is disabled.

## Metric catalog (`metrics.ts`)

Gauges: `members.present`, `members.onboarded`, `members.by_role` (dimension:
progression role), `applications.pending`, `trials.active`, `missions.open`,
`projects.shipped_total`, `tickets.open`, `referrals.valid_total`.

Flows: `members.joins`, `members.leaves`, `applications.submitted`,
`applications.accepted`, `applications.rejected`, `trials.completed`,
`trials.passed`, `missions.completed`, `projects.shipped`,
`contributions.verified`, `tickets.opened`, `moderation.cases` (dimension:
action), `security.events` (dimension: trigger), `referrals.attributed`,
`referrals.validated`.

Dimensioned metrics store one row per enum value, zeros included.

## Capabilities, events, notifications

- Capability: `canViewAnalytics`. No new capabilities.
- Events: none emitted, none consumed.
- Notifications: none.

## Discord job contracts

None. Analytics never acts on Discord.

## Performance

Each overview section is one or two aggregate queries (`count(*) filter`,
`percentile_cont`, grouped enum counts); sections run concurrently. No N+1.
Retention uses a correlated `NOT EXISTS` on `guild_member_events` (indexed by
user and time). The queries read other modules' tables directly; they rely on
existing indexes (`applications_status_idx`, `mod_cases_time_idx`,
`security_events_time_idx`, `guild_member_events_*`). Contributions and
mission assignments have no index on `verified_at`; add one if those tables
grow large.

## Extension points

- Add a metric: declare it in `ANALYTICS_METRICS`, emit it in
  `collectDay` (`snapshots.service.ts`).
- Section queries (`queries/*.ts`) take a `TimeWindow` and can be reused for
  new reports.

## Known limitations

- Gauges reflect the moment the job runs (normally just after midnight UTC);
  a worker that was down all day records them late.
- The overview's `present` / `pending` / `open` values are current, not as of
  the window end.
- Retention counts each join (rejoins included), not unique people.
