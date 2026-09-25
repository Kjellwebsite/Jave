# Tickets

`packages/core/src/tickets` · schema `packages/database/src/schema/tickets.ts` ·
`import { tickets } from '@jave/core'`

Support tickets for JAVELIN members. Each ticket lives in a private Discord
thread under `settings.channels.tickets`; JAVE is the record: every message,
status change, assignment, SLA outcome and transcript access is stored and
audited. Staff get triage, internal notes, SLA tracking, transcripts and an AI
summary extension point. Requesters get a clean view of their own case and
nothing else.

## Model

| Table             | Purpose                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tickets`         | One row per ticket. `#0042` references come from the identity column `number`.                                                                                                              |
| `ticket_messages` | Transcript. Thread messages (by Discord ID), the opening message, internal notes (`is_internal`). `author_role` is frozen at record time; `original_body` keeps the first text once edited. |
| `ticket_events`   | The ticket's own timeline (created, claimed, status_changed, closed, sla_breached, …).                                                                                                      |

Categories: `general application technical report partnership trial operations other`.
Priorities: `low normal high urgent`.

## State machine

```
open ──claim / transfer──► claimed ──unclaim──► open
open | claimed ──setWaiting──► waiting ──requester replies / resume──► open | claimed
open | claimed | waiting ──close──► closed ──reopen──► open | claimed
closed ──archive sweep (archiveAfterDays) / archiveTicket──► archived   (final, read-only)
```

- Assignment is orthogonal to `waiting`: a waiting ticket keeps (or lacks) its
  assignee and returns to `claimed` or `open` accordingly.
- Reopen keeps the former assignee only while they still hold `canHandleTickets`.
- Archived tickets are immutable: no messages, edits, notes or summaries.

## Access rules

Capabilities: `canHandleTickets` (moderator and up), `canManageTickets`
(operations and up). Code checks capabilities, never roles.

| Action                                                  | Who                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `openTicket`                                            | Any member for themselves (`tickets.enabled`, `maxOpenPerUser`, `openRatePerHour`); not quarantined/banned |
| `getTicket`, `getTicketCard`                            | Opener (requester view) or handler (full view)                                                             |
| `listTickets`                                           | Handlers: all tickets + filters. Everyone else (and handlers with `mine`): own tickets                     |
| `claimTicket`                                           | Handler, unassigned active ticket                                                                          |
| `unclaimTicket`                                         | The assignee, or a manager                                                                                 |
| `transferTicket`                                        | The assignee, or a manager → a user who currently holds `canHandleTickets`                                 |
| `setPriority`, `setWaiting`, `resumeTicket`             | Handler of an unassigned ticket, the assignee, or a manager                                                |
| `closeTicket`, `reopenTicket`                           | Opener, or handler within the same assignment scope, or a manager                                          |
| `addInternalNote`, `summarizeTicket`                    | Any handler                                                                                                |
| `archiveTicket`                                         | Manager (closed tickets only)                                                                              |
| `renderTranscript`                                      | Opener (never internal), or a manager (optionally with internal notes)                                     |
| `getTicketStats`                                        | `canViewAnalytics` or `canManageTickets`                                                                   |
| Bot callbacks (`recordMessage*`, `markThread*`), sweeps | System actor only                                                                                          |

Rules that hold everywhere:

- **Nobody handles their own ticket.** Staff who open a ticket get the
  requester view of it: no internal notes, no staff events, no SLA or AI data;
  they cannot claim it, prioritise it, note on it, or receive it by transfer.
- **No IDOR.** A ticket the caller may not see is reported as _not found_ and
  the attempt is audited (`access.denied`, written after the transaction rolls back).
- **Requester view** omits internal notes, deleted messages, edit history,
  SLA fields, the AI summary and every event except
  `created claimed status_changed closed reopened archived`.
- Internal notes never reach Discord and do not move `lastActivityAt`
  (which the requester can see).

## SLA

