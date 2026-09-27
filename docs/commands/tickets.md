# Tickets: Discord and dashboard

Feature `apps/bot/src/features/tickets` · custom-id namespace `tickets` ·
dashboard `apps/dashboard/app/(console)/tickets` · domain `@jave/core`
`tickets` (see [docs/modules/tickets.md](../modules/tickets.md)).

Replies are **ephemeral** unless noted. Only two things are public: the
OPEN A TICKET panel a ticket manager posts, and the status/closing cards inside
each private ticket thread (whose only readers are the requester and staff).

Custom ids route; they never authorize. Every handler calls core as the
clicking user, so forged, stale or replayed ids fail closed. A ticket the
clicker may not see answers **NOT FOUND** (and core audits the attempt as
`access.denied`), exactly like a ticket that does not exist.

## Slash command `/ticket`

Every per-ticket subcommand takes an optional `ticket` option (autocomplete by
number — `42`, `#0042` — or subject; core scopes the choices: staff see every
ticket, members their own). Used **inside a ticket thread** without the option,
the command acts on that thread's ticket (`getTicketIdForThread`, which only
answers for tickets the caller may see).

| Subcommand         | Who                                                                   | Flow                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`             | any member in good standing (`tickets.enabled`, a ticket channel set) | **Category select** → **OPEN TICKET** modal: subject (3–120), details (3–4000), priority select (default NORMAL). The private thread is created right after the reply.                 |
| `mine`             | everyone                                                              | Your tickets (requester view, also for staff), newest activity first, 10 at most, with an **Open a ticket** select.                                                                    |
| `view`             | opener or handler                                                     | One ticket: status, category, priority, requester, handler, thread. Staff additionally see the first-response target. **Claim** (staff, unassigned) and **Open in dashboard** buttons. |
| `close` / `reopen` | opener, handler in the same assignment scope, or a ticket manager     | Reason modal (3–500). The reason is posted in the thread.                                                                                                                              |
| `queue`            | `canHandleTickets`                                                    | Active tickets, most urgent deadline first (unanswered before answered), with a **Claim an unassigned ticket** select.                                                                 |
| `panel`            | `canManageTickets`                                                    | Posts the public **OPEN A TICKET** panel (category select) in the current channel. Audited (`ticket.panel_posted`). A Discord refusal is reported, never swallowed.                    |
| `claim`            | `canHandleTickets`, unassigned active ticket, not your own            | Claims; the card updates, you join the thread, the requester is told.                                                                                                                  |
| `unclaim`          | the assignee, or a ticket manager                                     | Back to the queue, unassigned.                                                                                                                                                         |
| `transfer`         | the assignee, or a ticket manager                                     | `to:` user option, or — without it — Discord's **member picker** (user select). The target must currently hold `canHandleTickets` and must not be the requester.                       |
| `priority`         | handler of an unassigned ticket, the assignee, or a manager           | `level:` choice, or a **priority select** showing the current one. HIGH/URGENT alert staff while unassigned.                                                                           |
| `waiting`          | same as `priority`                                                    | Reason modal addressed to the requester, posted as `WAITING ON YOU — …`. The requester's next reply resumes the ticket.                                                                |
| `resume`           | same as `priority`                                                    | Takes a waiting ticket back without waiting for a reply.                                                                                                                               |
| `note`             | any handler (never on your own ticket)                                | **INTERNAL NOTE** modal (1–4000). Stored as staff-only; **never posted to the thread**.                                                                                                |
| `summary`          | any handler (never on your own ticket)                                | AI summary through the tickets extension point, labelled **AI-GENERATED · STAFF ONLY**, with **Regenerate**. Without an AI provider in this runtime: **SUMMARY #0042 · DISABLED**.     |

## Context menu

| Menu                             | Who                | Flow                                                                                                                                               |
| -------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| User → Apps → **Member tickets** | `canHandleTickets` | That member's tickets (every status, newest activity first, 10 at most) with an **Open a ticket** select. Members are refused (ACCESS RESTRICTED). |

## Buttons, selects and modals

| Custom id                            | Where                                  | Handler                                                                 |
| ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| `tickets:category` (select)          | `/ticket open` prompt, public panel    | Checks tickets are enabled and a ticket channel is set, opens the form. |
| `tickets:open:<category>` (modal)    | OPEN TICKET form                       | `openTicket` (rate limit `openRatePerHour`, `maxOpenPerUser`).          |
| `tickets:claim:<ticketId>`           | thread card **Claim**, `/ticket view`  | `claimTicket`.                                                          |
| `tickets:close:<ticketId>`           | thread card **Close** → reason modal   | `closeTicket` (modal id `tickets:close:<ticketId>`).                    |
| `tickets:reopen:<ticketId>`          | closing card **Reopen** → reason modal | `reopenTicket` (modal id `tickets:reopen:<ticketId>`).                  |
| `tickets:waiting:<ticketId>` (modal) | `/ticket waiting`                      | `setWaiting`.                                                           |
| `tickets:note:<ticketId>` (modal)    | `/ticket note`                         | `addInternalNote`.                                                      |
| `tickets:transfer:<ticketId>`        | member picker (user select)            | Resolves the member's JAVE identity → `transferTicket`.                 |
| `tickets:priority:<ticketId>`        | priority select                        | `setPriority`.                                                          |
| `tickets:summary:<ticketId>:force`   | summary **Regenerate**                 | `summarizeTicket` with `force`.                                         |
| `tickets:queue-claim` (select)       | `/ticket queue`                        | `claimTicket` for the chosen ticket.                                    |
| `tickets:view` (select)              | `/ticket mine`, Member tickets         | `getTicket` for the chosen ticket (requester or staff view).            |

Unknown actions answer **EXPIRED — This control is no longer active.** Staff
forms (note, waiting, transfer, priority, summary) are gated on
`canHandleTickets` before they open, so nobody types into a form that will be
refused; core re-checks every rule (including "never your own ticket") on
submit. Every piece of user text on a card or panel goes through `userText()`
(markdown escaped, mentions neutralized); every bot message is sent with
`allowedMentions: { parse: [] }`.

## Thread cards

The status card (in the private thread) shows reference, status, subject, the
opening message excerpt, category, priority, requester, handler and opening
time. **Claim** appears while the ticket is active and unassigned, **Close**
while it is active; a closed ticket's card has no buttons. The closing card
carries the reason, who closed it and a **Reopen** button. Staff-only data
(internal notes, SLA, AI summary, transfer reasons) never reaches the thread.

## Gateway listeners

- `onMessage` — every human message in a thread of the home guild goes to
  `recordMessage` (text + attachment metadata; files are never downloaded).
  Core records it only when the thread is a ticket's, ignores everything else,
  and ignores bots. A requester reply may resume a waiting ticket; the card
  refresh it schedules runs immediately.
- `onMessageUpdate` / `onMessageDelete` → `recordMessageEdit` /
  `recordMessageDelete`. Core keeps the original text and flags deletions for
  staff; it never purges.

## Job handlers (`discord.tickets.*`)

All read the **current** ticket with `getTicketCard` (jobs run late, out of
order, and more than once), use only the `DiscordGateway` port, map permanent
Discord failures to `PermanentJobError`, and run the jobs a callback enqueued
(`services.runJobsNow`).

| Job             | Does                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_thread`   | Creates the private thread, posts the card, calls `markThreadCreated`, adds the opener. A re-run with a recorded thread only ensures membership; a recorded thread Discord no longer has is cleared (`markThreadMissing`) and replaced in the same run. A concurrent run that lost the race deletes its duplicate thread.              |
| `update_card`   | Does exactly what `planCardUpdate` returns: edit the card (re-post and re-record it if the message was deleted), add the assignee, announce `CLAIMED — …` / `WAITING ON YOU — …`. Nothing once the ticket is closed.                                                                                                                   |
| `close_thread`  | Three resumable steps: **finalize** (card to its closed state, closing card), **lock** (lock + archive), **transcript** (requester-visible HTML — Markdown if the HTML exceeds 8 MiB — to `channels.ticketArchive`). A failed step is named in the job's error and the retry resumes there, so the closing card is never posted twice. |
| `reopen_thread` | Unarchives and unlocks, re-adds the opener and assignee, posts `REOPENED — <reason>`, refreshes the card.                                                                                                                                                                                                                              |

