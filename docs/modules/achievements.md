# Achievements

`packages/core/src/achievements` · schema `packages/database/src/schema/achievements.ts`

## Purpose

Achievements mark **verified outcomes** — a mission verified, a project shipped, a
trial passed. They are data-driven: staff define them, a rule engine awards them
from domain events, and staff can award or revoke them by hand. They are
descriptive records, never a score: there is no points total, no XP, and Discord
activity never counts.

```ts
import { achievements } from '@jave/core';
await achievements.seedStarterAchievements(ctx);
await achievements.awardAchievement(ctx, { memberId, key: 'team_leader', reason: 'Led team 3.' });
```

## Definitions

| Field                  | Notes                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `key`                  | `^[a-z][a-z0-9_]{1,63}$`, immutable primary key.                                     |
| `title`                | 2–64 chars, single line. Rendered upper-case in copy.                                |
| `summary`              | 3–120 chars. The unlock line: `ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.` |
| `description`          | 3–1000 chars.                                                                        |
| `category`             | `^[a-z][a-z0-9_]{1,31}$`.                                                            |
| `rarity`               | `standard` · `notable` · `rare` · `exceptional` · `singular`.                        |
| `visibility`           | `public` · `hidden` (masked as HIDDEN until unlocked).                               |
| `criteria`             | `{ type: 'event_count', event, threshold }` or `{ type: 'manual' }` (see below).     |
| `requiresVerification` | Awards start UNVERIFIED and need a second person.                                    |
| `facetKey`             | Optional capability facet (validated against the catalog).                           |
| `active`, `ordinal`    | Inactive definitions are never awarded; ordinal orders the catalog.                  |

### Criteria

- `event_count`: `event` must be a `DOMAIN_EVENTS` type **eligible for achievements**
  (`ACHIEVEMENT_EVENT_TYPES`), `threshold` is an integer 1–10 000. The rule is met
  when the member is the `subjectMemberId` of at least `threshold` events of that type.
- `manual`: awarded by staff only.

Eligible events are an explicit **allow-list** (`ACHIEVEMENT_EVENT_TYPES`) of
verified outcomes decided by someone other than the member:
`application.accepted`, `verification.approved`, `trial.result_published`,
`trial.passed`, `adversarial.revealed`, `mission.completed`, `project.created`,
`project.shipped`, `contribution.verified`, `research.verified`. Events appended
to the catalog later drive nothing until they are added on purpose.

Deliberately absent: Discord presence and activity (joins, RSVPs, event
check-ins, games, tournament matches), self-reported or unreviewed actions
(claims, submissions of any kind, profile edits, joining a project), negative
outcomes (rejections, expiries, moderation), ambiguous events whose outcome is
only in the payload (`capability.verified`, `evidence.reviewed`,
`research.reviewed`, `project.status_changed`), staff and system operations
(something created, scheduled, published, selected or closed), and achievement
events themselves (no feedback loops).

**First-step events** (`FIRST_STEP_ONLY_EVENTS`: `project.created`) are ones a
member triggers alone. A rule on them must use threshold 1, so repeating the
action can never farm an achievement.

A stored rule that no longer validates (for example, one on an event that was
removed from the allow-list) is inert: the engine never matches it and the
retroactive evaluation skips it.

### Starter catalog

`seedStarterAchievements` is idempotent (existing keys are left as staff last
edited them) and queues a retroactive evaluation for each new rule.

| Key                           | Rule                         | Rarity      | Visibility |
| ----------------------------- | ---------------------------- | ----------- | ---------- |
| `first_mission`               | `mission.completed` × 1      | standard    | public     |
| `first_project`               | `project.created` × 1        | standard    | public     |
| `first_verified_contribution` | `contribution.verified` × 1  | standard    | public     |
| `first_trial`                 | `trial.result_published` × 1 | standard    | public     |
| `trial_pass`                  | `trial.passed` × 1           | notable     | public     |
| `project_shipped`             | `project.shipped` × 1        | notable     | public     |
| `researcher`                  | `research.verified` × 3      | notable     | public     |
| `builder`                     | `project.shipped` × 3        | rare        | public     |
| `operator`                    | `mission.completed` × 10     | rare        | public     |
| `team_leader`                 | manual                       | notable     | public     |
| `adversary`                   | `adversarial.revealed` × 1   | rare        | hidden     |
| `relentless`                  | `mission.completed` × 25     | exceptional | hidden     |
| `keystone`                    | `contribution.verified` × 25 | exceptional | hidden     |

