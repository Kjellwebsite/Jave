# Events and tournaments: Discord and dashboard

Feature `apps/bot/src/features/events` · custom-id namespace `events` ·
dashboard `apps/dashboard/app/(console)/events` · domain `@jave/core`
`calendar` (see [docs/modules/calendar.md](../modules/calendar.md)).

Replies are **ephemeral** unless noted. The only public message is the event
**announcement** the publish job posts in `channels.events` (title, time,
place, capacity, RSVP buttons). Participant lists, check-in codes, staff
controls and match reporting never appear in a channel.

Custom ids route; they never authorize. Every handler calls core as the
clicking user, so forged, stale or replayed ids fail closed: a member pressing
a staff control gets **ACCESS RESTRICTED** (core audits `access.denied`), an
id that does not parse gets **EXPIRED — This control is no longer active.**,
and an unknown event gets **NOT FOUND**. Staff modals (create, cancel, report)
are gated on `canManageEvents` before they open, so nobody types into a form
that will be refused; core re-checks on submit.

## Slash command `/events`

Every per-event subcommand takes an optional `event` option (autocomplete by
title over upcoming events and the ten most recent past ones: a bracket can
finish after its evening ends). A typed value that is not an event id answers
"Choose an event from the list." Leaving the option empty never fails:

- `view` without an event → the upcoming list;
- `checkin` without an event → a picker of the events whose check-in is open now;
- every staff subcommand without an event → **CHOOSE AN EVENT**, a picker over
  upcoming and recent events that opens the event card, which carries every
  control the clicking member may use.

| Subcommand     | Who                                 | Flow                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`         | any member                          | Up to ten upcoming events (soonest first) with your response. The first four get a numbered row of **GOING / MAYBE / DECLINE** buttons (`01 GOING` matches line `01`); an **Open an event** select opens any of them. An RSVP updates the list in place with `RSVP RECORDED — GOING — <title>.` or `WAITLIST #n — …`.                                                                                                       |
| `view`         | any member                          | The event card: when (Discord timestamps, so every viewer sees their own zone), where, capacity and spots left, responses, your RSVP (waitlist position, check-in time). Buttons: GOING / MAYBE / DECLINE (your current answer disabled; closed answers disabled), **Check in** while the window is open and a code exists, **Bracket** for tournaments. Staff additionally see the check-in window and the controls below. |
| `checkin`      | member in good standing             | **EVENT CHECK-IN** modal with the code (`ABCD-EFGH`, case and dashes ignored). Window: 30 minutes before the start until the end. 5 attempts per 10 minutes per member and event; failures are audited. Checking in marks you GOING, also from the waitlist.                                                                                                                                                                |
| `create`       | `canManageEvents`                   | Options `kind` (default meetup) and `capacity` (1–10 000; beyond it members join a FIFO waitlist). **NEW <KIND>** modal: title (3–100), description (≤ 1000), start, duration (select, 1–24 h, default 2 h), location (voice/stage channel id, http(s) link or a place, ≤ 100). The start is typed as `YYYY-MM-DD HH:mm` in your JAVE time zone (your preference), ISO 8601 with an offset, or a Discord timestamp `<t:…>`. |
| `live`         | `canManageEvents`                   | From 30 minutes before the start until the end. The Discord event becomes ACTIVE.                                                                                                                                                                                                                                                                                                                                           |
| `complete`     | `canManageEvents`                   | Once the event has started. Reports `checked in of going`; the Discord event becomes COMPLETED.                                                                                                                                                                                                                                                                                                                             |
| `cancel`       | `canManageEvents`                   | **CANCEL EVENT** modal: reason (3–500), sent to everyone who responded. The Discord event is cancelled (deleted if already active: Discord cannot cancel an active event) and the announcement loses its buttons.                                                                                                                                                                                                           |
| `checkin-code` | `canManageEvents`                   | Issues a code and shows it **once**, in a fresh ephemeral message with its window. JAVE stores only `sha256(eventId:code)`; issuing again rotates it and the old code stops working.                                                                                                                                                                                                                                        |
| `teams`        | any member (view), staff (draw)     | The teams panel (name, seed, members). Staff, while the event is open and before a bracket exists, get a **Draw random teams from GOING members** select (solo … teams of 12); `size:` draws right away. The draw takes every GOING member not yet on a team, in a deterministic fair order (sizes differ by at most one), and is audited.                                                                                  |
| `bracket`      | any member (view), staff (generate) | The single-elimination bracket as a **monospace block** (round names, seeds, scores, `◀` for the winner, `W`/`FF` for forfeits, the champion). Staff get **GENERATE · SEEDED** / **GENERATE · RANDOM** while a tournament has no bracket (2–128 teams; byes go to the top seeds; teams lock) and a **Report a match result** select while matches are ready. Too large for one embed → truncated with a dashboard link.     |
| `report`       | `canManageEvents`                   | A select of the matches ready for a result, then **REPORT RESULT**: both scores (whole numbers ≤ 1 000 000) or neither, and **Winner** — "By score" unless it was a forfeit or a tied score. Results are final; the winner advances; the final completes the tournament (and the event, if still open). Allowed after the event was completed; refused once it was cancelled.                                               |

## Context menu

| Menu                            | Who                                    | Flow                                                                                                                  |
| ------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| User → Apps → **Event History** | yourself; anyone for `canManageEvents` | The member's last ten responses (date, title, kind, response, ATTENDED ✓, CANCELLED). Others are refused and audited. |

## Buttons, selects and modals

