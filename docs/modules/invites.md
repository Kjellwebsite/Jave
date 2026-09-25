# Module: invites (referrals)

`packages/core/src/invites` · `import { invites } from '@jave/core'`

## Purpose

Credit people for bringing in members who **stay and engage**, never for raw
invite volume. Every join is attributed to a source (Discord invite, vanity
URL, referral code, or unknown) and then earns its way through a funnel:

```
INVITED ──▶ JOINED ──▶ RETAINED ──▶ VALID
(invite     (referral   (still here after     (onboarded, if required,
 uses)       row)        retentionDays)        and anomaly score below threshold)
```

Only VALID referrals without anomaly flags count on the leaderboard.

## State machine (`referrals.status`)

```
JOINED ──retention──▶ RETAINED ──onboarding + clean score──▶ VALID
  │                      │                                   │
  └──leave──▶ LEFT ◀─────┘                                   │
  └──self-invite / staff──▶ INVALID ◀──────staff─────────────┘
```

- LEFT and INVALID are terminal (`REFERRAL_TRANSITIONS` in `lifecycle.ts`).
- A VALID referral stays VALID when the member later leaves; `leftAt` is
  recorded. Validity is an earned, historical fact.
- `statusReason`: `left_guild`, `superseded` (a newer join replaced a stale
  live row), `self_invite`, `duplicate_invitee`, `staff_invalidated`.

Database invariants (`packages/database/src/schema/invites.ts`):

| Index                         | Invariant                                       |
| ----------------------------- | ----------------------------------------------- |
| `referrals_invitee_joined_uq` | one referral per join (idempotent attribution)  |
| `referrals_live_invitee_uq`   | at most one JOINED/RETAINED referral per person |
| `referrals_valid_invitee_uq`  | a person counts as VALID at most once, ever     |
| `referrals_code_claim_uq`     | a referral code can be claimed once per person  |

## Services

| Function                              | Who                                             | What                                                                      |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `syncInvites(ctx, invites[])`         | system only                                     | Replace the invite mirror with a complete snapshot; missing codes deleted |
| `inviteUsageSnapshot(ctx)`            | system only                                     | Mirror as a detection baseline for a cold bot cache                       |
| `detectUsedInvite(before, after)`     | pure                                            | The invite whose uses rose by exactly 1, else `unknown`                   |
| `attributeJoin(ctx, {…})`             | system only                                     | Create the referral for a join (idempotent per invitee + joinedAt)        |
| `createReferralCode(ctx, {…})`        | member (own, ≤ 3 active) / `canManageCampaigns` | Random code; staff may pick the code, attach a campaign, issue for others |
| `deactivateReferralCode(ctx, {code})` | owner / `canManageCampaigns`                    | Idempotent                                                                |
| `claimReferralCode(ctx, {code})`      | member (the invitee), not quarantined/banned    | Once per person, never own code, within 30 days of an observed join       |
| `createCampaign` / `updateCampaign`   | `canManageCampaigns`                            | Key, name, window, active flag; audited with a diff                       |
| `deleteCampaign`                      | `canManageCampaigns`                            | Only when nothing was attributed; otherwise deactivate                    |
| `getCampaign` / `listCampaigns`       | `canViewAnalytics`                              | With funnels (two aggregate queries)                                      |
| `attachInviteToCampaign(ctx, {…})`    | `canManageCampaigns`                            | Future joins through the invite credit the campaign                       |
| `listInviteCodes(ctx, {…})`           | `canViewAnalytics`                              | Mirrored invites with inviter names                                       |
| `markInviteeLeft` (subscriber)        | system (`member.left`)                          | JOINED/RETAINED → LEFT, `fast_leave` flag under 24 h                      |
| `runReferralSweep(ctx)` (job)         | system only                                     | Missed leaves, JOINED → RETAINED, RETAINED → VALID                        |
| `reviewReferral(ctx, {…})`            | `canManageCampaigns`, not inviter/invitee       | `clear_flags` (false positive) or `invalidate`                            |
| `getReferralLeaderboard(ctx, {…})`    | `canViewMembers`                                | VALID + unflagged only; campaign / 7-30-90 day filters                    |
| `getReferralFunnel(ctx, {…})`         | self, or `canViewAnalytics`                     | Per inviter, per campaign, or server-wide                                 |
| `listInviterFunnels(ctx, {…})`        | `canViewAnalytics`                              | Staff table of inviters                                                   |
| `getMyReferrals(ctx)`                 | member                                          | Own codes, funnel, recent referrals                                       |
| `listReferrals(ctx, {…})`             | `canViewAnalytics`                              | Staff listing with flags; `flagged: true` is the review queue             |

Attribution rules:

- A referral code re-attributes the live referral: an explicit "who referred
  you" beats invite-link detection. The original invite code stays recorded.
- A campaign is credited only while it is active and inside its window
  (`campaignAccepts`). Attaching an invite never rewrites history.
- A code for a max-uses invite deleted by the very use that brought the member
  is still credited (the mirror keeps deleted codes).
- A code not yet mirrored is recorded for tracing with method `unknown`.
- Claims require an **observed** join (a live referral or a recorded join
  event). Members synced before JAVE tracked joins cannot mint referrals.

## Anomaly detection (`anomaly.ts`, pure)