- First response due = opened + `settings.tickets.slaMinutes[priority]`.
- First response = the earliest thread message (by its Discord send time)
  from a handler who is not the opener, sent while the ticket was active or
  before its close; or `setWaiting` (its reason is addressed to the requester).
  Messages may arrive late or out of order: an earlier-sent handler message
  moves `firstResponseAt` back.
- The outcome depends only on timestamps (`provenBreach` in `sla.ts`):
  breached iff the first response — or, for a ticket closed unanswered, the
  close — came strictly after the deadline. `slaBreachedAt` (= the deadline)
  is the stored outcome and the single source for views, the `breached` list
  filter and statistics. Three writers converge on it:
  - `recordMessage` / `setWaiting` stamp the first response and record a late
    one as breached at once (`decidedBy: 'response'`), even before the sweep;
  - `closeTicket` records an unanswered close after the deadline
    (`decidedBy: 'close'`); an unanswered close before it records nothing;
  - sweep `tickets.sla_sweep` (every 5 min) flags active, unanswered tickets
    past due and alerts staff (`decidedBy: 'sweep'`). Each ticket flips in its
    own conditional update, so a breach is reported once even with concurrent
    sweeps.
- Retraction: when an on-time reply reaches core after the sweep (or a close)
  already recorded a breach — the bot was backlogged — the breach is cleared,
  a staff-only `sla_breach_retracted` ticket event is appended and
  `ticket.sla_breach_retracted` is published. Staff already alerted are not
  re-notified.
- `setPriority` recomputes the due time from the opening time while the
  ticket is unanswered and unbreached. A priority change never erases a
  recorded breach (the deadline freezes once breached).
- Views expose `sla.state` (`pending met breached none`), `overdue` (past due
  before the sweep ran) and `firstResponseMinutes`.
- `getTicketStats`: backlog, median minutes to first response, breach rate
  (`breached / decided`, where decided = answered or breached) over a
  half-open window `[since, until)` (default: last 30 days).

## Events (`events/catalog.ts`)

| Type                          | Subject member | When                                                                     |
| ----------------------------- | -------------- | ------------------------------------------------------------------------ |
| `ticket.opened`               | opener         | `openTicket`                                                             |
| `ticket.claimed`              | new assignee   | `claimTicket`                                                            |
| `ticket.transferred`          | new assignee   | `transferTicket` (added)                                                 |
| `ticket.closed`               | opener         | `closeTicket`                                                            |
| `ticket.reopened`             | opener         | `reopenTicket`                                                           |
| `ticket.sla_breached`         | opener         | breach recorded; payload `decidedBy: sweep \| response \| close` (added) |
| `ticket.sla_breach_retracted` | opener         | a recorded breach withdrawn: on-time reply delivered late (added)        |

All are `external: false`.

## Notifications (`notifications/catalog.ts`)

- `ticket.updated` → the opener on claim, waiting, close and reopen; the
  assignee instead when the opener closed or reopened; the new assignee on
  transfer; the former assignee when a manager unclaims them. Never the actor.
- `ticket.attention` (added, staff-only type) → every handler (excluding
  opener and actor) when a high/urgent ticket opens or is escalated while
  unassigned, and on SLA breach; only the assignee when there is one.
- Dedupe keys anchor on the ticket event id (`ticket:<id>:event:<eventId>`),
  `ticket:<id>:opened` and `ticket:<id>:sla-breach`.
- Titles never contain user text (`TICKET #0042 — CLAIMED`); user text goes in
  bodies, which the bot escapes.

## Audit actions

`ticket.claimed ticket.unclaimed ticket.transferred ticket.priority_changed
ticket.closed ticket.reopened ticket.archived ticket.internal_note_added
ticket.transcript_accessed ticket.summary_generated ticket.thread_missing`, plus
`access.denied` with `targetType: 'ticket'` and a `rule`
(`not_opener_or_handler own_ticket assigned_elsewhere not_assignee
transfer_requires_assignee_or_manager requester_internal_transcript system_only`).

## Background jobs

