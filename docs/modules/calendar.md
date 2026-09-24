# Module: calendar (JAVELIN events & tournaments)

`packages/core/src/calendar` — `import { calendar } from '@jave/core'`.
Named _calendar_ because `events` is the domain-event bus.

JAVELIN events are meetups, workshops, talks, tournaments, sessions and socials.
The module owns scheduling, RSVPs with capacity and a FIFO waitlist, code-based
check-in, reminders, the Discord mirror (Scheduled Event + announcement), teams,
and single-elimination tournaments. Schema: `packages/database/src/schema/events.ts`.

## State machines

```
event:  scheduled ──markEventLive──► live ──completeEvent──► completed
            │  └──────────────completeEvent (after start)──────►│
            └──cancelEvent──► cancelled ◄──cancelEvent── live
        (tournament final reported ⇒ completed; sweep completes events 12 h past their end)

rsvp:   (none) ─► going | maybe | declined
        going beyond capacity ─► waitlist ─(spot frees, FIFO)─► going
        check-in ⇒ going + checkedInAt (attendance overrides the waitlist)

match:  pending ─(both teams known)─► ready ─reportMatch─► completed
        round-1 bye ─► bye (winner advances at generation)
```

- Only `scheduled` events can be edited. A new start keeps the duration unless a
  new end is given, re-plans reminders and notifies everyone who responded.
- RSVPs are open until `rsvpClosesAt` (exclusive) or the end; declining stays
  open until the end because it frees a spot.
- Lowering capacity never removes anyone; raising it promotes from the waitlist.
- Teams are locked once a bracket exists; results are final once recorded.

## Services

| Function                                                        | Access                         | Notes                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduleEvent`                                                 | `canManageEvents`              | Title ≤ 100, description ≤ 1000, location ≤ 100 (Discord limits). Start in the future, ≤ 400 days ahead; end > start, ≤ 7 days; default end = start + 2 h. |
| `updateEvent`                                                   | `canManageEvents`              | Field-level audit diff; revision bump; reminders re-planned by dedupe key.                                                                                 |
| `cancelEvent`                                                   | `canManageEvents`              | Reason required; notifies going/maybe/waitlist; enqueues Discord cleanup.                                                                                  |
| `markEventLive` / `completeEvent`                               | `canManageEvents`              | Live from start − 30 min; complete once started.                                                                                                           |
| `getEvent` / `listEvents`                                       | any member, system             | `upcoming` (open, not ended, soonest first) or `past`; includes counts and the viewer's RSVP. Never exposes the check-in hash.                             |
| `rsvp`                                                          | member in good standing        | `going`/`maybe`/`declined`; serialized by the event row lock; 20 changes/min per member.                                                                   |
| `listParticipants`                                              | `canManageEvents`              | Includes Discord ids — staff only.                                                                                                                         |
| `listMemberEventHistory`                                        | self or `canManageEvents`      | Denials audited (`access.denied`).                                                                                                                         |
| `generateCheckInCode`                                           | `canManageEvents`              | Returns `ABCD-EFGH` once; stores `sha256(eventId:code)`; rotating invalidates the old code.                                                                |
| `checkIn`                                                       | member in good standing        | Window `[start − 30 min, end]` inclusive; idempotent; 5 attempts / 10 min per member and event; failures audited.                                          |
| `createTeam` / `createRandomTeams` / `deleteTeam` / `listTeams` | staff / staff / staff / member | One team per member per event (unique index). Random draw from unassigned `going` RSVPs, deterministic per seed (default: event id), sizes differ by ≤ 1.  |
| `generateBracket`                                               | `canManageEvents`              | Tournament events, 2–128 teams, `seeded` (team seed, then name) or `random` (seeded shuffle).                                                              |
| `reportMatch`                                                   | `canManageEvents`              | Scores 0–1 000 000; ties and forfeits need `winner`. The final completes the tournament and the event.                                                     |
| `getBracket`                                                    | any member                     | Rounds named Round n / Quarterfinals / Semifinals / Final; champion when done.                                                                             |

Pure helpers (unit-tested): `buildSingleElimination`, `seedOrder`, `decideWinner`,
`drawTeams`, `checkInWindow`, `isRsvpOpen`, `classifyLocation`.

## Capabilities

Uses existing `canManageEvents` (operations and above). No new capabilities.

## Domain events

| Type                           | Subject          | When                                                                  |
| ------------------------------ | ---------------- | --------------------------------------------------------------------- |
| `event.created`                | —                | scheduled                                                             |
| `event.updated` _(new)_        | —                | edited (payload: fields, rescheduled)                                 |
| `event.started` _(new)_        | —                | went live                                                             |
| `event.cancelled` _(new)_      | —                | cancelled                                                             |
| `event.completed`              | —                | completed (payload: source manual/tournament/sweep, going, checkedIn) |
| `event.rsvp`                   | member           | response changed, incl. waitlist promotion (`promoted: true`)         |
| `event.checked_in`             | member           | first check-in                                                        |
| `tournament.match_completed`   | —                | a match result                                                        |
| `tournament.completed` _(new)_ | each participant | the final; payload `placement` 1/2/null, `won`, `eliminatedInRound`   |

## Notifications

| Type                     | Recipients                                   | Dedupe                                                                        |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `event.reminder`         | going members, at start − 24 h and − 1 h     | `event:<id>:reminder:<24h                                                     | 1h>:<startMs>:<member>` |
| `event.updated` _(new)_  | going/maybe/waitlist on reschedule or cancel | `event:<id>:rescheduled:<startMs>:<member>` / `event:<id>:cancelled:<member>` |
| `event.waitlist` _(new)_ | promoted member                              | `event:<id>:promoted:<nowMs>:<member>`                                        |

## Jobs

| Type                | Schedule                                              | Behaviour                                                                                                                                                            |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar.reminder` | at start − 24 h / − 1 h (only if still in the future) | Skips cancelled/live/completed events and stale payloads (start moved). Dedupe key includes the planned start, so a reschedule never collides with an in-flight job. |
| `calendar.sweep`    | recurring, every 15 min                               | Completes scheduled/live events more than 12 h past their end (batch 100). System actor only.                                                                        |