| Flag                | Weight | Signal                                                                           |
| ------------------- | ------ | -------------------------------------------------------------------------------- |
| `self_invite`       | 100    | inviter == invitee (also INVALID immediately, audited)                           |
| `new_account`       | 15     | account younger than `settings.security.suspiciousAccountAgeDays` at join        |
| `join_burst`        | 30     | ≥ 5 of the inviter's joins inside one hour around this join                      |
| `new_account_share` | 25     | ≥ 50 % of the inviter's referrals (≥ 4 samples, ±30 days) are very new           |
| `fast_leave`        | 30     | left within 24 h                                                                 |
| `fast_leave_share`  | 25     | ≥ 40 % of the inviter's referrals (≥ 4 samples) left within 24 h                 |
| `similar_usernames` | 30     | ≥ 2 of the inviter's other invitees share a name skeleton or near-identical name |
| `rejoin`            | 35     | the person had joined before                                                     |

Score = sum of weights, capped at 100. Cohort signals need an inviter
(vanity/unknown joins only get per-person flags). Scores are recomputed at
validation time with the inviter's full cohort (a burst taints its first join
too), except for referrals a reviewer cleared.

- **Any** flag keeps a referral off the leaderboard until staff clear it.
- A score ≥ `settings.analytics.referralAnomalyThreshold` (default 50) blocks
  VALID; the referral stays RETAINED and appears in the review queue.
- Inviters never see flag details, only `underReview` in `getMyReferrals`.

## Capabilities

No new capabilities. Uses `canManageCampaigns` (core and above) for writes,
`canViewAnalytics` (operations and above) for staff reads, `canViewMembers`
for the leaderboard. Bot-fed writes (`syncInvites`, `attributeJoin`,
`inviteUsageSnapshot`, `runReferralSweep`) are **system actor only**; users,
integrations and founders are refused and the denial is audited.

## Events

| Type                   | When                                  | subjectMemberId                            |
| ---------------------- | ------------------------------------- | ------------------------------------------ |
| `referral.recorded`    | a join is attributed / a code claimed | invitee's member                           |
| `referral.validated`   | RETAINED → VALID                      | inviter's member (null for vanity/unknown) |
| `referral.invalidated` | staff invalidation                    | inviter's member                           |

Consumes `member.left` (subscriber `invites.referral-left`).

## Notifications

`referral.validated` (notice, DM + inbox) to the inviter:
`REFERRAL VALIDATED — <name> is now a valid referral. Valid referrals: 3.`
The invitee's name is replaced by "A member you referred" when their profile
is staff-only. Dedupe key `referral:<id>:validated`.

## Jobs

| Type                      | Schedule | Work                                                        |
| ------------------------- | -------- | ----------------------------------------------------------- |
| `invites.referrals.sweep` | hourly   | close missed leaves → promote RETAINED → validate (batched) |

Idempotent: every transition is guarded by the current status.

## Discord job contracts

None. The module never needs the bot to _act_ on Discord. The bot **feeds**
it. Bot responsibilities (feature `apps/bot/src/features/invites`):

1. **On ready**: `gateway.listInvites()` → cache the snapshot in memory →
   `invites.syncInvites(systemCtx, snapshot)`.
2. **On `inviteCreate` / `inviteDelete`** (the existing `onInvitesChanged`
   hook): re-fetch, replace the cache, `syncInvites`.
3. **On `guildMemberAdd`** (non-bot), serialized per guild:
   - `before` = in-memory cache, or `invites.inviteUsageSnapshot(systemCtx)`
     when the cache is cold (restart);
   - `after` = `gateway.listInvites()`;
   - `const d = invites.detectUsedInvite(before, after)`;
   - `const { user } = await recordGuildJoin(ctx, profile)`;
   - `invites.attributeJoin(ctx, { inviteeUserId: user.id, usedCode: d.code, vanity: d.method === 'vanity', joinedAt: member.joinedAt })`;
   - `syncInvites(ctx, after)`; cache = `after`.
4. **On `guildMemberRemove`**: `recordGuildLeave` (already done by the core
   feature) — the `member.left` event drives the referral.
5. Snapshot mapping: the bot's `InviteSnapshot` maps 1:1; additionally set
   `vanity: true` on the vanity entry, and pass `inviterUsername` when the
   invite object carries the inviter. Never call `syncInvites` after a failed
   fetch: an empty list means "no invites" and marks every code deleted.
   A snapshot holds at most 1000 regular invites (Discord's cap) plus the
   vanity entry; larger or duplicate-code snapshots are rejected.

Required Discord access:

- Permission **Manage Guild** — Discord only returns guild invites and vanity
  usage to it. Intents: `GuildInvites` (create/delete events) and the
  privileged `GuildMembers` (member add/remove).
- **Least-privilege trade-off**: Manage Guild also allows editing server
  settings. JAVE's `DiscordGateway` exposes only `listInvites()` for it, so the
  bot never exercises the rest. Operators who refuse the permission lose
  invite-link attribution (every join becomes `unknown`); referral codes,
  campaigns via codes, the lifecycle, leaderboard and funnels keep working.

## Extension points

- `DEFAULT_ANOMALY_RULES`, `ANOMALY_WEIGHTS` — tune thresholds; `detectAnomalies`
  takes rules as a parameter.
- Settings: `analytics.retentionDays`, `analytics.validRequiresOnboarding`,
  `analytics.referralAnomalyThreshold`, `security.suspiciousAccountAgeDays`.
- `referral.validated` event for achievements (e.g. "RECRUITER — 3 valid referrals").
- `listReferrals({ flagged: true })` + `reviewReferral` for a dashboard review queue.

## Known limitations

- Detection is inherently ambiguous under truly concurrent joins; those joins
  are recorded as `unknown` rather than guessed.
- Invite `uses` are cumulative, so campaign/inviter INVITED counts include uses
  before an invite was attached to a campaign, and funnels are all-time.
- The sweep rescores each validation candidate individually (bounded by
  batch size); very large backlogs take several hourly runs.
- `requireSystemActor` lives in `invites/access.ts` and is also used by
  analytics; it could be promoted to `permissions/authorize.ts`.