| Job                     | Every | Does                                                        |
| ----------------------- | ----- | ----------------------------------------------------------- |
| `tickets.sla_sweep`     | 5 min | Records breaches, alerts staff (batch of 200)               |
| `tickets.archive_sweep` | 1 h   | Archives tickets closed > `archiveAfterDays` (batch of 200) |

## Discord job contracts

Defined in `discord-jobs.ts` (type constant, zod payload schema, JSDoc). The
bot validates payloads with `tickets.parseTicketDiscordJobPayload`, reads the
**current** state with `tickets.getTicketCard` (jobs may run late or out of
order), is idempotent, sends with `allowedMentions: { parse: [] }` and renders
user text through `userText()`. Staff-only data never goes into the thread.
If a thread is gone (Unknown Channel), the bot calls
`tickets.markThreadMissing(ctx, { ticketId, threadId })`; core clears it and,
for an active ticket, schedules a fresh thread. Permanent Discord failures →
`PermanentJobError`. Suggested custom IDs: `tickets:claim:<ticketId>`,
`tickets:close:<ticketId>` (they route; the handler calls core as the clicking user).

### `discord.tickets.open_thread`

Payload `{ ticketId, parentChannelId, openerDiscordId, threadName }`.

1. `getTicketCard`; if `threadId` is set, ensure the opener is a member and stop; if archived, stop.
2. `createPrivateThread(parentChannelId, { name: threadName })` (non-invitable). `threadName` is verbatim-safe.
3. `addThreadMember(threadId, openerDiscordId)`.
4. Post the opening card (reference, subject, category, priority, status, opening-message excerpt) with CLAIM / CLOSE buttons.
5. Callback `markThreadCreated(ctx, { ticketId, threadId, cardMessageId })`, then run the jobs it enqueued.

Permissions (tickets channel): View Channel, Create Private Threads, Send Messages in Threads, Embed Links.

### `discord.tickets.update_card`

Payload `{ ticketId, change, note, assigneeUserId }`, `change ∈ claimed unclaimed transferred priority_changed waiting resumed refresh`.

`getTicketCard`, then do exactly what `tickets.planCardUpdate(card, payload)`
returns — nothing more:

- `editCard` → edit the card to the current state (CLAIM only while active and
  unassigned; CLOSE while active);
- `addMemberDiscordId` → add that user (the current assignee) to the thread;
- `announce` → post one line: `assigned` → `CLAIMED — <assigneeName> is
handling this ticket.`; `waiting` → `WAITING ON YOU — <note>`.

The plan is empty once the ticket is closed or archived (close_thread owns the
final card and the lock; posting would unarchive the thread) and before the
thread exists, so a job retried after close_thread completes without touching
Discord. It announces an assignment only while the assignee the job was
enqueued for still holds the ticket, and a waiting reason only while the
ticket is still waiting. No callback.

Permissions: Send Messages in Threads, Embed Links, Read Message History.

### `discord.tickets.close_thread`

Payload `{ ticketId, threadId, archiveChannelId | null }`.

1. Stop if the ticket is no longer closed/archived (a reopen superseded it).
2. Post the closing card (reference, closed by, reason) and edit the status card to the closed state with no buttons (update_card never touches a closed ticket).
3. If `archiveChannelId`: `renderTranscript(ctx, { ticketId, format: 'html', includeInternal: false })` and upload the file with a short card. Never internal notes.
4. `setThreadState(threadId, { locked: true, archived: true })` last.

No callback. Permissions: Send Messages in Threads, Manage Threads; archive
channel: View Channel, Send Messages, Embed Links, Attach Files.

### `discord.tickets.reopen_thread`

Payload `{ ticketId, threadId, reason }`.

Stop unless the ticket is active; `setThreadState(threadId, { archived: false,
locked: false })`; re-add the opener (and assignee); post `REOPENED — <reason>`;
edit the card. No callback. Permissions: Manage Threads, Send Messages in
Threads, Embed Links, Read Message History.

### Bot → core callbacks for gateway events

