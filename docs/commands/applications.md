# Applications — Discord and dashboard surfaces

Feature: `apps/bot/src/features/applications` (custom-id namespace `applications`).
Domain rules: [`docs/modules/applications.md`](../modules/applications.md). Every control
calls `@jave/core` as the person who used it; custom ids route, they never authorize.

## Slash commands

| Command                      | Who                                                              | Reply     | What it does                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/apply start`               | any member; drafting and submitting need good standing           | ephemeral | Opens the application panel: status, eligibility, cooldown, readiness, and only the actions that can succeed now.                                                   |
| `/apply status`              | any member (their own application only)                          | ephemeral | Where the application stands: status, domain, interview, next-submission time, the staff message, the status timeline. `[ OPEN APPLICATION ]` returns to the panel. |
| `/applications queue [mine]` | `canViewApplications` (gated before the handler; core re-checks) | ephemeral | Undecided applications (submitted, in review, interview), oldest first, 25 per page. `mine` shows only those assigned to you. Never lists your own application.     |

## The applicant panel (`/apply start`)

| State                                   | Controls                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No application / closed one             | `[ START APPLICATION ]` (or `START NEW APPLICATION`) — opens a private draft. Hidden while applications are paused. A running cooldown is stated. |
| Draft                                   | Domain select · `[ EDIT ANSWERS ]` (modal page 1) · `[ EDIT REFERENCES ]` (modal page 2) · `[ SUBMIT ]` · `[ DISCARD DRAFT ]`                     |
| Submitted / in review / interview       | `[ REFRESH ]` · `[ WITHDRAW ]`                                                                                                                    |
| Already inside (trial, verified, staff) | No controls: "ALREADY INSIDE JAVELIN".                                                                                                            |

- **Edit** opens a two-page modal built from `APPLICATION_FORM_FIELDS` (labels, placeholders and
  caps come from core; every input optional so partial saves work, prefilled with the draft).
  Page 1: why JAVELIN, experience, projects, portfolio URL, evidence links (one per line).
  Page 2: references (staff only), referral code. Saving answers with the refreshed panel.
  A prefill is never cut short: core keeps every stored answer within its Discord input (the
  evidence list, one link per line, at most 4000 characters once encoded). If an answer stored
  before that cap is longer, the page does not open; the reply says so and links the dashboard.
- **Submit** submits, or — when requirements are missing — lists every missing one with
  `[ EDIT ANSWERS ]` and `[ BACK TO APPLICATION ]`. Nothing is sent until all are met.
- **Withdraw / discard** always asks first and states the cost (the reapply cooldown that
  withdrawing a submitted application starts): `[ WITHDRAW APPLICATION ]` / `[ KEEP IT ]`. The
  confirm button (`applications:withdraw_confirm:<id>:<status>`) carries the application and status
  the cost was stated for, and core withdraws only if both still match. If a reviewer claimed it
  or the draft was submitted from the dashboard in the meantime, nothing is withdrawn and the
  confirmation is shown again with what changed and the new cost.

## Staff review card (job `discord.applications.review_card`)

Posted in `channels.applicationsReview` and edited in place on every change (render lease,
nonce-protected posts, duplicate cleanup — see the module contract). Excerpts only: no
references, no decision reason, no mentions. Buttons come from core's `card.actions`:

| Button                      | Custom id                                  | Who                                                        | Flow                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[ CLAIM ]`                 | `applications:start_review:<id>`           | `canReviewApplications`                                    | Assigns the application to you (SUBMITTED → REVIEW).                                                                                                                                                                                                                     |
| `[ REVIEW ]`                | `applications:review:<id>`                 | `canReviewApplications`                                    | Modal: recommendation select (accept / reject / interview / abstain), score select 1–5 (not for an abstention), staff-only note.                                                                                                                                         |
| `[ INTERVIEW ]`             | `applications:schedule_interview:<id>`     | `canDecideApplications`                                    | Modal: time (`2026-10-02 18:00`, `tomorrow 18:00`, `fri 17:30`, `in 3 days`, ISO; read in your dashboard time zone unless you add `UTC`/`+02:00`, which any form with a clock time accepts) and a message to the applicant. Prefilled when moving an interview.          |
| `[ ACCEPT ]` / `[ REJECT ]` | `applications:accept:<id>` / `reject:<id>` | `canDecideApplications`, once enough counted reviews exist | Confirmation first (states the consequence and the tally) → `[ CONTINUE TO ACCEPT/REJECT ]` (`applications:decide:<decision>:<id>`) → modal: internal reason (required, staff only) and an optional message the applicant receives.                                      |
| `[ VIEW DETAILS ]`          | `applications:details:<id>`                | `canViewApplications`                                      | Ephemeral staff view: full answers, links, references, reviews with reviewers, decision, history. The read is audited. Its buttons are the card's actions narrowed to your capabilities: a reviewer without `canDecideApplications` sees no Interview, Accept or Reject. |
| `[ OPEN IN DASHBOARD ]`     | link                                       | —                                                          | `/applications/<id>`; shown only when `JAVE_PUBLIC_URL` is an http(s) URL.                                                                                                                                                                                               |

A stale button (the state moved on) answers calmly that the action is no longer available.
Nobody can act on their own application, from any control (refused and audited).

## Discord permissions

- Commands: members need **Use Application Commands**. All replies are ephemeral, so no channel
  permission is needed for them.
- Review channel (`channels.applicationsReview`): the bot needs **View Channel, Send Messages,
  Embed Links, Read Message History**. Keep the channel private to staff holding
  `canViewApplications`. Missing access or an unknown channel dead-letters the card job; rate
  limits and 5xx retry. Without the setting the job completes with `skipped: no review channel`.
- Role changes after a decision travel through `discord.roles.sync` (core feature).

## Dashboard

| Page                 | Who                                                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/applications`      | `canViewApplications` (others: ACCESS RESTRICTED)             | Queue readouts (unclaimed, in review, interview, assigned to you) and the table with filters: status, domain, assigned-to-me, sort, number search (`APP-0042`, `app-42`, `42`).                                                                                                                                                                                                                                                                                                                                                                                     |
| `/applications/[id]` | `canViewApplications`, never the applicant                    | Full staff view: answers, proof-of-work links (http(s) only, `noopener noreferrer`), references, summary, reviews, decision (internal reason), status timeline. Actions shown only when they can succeed: Claim, Review (replaces your own), Interview / Move interview, Accept, Reject (reason + applicant message, confirmation). Your own application shows ACCESS RESTRICTED with a link to it.                                                                                                                                                                 |
| `/me/application`    | the signed-in member (linked from `/me` and the account menu) | Applicant self-service: start, the full draft form, readiness, submit, withdraw / discard (states the cooldown first), status timeline, staff message. `[ SUBMIT APPLICATION ]` sits at the end of the form and, after a confirmation, saves what the form holds and then submits it, so unsaved edits are never lost when the answers lock; a refused submission keeps the saved draft and lists what is missing. Withdraw carries the application and status its cost was stated for; if either changed, nothing is withdrawn and the dialog states the new cost. |
