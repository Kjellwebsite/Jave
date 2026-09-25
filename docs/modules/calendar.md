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
        (tournament final reported ⇒ completed if still open; sweep completes events 12 h past their end)

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
- Match results can be reported until the final, also after the event itself was
  completed (by staff or the sweep): the evening may end before the bracket does.
  Only a cancelled event freezes its bracket.

## Services

| Function                                                        | Access                         | Notes                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduleEvent`                                                 | `canManageEvents`              | Title ≤ 100, description ≤ 1000, location ≤ 100 (Discord limits). Start in the future, ≤ 400 days ahead; end > start, ≤ 7 days; default end = start + 2 h. |
| `updateEvent`                                                   | `canManageEvents`              | Field-level audit diff; revision bump; reminders re-planned by dedupe key.                                                                                 |
| `cancelEvent`                                                   | `canManageEvents`              | Reason required; notifies going/maybe/waitlist; enqueues Discord cleanup.                                                                                  |
| `markEventLive` / `completeEvent`                               | `canManageEvents`              | Live from start − 30 min; complete once started.                                                                                                           |
| `getEvent` / `listEvents`                                       | any member, system             | `upcoming` (open, not ended, soonest first) or `past`; includes counts, `rsvpOpen`/`declineOpen` and the viewer's RSVP. Never exposes the check-in hash.   |
| `rsvp`                                                          | member in good standing        | `going`/`maybe`/`declined`; serialized by the event row lock; 20 changes/min per member.                                                                   |
| `listParticipants`                                              | `canManageEvents`              | Includes Discord ids — staff only.                                                                                                                         |
| `listMemberEventHistory`                                        | self or `canManageEvents`      | Denials audited (`access.denied`).                                                                                                                         |
| `generateCheckInCode`                                           | `canManageEvents`              | Returns `ABCD-EFGH` once; stores `sha256(eventId:code)`; rotating invalidates the old code.                                                                |
| `checkIn`                                                       | member in good standing        | Window `[start − 30 min, end]` inclusive; idempotent; 5 attempts / 10 min per member and event; failures audited.                                          |
| `createTeam` / `createRandomTeams` / `deleteTeam` / `listTeams` | staff / staff / staff / member | One team per member per event (unique index). Random draw from unassigned `going` RSVPs, deterministic per seed (default: event id), sizes differ by ≤ 1.  |
| `generateBracket`                                               | `canManageEvents`              | Tournament events, 2–128 teams, `seeded` (team seed, then name) or `random` (seeded shuffle).                                                              |
| `reportMatch`                                                   | `canManageEvents`              | Scores 0–1 000 000; ties and forfeits need `winner`. The final completes the tournament (and the event, if still open). Refused for cancelled events.      |
| `getBracket`                                                    | any member                     | Rounds named Round n / Quarterfinals / Semifinals / Final; champion when done.                                                                             |

Pure helpers (unit-tested): `buildSingleElimination`, `seedOrder`, `decideWinner`,
`drawTeams`, `checkInWindow`, `isRsvpOpen`, `isDeclineOpen`, `announcementRefreshTimes`,
`classifyLocation`, `discordObjectVerdict`.

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
| `event.reminder`         | going members, at start − 24 h and − 1 h     | `event:<id>:reminder:<key>:<startMs>:<member>` (key `24h` or `1h`)            |
| `event.updated` _(new)_  | going/maybe/waitlist on reschedule or cancel | `event:<id>:rescheduled:<startMs>:<member>` / `event:<id>:cancelled:<member>` |
| `event.waitlist` _(new)_ | promoted member                              | `event:<id>:promoted:<nowMs>:<member>`                                        |

## Jobs

| Type                | Schedule                                              | Behaviour                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calendar.reminder` | at start − 24 h / − 1 h (only if still in the future) | Skips cancelled/live/completed events and stale payloads (start moved). Dedupe key includes the planned start, so a reschedule never collides with an in-flight job. Each recipient's notification (inbox row, deliveries, delivery job) commits in its own transaction, so a failed attempt leaves nothing half-written and the retry delivers. |
| `calendar.sweep`    | recurring, every 15 min                               | Completes scheduled/live events more than 12 h past their end (batch 100). System actor only.                                                                                                                                                                                                                                                    |

## Discord job contracts

Payloads are zod-validated (`discordEventsPublishPayloadSchema`, `discordEventsCancelPayloadSchema`).
Every job is an idempotent full sync from `getEventPublication`, and several can be due
for one event:

| Publish job (dedupe key)                         | Payload                 | Enqueued                                                                                                        |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `discord.events.publish:<id>:r<rev>`             | `{ eventId, revision }` | every change the mirror must show (revision bump)                                                               |
| `discord.events.publish:<id>:counts:<windowEnd>` | `{ eventId }`           | RSVP changes, one per event per 30 s window, at its end                                                         |
| `discord.events.publish:<id>:at:<ms>`            | `{ eventId }`           | at the RSVP close and at the end (buttons change); re-planned when those times move, dropped on cancel/complete |
| `discord.events.publish:<id>:late:<objectIds>`   | `{ eventId }`           | a run stored objects it rendered from an older revision (the newer revision's job may have missed them)         |

A revision job whose revision is older than the publication's skips (`superseded`); a
refresh has no revision and always runs. Count refreshes use one key per window, so an
RSVP made while a refresh runs lands in the next window instead of being dropped.

**Serialization and compare-and-set.** The bot runs at most one `discord.events.*`
handler per event at a time (a per-event lock in the worker process). Core is the
backstop when runs still overlap (two bot processes, `runNow` next to the poll loop):
`markEventPublished` stores one object per slot. Each run reports only what it created,
with the id the publication showed for that slot (`replaces`, null for a first create):

- stored id equals the reported id → kept (a retried callback);
- stored id equals `replaces` → stored;
- otherwise → returned in `discard`: the bot deletes that duplicate and edits `stored`.

The callback runs under the event row lock and takes the `revision` the bot rendered from
(ahead of the event ⇒ `ValidationError`). Objects stored after a cancellation get their own
`discord.events.cancel` job, keyed by the new object ids, so it is never dropped behind a
cancel run that is still in flight and saw no objects; objects rendered from an older
revision get a `:late:` sync job the same way.

### `discord.events.publish` — create or sync

1. `getEventPublication(ctx, eventId)` (system only). If the payload has a `revision` and
   the publication's is newer, return `{ skipped: 'superseded' }`.
2. If `status === 'cancelled'`, do nothing (the cancel job owns that path).
3. Edit the Scheduled Event when `discordScheduledEventId` is set: name, description,
   start/end, voice/stage channel (`location.kind === 'channel'`) or external location
   (`url`/`text`, "JAVELIN" if none). Status ACTIVE when live, COMPLETED when completed
   (**gateway extension needed**: `editScheduledEvent` has no status yet). Create one when
   it is null (or Unknown Scheduled Event) and the event is scheduled or live — never for
   a completed event.
4. Edit the announcement when `announcementMessageId` is set; otherwise, when
   `announceChannelId` (settings.channels.events) is set and the event is scheduled or live,
   post one (also after Unknown Message). Panel: title, time, location, capacity and spots
   left, RSVP buttons `events:rsvp:<eventId>:going|maybe|declined` — going/maybe disabled
   when `rsvpOpen` is false, declined disabled when `declineOpen` is false. User text
   through `userText()`; `allowedMentions: { parse: [] }`. Clicks call `calendar.rsvp` as
   the clicking user — the custom id never authorizes.
5. Report created objects with the publication's revision: `markEventPublished(ctx,
{ eventId, revision, scheduledEvent: { id, replaces }, announcement: { channelId,
messageId, replaces } })` (either part optional, at least one). Delete everything in the
   result's `discard`; apply the content to `result.stored`.

**Permissions**: Manage Events (create/edit/delete scheduled events); in the announcement
channel View Channel, Send Messages, Embed Links; for a channel location View Channel +
Connect.

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
- Two publish runs that overlap across bot processes can finish out of order and leave an
  older edit on Discord until the next sync (the compare-and-set prevents duplicate
  objects, not stale edits). The per-event lock in the bot rules this out within a process.
- The waitlist is FIFO by response time; responses in the same millisecond are ordered by
  row id, not arrival. A position returned by `rsvp` during a burst is a snapshot and can
  grow when a same-millisecond response commits later; the committed queue is always one
  strict order.
- **Blocked on shared code:** `consumeRateLimit` (`packages/core/src/rate-limit`) passes raw
  `Date`s into a `sql` template, which the production postgres-js driver cannot serialize,
  so `rsvp` and `checkIn` throw on real Postgres until it is fixed (PGlite hides it). The
  real-Postgres RSVP test below fails for that reason alone.

## Concurrency tests

PGlite (the default test database) executes one transaction at a time, so `Promise.all`
tests there check sequential invariants only; lock tests on PGlite assert that the row lock
is taken before the read it protects (statement order). Real interleaving runs in the
opt-in `*.pg.test.ts` suites against a real server — each run creates, migrates and drops
its own `jave_locktest_*` database:

```
cd packages/core
JAVE_TEST_POSTGRES_URL='postgres://jave:jave@localhost:5432/jave' \
  npx vitest run src/calendar/concurrency.pg.test.ts src/games/concurrency.pg.test.ts --maxWorkers=1
```

They cover RSVP capacity under a burst, duplicate match reports, the per-host session cap
and concurrent answers (version retries). Removing the RSVP event lock or the host-row lock
makes them fail (verified).