## Award lifecycle

```
            (engine / system / staff)          (staff, another person)
  none ───────────── award ─────────────► UNVERIFIED ──── verify ────► VERIFIED
    ▲                   │ requiresVerification = false                    │
    │                   └──────────────────────────────► VERIFIED         │
    │                                                       │             │
    └──── manual award only ◄──── REVOKED ◄──── revoke ─────┴─────────────┘
```

- One active award per member and definition (partial unique index
  `member_achievements_active_uq`); a revoked award keeps its row.
- **Revocation is sticky.** The rule engine, retroactive evaluation and system
  grants (mission rewards) never re-award a definition the member ever held.
  Only a manual staff award restores it (a new row; history is preserved).
- Deleted and banned members are never awarded.

## Rule engine

Subscriber `achievements.engine`, `types = ACHIEVEMENT_EVENT_TYPES` — the static
allow-list, not the current definitions. Every eligible event is therefore
delivered to the engine; the handler exits early when the event has no
`subjectMemberId` or no active rule counts that event type.

Rules are **read from the database for every delivered event**, never from a
per-process cache. Staff edit rules in the dashboard process while the bot's
worker applies them; a cached rule set in the worker would miss events under a
new rule (or keep awarding under a retired one) until it expired. The lookup is
one query on the small definitions table.

For a matching event the engine loads the member (skips deleted/banned), drops
rules the member ever held, counts **all** of the member's events of that type,
and awards every rule whose threshold is met, each in its own transaction. Inside
that transaction the rule is re-read under a share lock (`lockCurrentRule`): a
concurrent edit either commits first (and the award follows the edited rule) or
waits until the award commits.

Idempotency: the count is over history (not +1 per delivery) and the award
insert is guarded by the partial unique index (`ON CONFLICT DO NOTHING`), so
duplicate or concurrent deliveries award at most once, with one event and one
notification.

Retroactive evaluation (`achievements.evaluate_definition`) runs when a rule is
created, re-activated, or its criteria change. It awards everyone whose history
already meets the rule, in batches of 200 (re-queuing itself), and does **not**
post public announcements (a new rule must not flood the channel); members are
still notified. Each backfilled award re-reads the rule under the same share
lock; when the rule was edited, deactivated or deleted since the run started,
the run stops. The edit queued its own run: the dedupe key carries the rule
version (`achievements:evaluate:<key>:<updatedAt>`), so an edit made while a run
is in progress is never dropped.

## Capabilities

| Action                                             | Capability                                 |
| -------------------------------------------------- | ------------------------------------------ |
| Create / update / delete / list definitions, seed  | `canManageAchievements` (CORE, FOUNDER)    |
| Award, revoke, verify awards; read revoked history | `canAwardAchievements` (OPERATIONS+)       |
| Catalog                                            | anyone (hidden masked for non-staff)       |
| Member achievements                                | identity profile visibility (`getProfile`) |
| Rarity stats                                       | `canViewMembers`                           |
| `awardAchievementFromSystem`, Discord callbacks    | system actor only                          |

Nobody awards, revokes or verifies their own achievements (blocked and audited
as `achievement.self_<action>_blocked`). The person who awarded an
UNVERIFIED award cannot verify it.

## Views

- `getAchievementCatalog(ctx, { includeInactive? })` — hidden definitions are
  masked (`{ masked: true, slot, title: 'HIDDEN', rarity }`) unless the viewer
  unlocked them; staff (`canManageAchievements` or `canAwardAchievements`) see
  everything. `includeInactive` requires `canManageAchievements`.
- `listMemberAchievements(ctx, { memberId, includeRevoked? })` — visibility is
  delegated to `identity.getProfile` (an invisible profile is NOT_FOUND).
  Unlocked hidden achievements show on the holder's profile, as in `getProfile`.
- `getAchievementRarityStats(ctx)` — share of **active members** (present in
  the guild, not deleted, not banned) holding each active achievement, one decimal.

