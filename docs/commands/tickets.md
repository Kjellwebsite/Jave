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
ticket, members their own). A number always offers that exact ticket first, in
any status (archived included), and a typed number is accepted without picking
a choice; both go through core's scoped `number` filter, so a member cannot
reach someone else's ticket by guessing numbers. Used **inside a ticket
thread** without the option, the command acts on that thread's ticket
(`getTicketIdForThread`, which only answers for tickets the caller may see).

| Subcommand         | Who                                                                   | Flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`             | any member in good standing (`tickets.enabled`, a ticket channel set) | **Category select** → **OPEN TICKET** modal: subject (3–120), details (3–4000), priority select (default NORMAL). The private thread is created right after the reply. Before the category prompt and again before the form, core's read-only preflight (`assertCanOpenTicket`) refuses what the submit would refuse — standing, tickets off, no ticket channel, `maxOpenPerUser`, `openRatePerHour` — in the same words, without spending the hourly budget, so nobody loses a long message. |
| `mine`             | everyone                                                              | Your tickets in every status (requester view, also for staff), newest activity first, 10 at most, with a **View a ticket** select.                                                                                                                                                                                                                                                                                                                                                            |
| `view`             | opener or handler                                                     | One ticket: status, category, priority, requester, handler, thread. Staff additionally see the first-response target and, while it is active, **Claim** (unassigned) and **Manage**. **Open in dashboard** for everyone.                                                                                                                                                                                                                                                                      |
| `close` / `reopen` | opener, handler in the same assignment scope, or a ticket manager     | Reason modal (3–500). The reason is posted in the thread.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `queue`            | `canHandleTickets`                                                    | Active tickets, most urgent deadline first (unanswered before answered), with a **Claim an unassigned ticket** select.                                                                                                                                                                                                                                                                                                                                                                        |
| `panel`            | `canManageTickets`                                                    | Posts the public **OPEN A TICKET** panel (category select) in the current channel. Audited (`ticket.panel_posted`). A Discord refusal is reported, never swallowed.                                                                                                                                                                                                                                                                                                                           |
| `claim`            | `canHandleTickets`, unassigned active ticket, not your own            | Claims; the card updates, you join the thread, the requester is told.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `unclaim`          | the assignee, or a ticket manager                                     | Back to the queue, unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `transfer`         | the assignee, or a ticket manager                                     | `to:` user option, or — without it — Discord's **member picker** (user select). The target must currently hold `canHandleTickets` and must not be the requester.                                                                                                                                                                                                                                                                                                                              |
| `priority`         | handler of an unassigned ticket, the assignee, or a manager           | `level:` choice, or a **priority select** showing the current one. HIGH/URGENT alert staff while unassigned.                                                                                                                                                                                                                                                                                                                                                                                  |
| `waiting`          | same as `priority`                                                    | Reason modal addressed to the requester, posted as `WAITING ON YOU — …`. The requester's next reply resumes the ticket.                                                                                                                                                                                                                                                                                                                                                                       |
| `resume`           | same as `priority`                                                    | Takes a waiting ticket back without waiting for a reply.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `note`             | any handler (never on your own ticket)                                | **INTERNAL NOTE** modal (1–4000). Stored as staff-only; **never posted to the thread**.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `summary`          | any handler (never on your own ticket)                                | AI summary through the tickets extension point, labelled **AI-GENERATED · STAFF ONLY**, with **Regenerate**. Without an AI provider in this runtime: **SUMMARY #0042 · DISABLED**.                                                                                                                                                                                                                                                                                                            |

## Context menu

| Menu                             | Who                | Flow                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User → Apps → **Member tickets** | `canHandleTickets` | That member's tickets in every status, archived included (newest activity first, 10 at most), with a **View a ticket** select and a **Full history** link to the dashboard queue filtered to them (`/tickets?opener=<userId>&status=all`). Members are refused (ACCESS RESTRICTED). |

## Buttons, selects and modals

| Custom id                          | Where                                              | Handler                                                                 |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `tickets:category` (select)        | `/ticket open` prompt, public panel                | Checks tickets are enabled and a ticket channel is set, opens the form. |
| `tickets:open:<category>` (modal)  | OPEN TICKET form                                   | `openTicket` (rate limit `openRatePerHour`, `maxOpenPerUser`).          |
| `tickets:claim:<ticketId>`         | thread card **Claim**, `/ticket view`, Manage      | `claimTicket`.                                                          |
| `tickets:close:<ticketId>`         | thread card **Close**, Manage → reason modal       | `closeTicket` (modal id `tickets:close:<ticketId>`).                    |
| `tickets:reopen:<ticketId>`        | closing card **Reopen** → reason modal             | `reopenTicket` (modal id `tickets:reopen:<ticketId>`).                  |
| `tickets:manage:<ticketId>`        | thread card **Manage**, staff `/ticket view`       | Opens the ephemeral MANAGE panel (below).                               |
| `tickets:unclaim:<ticketId>`       | Manage **Release**                                 | `unclaimTicket`.                                                        |
| `tickets:resume:<ticketId>`        | Manage **Resume**                                  | `resumeTicket`.                                                         |
| `tickets:waiting:<ticketId>`       | Manage **Wait on requester** → modal               | Opens the waiting form; the modal (same id) calls `setWaiting`.         |
| `tickets:note:<ticketId>`          | Manage **Internal note** → modal                   | Opens the note form; the modal (same id) calls `addInternalNote`.       |
| `tickets:transfer:<ticketId>`      | member picker (user select), Manage                | Resolves the member's JAVE identity → `transferTicket`.                 |
| `tickets:priority:<ticketId>`      | priority select, Manage                            | `setPriority`.                                                          |
| `tickets:summary:<ticketId>:force` | summary **Regenerate**                             | `summarizeTicket` with `force`.                                         |
| `tickets:queue-claim` (select)     | `/ticket queue`                                    | `claimTicket` for the chosen ticket.                                    |
| `tickets:view` (select)            | `/ticket mine`, Member tickets (**View a ticket**) | `getTicket` for the chosen ticket (requester or staff view).            |

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
and **Manage** while it is active; a closed ticket's card has no buttons. The
closing card carries the reason, who closed it and a **Reopen** button.
Staff-only data (internal notes, SLA, AI summary, transfer reasons) never
reaches the thread.

## MANAGE panel

**Manage** (thread card, staff `/ticket view`) opens an ephemeral staff panel
for one active ticket, so the frequent handler actions need no typed command:

- buttons: **Claim** or **Release**, **Wait on requester** or **Resume**,
  **Internal note**, **AI summary**, **Close**;
- a priority select (current priority preselected);
- a transfer member picker.

Only the controls the access table allows are shown (claim when unassigned;
release and transfer to the assignee or a ticket manager; priority, waiting,
resume and close within the assignment scope; note and summary to any
handler). That is display only: each control calls the same core service as
its `/ticket` subcommand, as the clicking user. The requester pressing
**Manage** gets ACCESS RESTRICTED; staff get "You cannot handle your own
ticket." on their own; a closed ticket answers "Reopen it first.", an
archived one "Archived tickets are read-only."

## Gateway listeners

- `onMessage` — every human message in a thread of the home guild goes to
  `recordMessage` (text + attachment metadata; files are never downloaded).
  Core records it only when the thread is a ticket's, ignores everything else,
  and ignores bots. A requester reply may resume a waiting ticket; the card
  refresh it schedules runs immediately.
- `onMessageUpdate` / `onMessageDelete` → `recordMessageEdit` /
  `recordMessageDelete`. Core keeps the original text and flags deletions for
  staff; it never purges.
- `onMessageDeleteBulk` (Discord's MessageDeleteBulk: a moderator purge, or
  JAVE's own bulk deletes) → one `recordMessageDelete` per message, only when
  the channel is a ticket thread (one lookup otherwise). Purged messages leave
  the requester's conversation, exports and the archived transcript exactly
  like single deletions.

## Job handlers (`discord.tickets.*`)

All read the **current** ticket with `getTicketCard` (jobs run late, out of
order, and more than once), use only the `DiscordGateway` port, map permanent
Discord failures to `PermanentJobError`, and run the jobs a callback enqueued
(`services.runJobsNow`).

| Job             | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open_thread`   | Creates the private thread (auto-archive after one week of silence, Discord's longest), posts the card, calls `markThreadCreated`, adds the opener. A re-run with a recorded thread only ensures membership; a recorded thread Discord no longer has is cleared (`markThreadMissing`) and replaced in the same run. A concurrent run that lost the race deletes its duplicate thread.                                                                                                                                                                                                                                                                                                                                    |
| `update_card`   | Does exactly what `planCardUpdate` returns: edit the card (re-post and re-record it if the message was deleted), add the assignee, announce `CLAIMED — …` / `WAITING ON YOU — …`. Nothing once the ticket is closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `close_thread`  | Three resumable steps: **finalize** (card to its closed state, closing card), **lock** (lock + archive), **transcript** (requester-visible HTML — Markdown if the HTML exceeds 8 MiB — to `channels.ticketArchive`). Every failure inside the handler (Discord, reading the ticket, reporting a deleted thread) is named with its step in the job's error and the retry resumes there. A retry that finds no step — the worker died and its lease was recovered — asks Discord (`fetchThreadState`): a locked thread means finalize and lock are done, so it goes straight to the transcript. The one gap: a worker that dies between posting the closing card and locking the thread posts the card again on its retry. |
| `reopen_thread` | Unarchives and unlocks, re-adds the opener and assignee, posts `REOPENED — <reason>`, refreshes the card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Idle threads.** Discord archives a thread after its idle period and then
refuses edits and member adds in it (error 50083, _Thread is archived_). Every
job that edits the card, adds a member or posts into a ticket thread retries
that action once after unarchiving the thread (`setThreadState({ archived:
false })`); the lock is left as it is. So closing, claiming, waiting and
transferring work on a ticket whose requester went quiet for weeks.

Thread deleted (Unknown Channel) → `markThreadMissing`: core clears it and,
for an active ticket, schedules a fresh thread, which runs immediately. A
member who left the guild is not added and does not fail the job.

## Discord permissions

**The bot**

| Where                           | Permissions                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `channels.tickets`              | View Channel, Create Private Threads, Send Messages in Threads, Embed Links, Manage Threads, Read Message History |
| `channels.ticketArchive`        | View Channel, Send Messages, Embed Links, Attach Files                                                            |
| Panel channel (`/ticket panel`) | View Channel, Send Messages, Embed Links                                                                          |

**Members and staff** (set on `channels.tickets` for @everyone, or the member
role, and for staff roles)

| Permission               | Setting   | Why                                                                                                                                                           |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View Channel             | **allow** | Threads inherit it from their parent: without it a requester is added to their private thread and still cannot see it, while the dashboard says "In Discord". |
| Send Messages in Threads | **allow** | To reply in their own thread.                                                                                                                                 |
| Read Message History     | **allow** | To read the thread, including the card.                                                                                                                       |
| Attach Files             | allow     | Optional: logs and screenshots in replies.                                                                                                                    |
| Send Messages            | deny      | Keeps the channel itself quiet; conversations happen in threads.                                                                                              |
| Create Public Threads    | deny      | Nothing public is opened under the tickets channel.                                                                                                           |
| Create Private Threads   | deny      | Only JAVE opens ticket threads (members cannot invite others: threads are non-invitable).                                                                     |

A private thread shows only to its members and to people with Manage Threads,
so a channel every member can view stays private per ticket. `/jave setup` does
not check the member side yet.

Ephemeral replies, modals and selects need no channel permission.

## Dashboard

| Page                            | Who                                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tickets`                      | handlers                                 | The queue: stat strip (active, unassigned, assigned to you, SLA missed; plus the 30-day record for `canManageTickets`/`canViewAnalytics`), quick views, filters (search, status, category, priority, handler, target missed, sort), calm SLA countdowns, bulk claim / priority / close for up to one page (25). `?opener=<userId>` narrows it to one member's tickets (an **Opened by** bar with **All requesters** to clear it); reached from Discord's Member tickets and from the requester's name on a ticket. Your own tickets in the queue show **Your ticket** instead of an SLA readout and never appear under the SLA filters. |
| `/tickets`                      | everyone else (and `Opened by me`)       | Your own tickets, **Open a ticket** dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/tickets/[id]`                 | opener or handler (else NOT FOUND)       | Conversation (internal notes framed apart, staff only; edits and deletions for staff), facts, SLA readout, timeline, controls the viewer may use (claim, transfer, priority, wait, resume, release, close, reopen, archive), internal note form, AI summary panel.                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /tickets/[id]/transcript` | opener (never internal), ticket managers | HTML or Markdown download. Same-origin POST only (every export is audited and on the ticket timeline); `Content-Disposition: attachment`, `no-store`, `nosniff`, `sandbox` CSP.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The AI summary panel always labels a stored summary **AI-GENERATED** and says
**DISABLED** when this deployment has no AI provider (`AI_PROVIDER` unset or
`disabled`); nothing is fabricated.