## Discord job contracts

Payloads are zod-validated (`discordEventsPublishPayloadSchema`, `discordEventsCancelPayloadSchema`):
`{ eventId, revision }`. Every change the mirror must reflect bumps `events.revision`;
one job per revision (`discord.events.publish:<id>:r<rev>`), so a handler that sees a
newer revision skips (`superseded`).

### `discord.events.publish` — create or sync

1. `getEventPublication(ctx, eventId)` (system only). Skip if `revision` is newer than the payload's.
2. If `status === 'cancelled'`, do nothing (the cancel job owns that path).
3. Create the Scheduled Event when `discordScheduledEventId` is null, else edit it: name,
   description, start/end, voice/stage channel (`location.kind === 'channel'`) or external
   location (`url`/`text`, "JAVELIN" if none). Status ACTIVE when live, COMPLETED when
   completed (**gateway extension needed**: `editScheduledEvent` has no status yet).
4. When `announceChannelId` (settings.channels.events) is set, post or edit the announcement
   panel: title, time, location, capacity and spots left, RSVP buttons
   `events:rsvp:<eventId>:going|maybe|declined` (disabled when `rsvpOpen` is false).
   User text through `userText()`; `allowedMentions: { parse: [] }`. Clicks call
   `calendar.rsvp` as the clicking user — the custom id never authorizes.
5. Report ids with `markEventPublished(ctx, { eventId, discordScheduledEventId,
announcementChannelId, announcementMessageId })`. If the event was cancelled meanwhile,
   the callback enqueues a fresh cancel job.

RSVP changes also enqueue a debounced refresh of the same type
(`discord.events.publish:<id>:counts`, 30 s delay, at most one pending per event).

**Permissions**: Manage Events; in the announcement channel View Channel, Send Messages,
Embed Links; for a channel location View Channel + Connect.

### `discord.events.cancel`

1. `getEventPublication`; skip unless `status === 'cancelled'`.
2. Cancel the Scheduled Event if present (unknown/already cancelled = success).
3. Edit the announcement to a CANCELLED panel with `cancelReason`, removing buttons.
   No callback; attendees are notified by core.

**Permissions**: Manage Events; announcement channel View Channel, Send Messages, Embed Links.

## Extension points

- Reminder offsets: `EVENT_REMINDERS` in `constants.ts` (add an entry; keys are part of dedupe keys).
- Other bracket formats: `bracket.ts` is pure; a double-elimination builder can feed the
  same `tournament_matches` rows (`next_match_id`/`next_slot`).
- Surfaces render local times from the ISO instants in notification `data`
  (`formatEventTime` is UTC and locale-independent).

## Known limitations

- Live events cannot be edited (e.g. extending the end); complete or cancel instead.
- Match results cannot be corrected once recorded.
- The Scheduled Event status (ACTIVE/COMPLETED) needs a small gateway extension in the bot.
- The check-in code is shared on site or on stream; anyone holding it inside the window can
  check in (bounded by the per-member rate limit and the 40-bit code space).
- The RSVP rate limit (Postgres-backed, shared across processes) also counts idempotent
  re-sends.
- Reminders go to every `going` member regardless of standing; surfaces decide delivery.
