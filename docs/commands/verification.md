# Verification — Discord and dashboard surfaces

Feature: `apps/bot/src/features/verification` (custom-id namespace `verification`).
Domain rules: [`docs/modules/verification.md`](../modules/verification.md). Every control
calls `@jave/core` as the person who used it; custom ids route, they never authorize.

## Slash commands

| Command                                  | Who                                                             | Reply     | What it does                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/verify request [type] [target] [rank]` | any member in good standing (core caps self-service at 10 open) | ephemeral | Put a claim forward. With no options it is a select flow (no typing). `target` and `rank` autocomplete from your own candidates: projects, contributions, achievements, trial results, capabilities with the ranks above your verified one. |
| `/verify status`                         | any member (their own verifications only)                       | ephemeral | Your newest 10 verifications; a select opens one privately; `[ REQUEST VERIFICATION ]`; `[ OPEN IN DASHBOARD ]` for the full list.                                                                                                          |
| `/verify queue [view]`                   | `canVerifyMembers` (others: ACCESS RESTRICTED, audited)         | ephemeral | The queue, 10 per page: `open` (default, oldest first), `mine`, `unassigned`, `approved` (newest first). A select opens an item; `[ PREVIOUS ]` / `[ NEXT ]` page.                                                                          |

## User context menu

| Menu                                          | Who                | What                                                                                                  |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Right-click member → Apps → **Verifications** | `canVerifyMembers` | That member's newest 10 verifications with a select to open one. Core refuses and audits anyone else. |

## Request flow

1. **Type** — select (`verification:type`): Skill, Project, Contribution, Achievement, Trial result,
   Identity, each with what it proves.
2. **Target** — select of your own requestable targets (`verification:target:<type>`), from core's
   `listTargetCandidates` (already-open and, for single-approval types, approved targets are left
   out). Nothing to verify says so, with `[ CHOOSE ANOTHER TYPE ]`. Identity skips this step.
3. **Rank** (skill only) — select of the ranks above your verified rank (`verification:rank:<facet>`).
4. **Modal** (`verification:submit:<type>[:<target>[:<rank>]]`): claim (optional, ≤ 500), up to
   three new evidence links (http(s) only), and **Evidence you already added** — a multi-select of
   up to 7 of your own evidence items (from profile claims and earlier requests; rejected items
   are not offered; for a skill, evidence for that capability first). Together that is core's
   limit of 10 per request. The select is left out when you have no evidence yet. Core attaches
   only evidence you own: a forged id is refused like a missing one. The reply names the
   reference (`VER-0042`), the target, the evidence count and the expiry.

Typed or autocompleted values are validated (UUID / facet key / rank code) before they enter a
custom id; targets that are not yours look exactly like missing ones.

## Verifier controls

Shown on the private detail view (queue select, context menu, card `[ DETAILS ]`) only when core's
`verificationAccess` says they can succeed; otherwise the view states why (your own request, you
opened it for them, assigned to someone else, or a missing type capability).

| Button             | Custom id                   | Flow                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[ START REVIEW ]` | `verification:claim:<id>`   | Pending → in review, assigned to you.                                                                                                                                                                                                                                                                                                                            |
| `[ APPROVE ]`      | `verification:approve:<id>` | Modal (`verification:decide:approve:<id>`): decision note (required, the member sees it). Skill approvals add a **Rank to grant** select listing only ranks above the subject's current verified rank (core's `listGrantableRanks`), prefilled with the requested rank. When nothing higher is left to grant, the form does not open and says to reject instead. |
| `[ REJECT ]`       | `verification:reject:<id>`  | Modal (`verification:decide:reject:<id>`): why it is not verified (required, the member sees it).                                                                                                                                                                                                                                                                |
| `[ REVOKE ]`       | `verification:revoke:<id>`  | Approved only. Modal (`verification:revoke_submit:<id>`): reason (required). Core reverses exactly what that approval changed.                                                                                                                                                                                                                                   |

Capabilities: `canVerifyMembers` for all of them; skill decisions also need `canModifyRanks`,
contribution decisions `canVerifyContributions`. Nobody decides their own request, and a request
staff opened for someone else needs a second verifier (core's two-person rule, audited).

## Queue card (job `discord.verification.queue_card`)

One card per verification in `channels.verificationQueue`, edited in place on every change
(nonce-protected posts, compare-and-set on the recorded message, at most three renders per run).
When the recorded card or its whole channel was deleted (Unknown Message / Unknown Channel), the
card is reposted in the queue channel configured now and core records where it lives, so replacing
the queue channel moves open cards to it. With no channel configured, the job completes without
posting.
It shows status, subject, opener, target, claim, evidence count, times and the assigned verifier —
never evidence URLs or notes. Buttons: `[ START REVIEW ]` (pending), `[ APPROVE ]`, `[ REJECT ]`
(open), `[ DETAILS ]` (`verification:open:<id>`), `[ OPEN IN DASHBOARD ]`. Each re-checks the
clicking verifier exactly like the detail view.

## Discord permissions

- Commands and the context menu: **Use Application Commands**. Replies are ephemeral.
- Queue channel (`channels.verificationQueue`): **View Channel, Send Messages, Embed Links, Read
  Message History**. Keep it private to verifiers. Permanent failures (missing access) dead-letter
  the card job; a deleted card or channel is reposted in the configured channel; transient
  failures retry. Unset channel: the job completes with `skipped: no queue channel`.
- Subject notices travel through the notification system (DMs by the core feature), not this one.

## Dashboard

| Page                 | Who                                                         | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/verification`      | `canVerifyMembers`: the queue. Members: their own requests. | Readouts (pending, in review, unassigned, assigned to you) for verifiers; filters: status, type, verifier (any / mine / unassigned), sort. `?subject=me` is **My verifications** — the viewer's own requests, for verifiers too — linked from `/me` and the account menu (`&status=all`, so decided ones and their notes stay reachable).                                                                                                                                                    |
| `/verification/[id]` | the subject or `canVerifyMembers`; anyone else gets 404     | Claim, target preview (skill: requested vs current verified / claimed rank; identity: roles now), evidence (http(s) links only, `noopener noreferrer`), decision note, revocation reason, summary, timeline. Controls from `verificationAccess`: Start review, Approve (rank to grant for skills: only ranks above the subject's verified rank; when none is left, Approve is replaced by a note to reject), Reject, Revoke — each with a confirmation dialog and a required note or reason. |