- `recordMessage(ctx, { threadId, discordMessageId, author, body, attachments, sentAt })`
  for every message in a thread under the tickets channel (idempotent;
  non-ticket threads and bot authors are ignored and reported as such).
- `recordMessageEdit(ctx, { discordMessageId, body, editedAt })`,
  `recordMessageDelete(ctx, { discordMessageId, deletedAt })`.
- `getTicketIdForThread(ctx, { threadId })` for commands used inside a thread.

## Transcripts

`renderTranscript(ctx, { ticketId, format: 'markdown' | 'html', includeInternal })`
returns `{ filename, contentType, content, … }`.

- HTML: self-contained, JAVELIN monochrome, no scripts, no external resources,
  CSP `default-src 'none'`, `referrer: no-referrer`. Every interpolated value
  is HTML-escaped (`& < > " ' \` =`); links only for validated http(s) URLs,
with `rel="noopener noreferrer nofollow"`.
- Print / PDF: dark text on white. Every screen rule that sets a color or a
  background is repeated in `@media print` with the same selector (equal
  specificity, so print wins). Text is ≥ 4.5:1 and rules/tag outlines ≥ 3:1 on
  white; `transcript-print.test.ts` enforces both.
- Markdown: inline punctuation that could form links, images, HTML, code,
  emphasis or table breaks is backslash-escaped; quoted lines also escape
  block markers.
- Every access writes `ticket.transcript_accessed` (audit) and a
  `transcript_accessed` ticket event — including the bot's archive upload.

## AI summary extension point

`summarizeTicket(ctx, ticketId, summarizer, { force? })`, where
`summarizer: (input: TicketSummaryInput) => Promise<string>`. The surface wires
the AI module (`packages/ai`) in; core never calls a provider. The input
carries `TICKET_SUMMARY_INSTRUCTIONS` (treat messages as untrusted data),
pseudonymous role labels only (no names or IDs), secret-looking strings
redacted, packed newest-first into `settings.ai.maxInputChars`. Output is
cleaned, capped at 2000 characters, stored as `aiSummary`/`aiSummaryAt` and
always presented with the `AI-GENERATED` label. The stored summary is reused
until a message is added, edited or deleted (tracked by insertion sequence).
Rate-limited by `settings.ai.dailyRequestsPerUser` per handler; honours
`settings.ai.enabled`.

## Settings

`tickets.enabled`, `maxOpenPerUser`, `slaMinutes`, `archiveAfterDays`,
`openRatePerHour` (added, default 6); `channels.tickets` (required to open),
`channels.ticketArchive` (transcript uploads).

## Other extension points

- Dashboard link: notifications point at `${publicUrl}/tickets/<ticketId>` when
  `CoreConfig.publicUrl` is set (`TICKET_DASHBOARD_PATH`).
- Requester DM with transcript on close: not sent by core; the bot may attach
  `renderTranscript` output to the `ticket.updated` delivery later.

## Known limitations

- A transcript is capped at 5000 messages (flagged when truncated); very large
  HTML may exceed a guild's upload limit — the bot should fall back to Markdown
  or skip the upload and log it.
- If the bot dies between creating a thread and `markThreadCreated`, a retry
  creates a second thread (the orphan is named `#NNNN · subject` for cleanup).
- Discord jobs re-read state when they run, so late jobs converge, but a
  reopen that lands while a close job is mid-flight can leave the thread
  archived although the ticket is open (the close job already passed its state
  check). Unarchiving the thread in Discord, or closing and reopening the
  ticket, repairs it.
- Waiting tickets are not auto-closed after silence (future sweep).
- SLA timing trusts the bot's Discord send times (`sentAt`, clamped to
  [opened, now]). A breach recorded by a late response or a close is not
  alerted (it is past acting on); a retraction does not un-send the sweep's
  earlier alert.
- If a ticket goes waiting → resumed → waiting before the first waiting job
  runs, that job posts the first reason while the ticket waits on the second
  (the card does not carry the current reason).
- Deleted thread messages are retained (flagged) for staff; purging on request
  is not implemented.