## Events

| Event                  | When                                       | Subject |
| ---------------------- | ------------------------------------------ | ------- |
| `achievement.unlocked` | Any award (payload: key, source, verified) | holder  |
| `achievement.verified` | An UNVERIFIED award was verified           | holder  |
| `achievement.revoked`  | An award was revoked                       | holder  |

## Notifications

| Type                   | Copy                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `achievement.unlocked` | `ACHIEVEMENT UNLOCKED` · `BUILDER — 3 projects shipped.` (+ ` Pending verification.`)                                               |
| `achievement.updated`  | `ACHIEVEMENT VERIFIED` · headline, or `ACHIEVEMENT REVOKED` · `TITLE — revoked by staff. Open a ticket if you think this is wrong.` |

Dedupe keys: `achievement:<awardId>:unlocked|verified|revoked`.

## Audit

`achievement.definition_created|updated|deleted`, `achievement.starter_seeded`,
`achievement.awarded` (with reason), `achievement.revoked` (with reason),
`achievement.verified`, `achievement.self_*_blocked` (denied, durable).

## Jobs

| Job                                      | Kind       | Purpose                            |
| ---------------------------------------- | ---------- | ---------------------------------- |
| `events.deliver` → `achievements.engine` | subscriber | Rule engine                        |
| `achievements.evaluate_definition`       | core       | Retroactive evaluation of one rule |

## Discord job contracts

### `discord.achievements.announce`

Payload `{ memberAchievementId: uuid, channelId: snowflake }`
(`achievementAnnouncePayloadSchema`). Queued for a **verified** award when
`settings.notifications.announceAchievements` is on, `settings.channels.achievements`
is set, the definition is `public`, and the member's profile is not staff-only.
Backfilled awards are never announced.

Bot:

1. `getAchievementAnnouncement(ctx, { memberAchievementId })` → `null` means do
   nothing (revoked, unverified, hidden, private, or already announced).
2. Post one message in `channelId` using `line`
   (`ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.`), `description`,
   rarity, and `<@memberDiscordId>` with `allowedMentions: { parse: [] }`.
   Escape all text with `userText()`.
3. `markAchievementAnnounced(ctx, { memberAchievementId, channelId, messageId })`.
   `{ stored: false }` → another attempt won; delete the message just posted.
   If the award was revoked meanwhile, the callback queues the retraction in
   the same transaction as the report. If the callback **throws**, nothing was
   stored: delete the message just posted, then fail the job so the retry starts
   again at step 1.

Permissions in the channel: **View Channel, Send Messages, Embed Links**.

### `discord.achievements.retract`

Payload `{ memberAchievementId, channelId, messageId }`. Queued when an announced
award is revoked. Bot deletes its own message; unknown message/channel = done.
No callback. Permissions: **View Channel** (deleting its own message needs no
Manage Messages).

## Extension points

- New rule types: extend `achievementCriteriaSchema` (discriminated union) and the
  engine. The JSON column already stores arbitrary criteria; unknown stored
  rules are treated as inert (`parseStoredCriteria`).
- `awardAchievementFromSystem` is the entry point for other modules that grant
  achievements as a consequence of their own verified outcomes (missions use it
  for rewards).
- `ACHIEVEMENT_EVENT_TYPES` is the single list to edit when a new catalog event
  records a verified outcome that should count (opt-in). Add it to
  `FIRST_STEP_ONLY_EVENTS` too when the member triggers it alone.

## Known limitations

- Rules count event types only; they cannot filter on payload (e.g. "trials
  passed with distinction"). Such achievements are manual for now.
- The engine counts `subjectMemberId`. Modules that emit one event for many
  members (a team shipping a project) must publish one event per member for
  each to count.
- `adversary` assumes `adversarial.revealed` carries the adversary as
  `subjectMemberId` (the adversarial module owns that event).
- Every delivered eligible event costs one query on the definitions table, even
  when no rule counts it (the price of never applying a stale rule).
- The locking that orders awards against concurrent rule edits cannot be
  exercised under PGlite, which runs one transaction at a time; the tests cover
  the sequential behaviour.
- Revoking does not decrement anything: counts are over immutable events.