| Custom id                                    | Where                                                | Handler                                                              |
| -------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `events:rsvp:<eventId>:<choice>`             | public announcement (`going` · `maybe` · `declined`) | `rsvp`; private confirmation. The announcement refreshes its counts. |
| `events:rsvp:<eventId>:<choice>:card`        | your event card                                      | `rsvp`; the card updates in place.                                   |
| `events:rsvp:<eventId>:<choice>:list`        | `/events list` rows                                  | `rsvp`; the list updates in place.                                   |
| `events:view:<eventId>`                      | announcement **Details**                             | `getEvent` → your card.                                              |
| `events:pick:view` (select)                  | `/events list`, **CHOOSE AN EVENT**                  | `getEvent` → the card replaces the picker.                           |
| `events:pick:checkin` (select)               | `/events checkin` picker                             | Opens the check-in modal.                                            |
| `events:checkin:<eventId>`                   | card **Check in** → modal (same id)                  | `checkIn`.                                                           |
| `events:create:<kind>:<capacity>` (modal)    | NEW <KIND> form (`0` = no limit)                     | `scheduleEvent`.                                                     |
| `events:live:<eventId>`                      | card **Go live**                                     | `markEventLive`.                                                     |
| `events:complete:<eventId>`                  | card **Complete**                                    | `completeEvent`.                                                     |
| `events:cancel:<eventId>`                    | card **Cancel event** → modal (same id)              | `cancelEvent`.                                                       |
| `events:code:<eventId>`                      | card **Check-in code** / **New check-in code**       | `generateCheckInCode`; the code in a new ephemeral message.          |
| `events:teams:<eventId>`                     | card **Teams**                                       | `listTeams`.                                                         |
| `events:draw:<eventId>` (select)             | teams panel                                          | `createRandomTeams` with the chosen size.                            |
| `events:bracket:<eventId>`                   | card **Bracket**                                     | `getBracket`.                                                        |
| `events:generate:<eventId>:<seeded\|random>` | bracket panel                                        | `generateBracket`.                                                   |
| `events:report-pick:<eventId>` (select)      | bracket panel, `/events report`                      | Opens the report modal for the chosen ready match.                   |
| `events:report:<matchId>` (modal)            | REPORT RESULT form                                   | `reportMatch`.                                                       |

Every piece of user text (title, description, location, cancel reason, team
and member names) goes through `userText()` (markdown escaped, mentions
neutralized); text inside the bracket block is made code-safe (no backticks or
control characters); select labels are plain one-line text. Links in the
announcement are http(s) only and show their host name. Every bot message is
sent with `allowedMentions: { parse: [] }`.

## Job handlers

Both run under a per-event lock in the worker process (core's compare-and-set
is the backstop across processes), read the **current** publication, use only
the `DiscordGateway` port, and map permanent Discord failures to
`PermanentJobError` (a run with several failures retries while any of them is
transient). Jobs a callback enqueues run immediately (`services.runJobsNow`).

| Job                      | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord.events.publish` | Skips superseded revisions and cancelled events. **Scheduled Event**: edits it (name, description, start/end, voice/stage channel or external location, and status ACTIVE when live, COMPLETED when completed — only the transitions Discord allows; the start is sent only when it moved and still lies ahead, and the status is applied even when Discord refuses the field edit; a Discord event that never started is deleted on completion instead of being started); re-creates it after Unknown Scheduled Event while the event is open (an event under way is listed from a minute ahead, then started). **Announcement**: edits it; after Unknown Message or Unknown Channel posts a new one in the current `channels.events` while the event is open. Reports what it created (`markEventPublished`), deletes a duplicate another run stored first and applies its content to the stored object. |
| `discord.events.cancel`  | Cancels the Scheduled Event (an active one is deleted) and edits the announcement to a **CANCELLED** panel with the reason and no buttons. An object or channel that is already gone counts as done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Discord permissions

| Where                        | The bot needs                                                    |
| ---------------------------- | ---------------------------------------------------------------- |
| Guild                        | Manage Events (create, edit, cancel and delete scheduled events) |
| `channels.events`            | View Channel, Send Messages, Embed Links                         |
| A voice/stage event location | View Channel, Connect                                            |

Members need View Channel and Read Message History in `channels.events` to see
the announcement. Slash commands, ephemeral replies, selects and modals need no
channel permission. Without `channels.events`, only the Discord scheduled event
is created (the create confirmation says so).

## Dashboard

| Page                   | Who               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/events`              | members           | **Upcoming** (open, not ended, soonest first) and **Past** tabs: title, kind, start in your time zone, status, attendance, your response. Staff: **New event**.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/events/new`          | `canManageEvents` | The event form: title, kind, description, start, end (blank = two hours), location, capacity, RSVP close. Times are read in your time zone. Everyone else: ACCESS RESTRICTED.                                                                                                                                                                                                                                                                                                                                                                                               |
| `/events/[id]`         | members           | Header (kind, status, start, end, where, capacity) and tabs. **Overview**: response counts, description, your response (GOING / MAYBE / DECLINE, waitlist position) and the check-in form while the window is open. **Teams** (read-only for members). **Bracket** (tournaments): one column per round, the champion.                                                                                                                                                                                                                                                       |
| `/events/[id]` (staff) | `canManageEvents` | **Go live** / **Complete** / **Cancel event** (reason, confirmed) when the transition is available. **Attendance**: check-in code issued and shown once (rotation confirmed first), every response with its waitlist position and check-in time. **Teams**: draw random teams, remove a team (until the bracket exists). **Bracket**: generate (seeded/random), **Report** per ready match. **Edit** while scheduled (a tournament's kind is locked once it has a bracket; times left as pre-filled keep their stored instant, End left as is or blank keeps the duration). |
| `/games`               | members           | See [games.md](./games.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The check-in code travels once, in the server action's response to the staff
member who asked; reloading the page never shows it again. Every mutation is a
server action that re-authorizes in core; controls a viewer cannot use are not
rendered.