Thread deleted (Unknown Channel) → `markThreadMissing`: core clears it and,
for an active ticket, schedules a fresh thread, which runs immediately. A
member who left the guild is not added and does not fail the job.

## Discord permissions

| Where                           | Permissions                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `channels.tickets`              | View Channel, Create Private Threads, Send Messages in Threads, Embed Links, Manage Threads, Read Message History |
| `channels.ticketArchive`        | View Channel, Send Messages, Embed Links, Attach Files                                                            |
| Panel channel (`/ticket panel`) | View Channel, Send Messages, Embed Links                                                                          |

Ephemeral replies, modals and selects need no channel permission.

## Dashboard

| Page                            | Who                                      | What                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tickets`                      | handlers                                 | The queue: stat strip (active, unassigned, assigned to you, SLA missed; plus the 30-day record for `canManageTickets`/`canViewAnalytics`), quick views, filters (search, status, category, priority, handler, target missed, sort), calm SLA countdowns, bulk claim / priority / close for up to one page (25). |
| `/tickets`                      | everyone else (and `Opened by me`)       | Your own tickets, **Open a ticket** dialog.                                                                                                                                                                                                                                                                     |
| `/tickets/[id]`                 | opener or handler (else NOT FOUND)       | Conversation (internal notes framed apart, staff only; edits and deletions for staff), facts, SLA readout, timeline, controls the viewer may use (claim, transfer, priority, wait, resume, release, close, reopen, archive), internal note form, AI summary panel.                                              |
| `POST /tickets/[id]/transcript` | opener (never internal), ticket managers | HTML or Markdown download. Same-origin POST only (every export is audited and on the ticket timeline); `Content-Disposition: attachment`, `no-store`, `nosniff`, `sandbox` CSP.                                                                                                                                 |

The AI summary panel always labels a stored summary **AI-GENERATED** and says
**DISABLED** when this deployment has no AI provider (`AI_PROVIDER` unset or
`disabled`); nothing is fabricated.
