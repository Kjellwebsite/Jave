# SIDUS SCIENCE research library — Discord commands and dashboard (`research` feature)

Code: `apps/bot/src/features/research/`, `apps/dashboard/app/(console)/research/`. Rules live in
`@jave/core` (`research.*`, see [`docs/modules/research.md`](../modules/research.md)): who may
save, review, archive and push; the state machine; dedupe; optimistic versions.

## Slash command — `/sidus` (`canViewMembers`)

Replies are ephemeral.

| Subcommand                    | Who                  | What it does                                                                                                                                                                             |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sidus search query [status]` | `canViewMembers`     | Up to 10 matches (title, summary, DOI) with an **Open an item** select menu.                                                                                                              |
| `/sidus recent [status]`       | `canViewMembers`     | The 10 newest items (archived only for their submitter and reviewers) with the same select.                                                                                              |
| `/sidus view item`             | `canViewMembers`     | Item card: title, authors, venue, summary, status, evidence level, topic, tags, DOI / arXiv, submitter, review time, Sidus sync state; link buttons DOI · arXiv · Source · Message. `item` autocompletes from the library. |
| `/sidus review item`           | `canReviewResearch`  | Opens the review modal. Never for your own submission.                                                                                                                                   |

The **Source** button is shown only for http(s) links that are not Discord links; a Discord CDN
attachment or message from a private channel is never presented as a public reference.

## Message context menu — `Save to Sidus` (`canViewMembers`, good standing)

Right-click a message → Apps → **Save to Sidus**. The message is saved exactly as the gateway
delivered it (`research.saveFromMessage`: content, message link, id, attachments). DOI, arXiv ID,
URL and a title guess are extracted; the item enters the library as **NEW** and metadata lookup
(Crossref / arXiv) runs right after. The reply is the item card:

- `SAVED TO SIDUS — NEW` for a new item,
- `DUPLICATE — ALREADY IN THE LIBRARY` with the existing card when the DOI, arXiv ID, URL or
  message was saved before,
- `DUPLICATE — …` without a card when the existing item is archived and hidden from you.

Only messages in JAVELIN channels are accepted.

## Components and modals (custom ids route, never authorize)

| Custom id                            | Kind   | Rule                                                                                                                           |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `research:open`                      | select | Values are item ids; the item is loaded as the clicking member.                                                                |
| `research:view:<itemId>`             | button | Item card.                                                                                                                     |
| `research:review:<itemId>`           | button | Reviewers only (`ACCESS RESTRICTED` otherwise); refuses your own submission. Shown only to reviewers on others' items.        |
| `research:review:<itemId>:<version>` | modal  | Status (NEEDS REVIEW / REVIEWED / VERIFIED), evidence level, topic, tags (comma separated), audited note. The decision applies to `version` — a changed item is a `CONFLICT`. VERIFIED requires a known evidence level. Self-review is blocked and audited by core. |
| `research:sync:<itemId>`             | button | **Push to Sidus**: reviewers, verified items, not your own. Queues `research.sync_sidus`.                                     |

## Jobs

The research module defines **no `discord.*` jobs**. Its core jobs run in the bot's worker:

- `research.enrich` — Crossref / arXiv metadata (public resolvers, 8 s timeout, bounded responses).
- `research.sync_sidus` — built with the Sidus client from `SIDUS_API_URL` + `SIDUS_API_KEY`
  (`apps/bot/src/integrations.ts`). Without both, the not-configured client records every push as
  `NOT SYNCED — Sidus integration is not configured.`: never faked.

## Dashboard

- `/research` (`canViewMembers`) — search (title, summary, DOI) and filters (status, topic, tag,
  my submissions), Sidus integration state, **Add reference** (title / DOI / arXiv / link, topic,
  tags, summary; members in good standing; a duplicate opens the existing item).
- `/research/<id>` — reference (DOI and arXiv links, public source link), summary, Sidus sync
  (status, external id, last push, reason), provenance (submitter, origin message, metadata
  lookup, reviewer, version). Reviewers see the **Review** form (or **Restore** for archived
  items) and **Push to Sidus** on verified items that are not their own; submitters and
  reviewers can **Archive**.

## Discord permissions

None beyond the application command scope: every reply is an interaction response, and the
context menu receives the message content with the interaction.
