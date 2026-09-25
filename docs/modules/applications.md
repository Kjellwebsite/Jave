# Applications

`packages/core/src/applications` — schema: `packages/database/src/schema/applications.ts`

How someone outside JAVELIN asks to get in, and how staff decide. The module
owns the application form, the review pipeline, the decision and the role
change it causes. It never judges capability: an accepted application grants a
progression role (default TRIAL) — ranks are earned later through trials and
verification.

```ts
import { applications } from '@jave/core';
await applications.getOrCreateDraft(ctx);
```

## State machine

```
DRAFT ──► SUBMITTED ──► REVIEW ──► INTERVIEW ──► ACCEPTED
             │            │  └──────────────────► ACCEPTED
             │            └─────────► REJECTED ◄──┘ (from INTERVIEW)
             └──────────────────────► REJECTED   (fast path; still needs minReviewsBeforeDecision)
any open state (DRAFT/SUBMITTED/REVIEW/INTERVIEW) ──► WITHDRAWN
```

- The table lives in `state-machine.ts` (`APPLICATION_TRANSITIONS`,
  `canTransition`, `assertTransition`). ACCEPTED, REJECTED and WITHDRAWN are
  terminal. Acceptance always passes through REVIEW.
- Every transition writes an `application_status_changes` row (with an
  insertion `sequence` for stable ordering), publishes
  `application.status_changed`, and refreshes the review card.
- Transitions are compare-and-set on the current status: a concurrent writer
  gets `ConflictError`/`InvalidStateError`, never a silent overwrite.
- One open application per person (partial unique index
  `applications_open_per_user_uq`); `getOrCreateDraft` converges under races.

## Services

| Function                                                                         | Who                                                                                  | Notes                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getOrCreateDraft(ctx)`                                                          | self, good standing, not already TRIAL/VERIFIED/staff                                | Returns the open application or a new draft. New drafts need `applications.open`.                                                                                                                          |
| `updateDraft(ctx, patch)`                                                        | self                                                                                 | Draft only. Omitted = unchanged; `null`/`""` = clear. Validates domain against the catalog and the referral code (exists, active, not your own; stored in canonical case).                                 |
| `submitApplication(ctx)`                                                         | self                                                                                 | `applications.open`; no reapply cooldown running (see below); requirements (domain, motivation ≥ 30, experience ≥ 30, and one of projects / portfolio / evidence link). Grants APPLICANT to plain members. |
| `withdrawApplication(ctx, { reason? })`                                          | self                                                                                 | Any open state. Returns APPLICANT to MEMBER. Withdrawing a submitted application starts a reapply cooldown.                                                                                                |
| `getMyApplication(ctx)`                                                          | self                                                                                 | Applicant-safe view + `applicationsOpen`, `eligible`, `cooldownEndsAt`, `withdrawalCooldownEndsAt` (what withdrawing now would cost — show it before confirming).                                          |
| `listApplications(ctx, filters)`                                                 | `canViewApplications`                                                                | Submitted applications only, never the caller's own. Filters: `status` (one or many), `domainKey`, `assignedToMe`, `number`; `sort` oldest/newest; `limit`/`offset`.                                       |
| `getApplication(ctx, { applicationId })`                                         | `canViewApplications`                                                                | Full staff view: answers, references, reviews with reviewers, history, decision reason. Audited as `application.viewed`.                                                                                   |
| `startReview(ctx, { applicationId, reviewerUserId? })`                           | `canReviewApplications`; `canDecideApplications` to assign someone else or take over | SUBMITTED → REVIEW, or reassignment during REVIEW/INTERVIEW.                                                                                                                                               |
| `reviewApplication(ctx, { applicationId, recommendation, score?, note? })`       | `canReviewApplications`                                                              | One review per reviewer (upsert). Score 1–5 required unless `abstain`. A first review moves SUBMITTED → REVIEW.                                                                                            |
| `scheduleInterview(ctx, { applicationId, interviewAt, applicantMessage? })`      | `canDecideApplications`                                                              | REVIEW → INTERVIEW, or reschedule. 15 minutes – 90 days ahead. Schedules a reminder 1 h before.                                                                                                            |
| `decideApplication(ctx, { applicationId, decision, reason, applicantMessage? })` | `canDecideApplications`                                                              | Needs `minReviewsBeforeDecision` non-abstaining reviews. Accept grants `acceptedRole` (TRIAL or VERIFIED only; never demotes). Reject returns APPLICANT to MEMBER.                                         |
| `getReviewCard(ctx, { applicationId })`                                          | `canViewApplications`                                                                | Card data for staff surfaces. No references, no decision reason. Accept/reject appear only once a decision can succeed.                                                                                    |
| `beginReviewCardRender(ctx, { applicationId, revision, renderId })`              | system actor only                                                                    | Render step 1: `superseded`, `no_channel`, or takes the render lease and returns the card. `ConflictError` (retryable) while another render holds the lease.                                               |
| `recordReviewCardMessage(ctx, { …, revision, renderId })`                        | system actor only                                                                    | Render step 2: stores the message, releases the lease, queues any catch-up or repair render.                                                                                                               |
| `releaseReviewCardRender(ctx, { applicationId, renderId })`                      | system actor only                                                                    | Gives the lease back after a failed render.                                                                                                                                                                |

Pure exports for surfaces: `APPLICATION_FORM_FIELDS` (labels, placeholders,
caps, modal pages), `APPLICATION_FIELD_LIMITS`, `missingRequirements`,
`REQUIREMENT_MESSAGES`, `splitLinkList`, `isSafeHttpUrl`, `staffActionsFor`,
`reviewCardActions`, `tallyReviews`, `closureCooldownMs`, `reapplyAvailableAt`.

### Reapply cooldowns

A submitted application that closes without acceptance blocks the next
submission for a while (`closureCooldownMs`, computed from
`application_status_changes`):

| Closure                                  | Blocks the next submission for                                |
| ---------------------------------------- | ------------------------------------------------------------- |
| REJECTED                                 | `cooldownDaysAfterRejection`                                  |
| WITHDRAWN from SUBMITTED                 | `withdrawalCooldownHours` (min 1 h)                           |
| WITHDRAWN from REVIEW / INTERVIEW        | the longer of `withdrawalCooldownHours` and the rejection one |
| WITHDRAWN from DRAFT (discard or expiry) | nothing — it never reached staff                              |

So withdrawing cannot dodge an expected rejection, and a submit/withdraw loop
cannot flood reviewers with DMs or the review channel with cards. The check
runs inside the submit transaction after the draft is locked.

### Conflict of interest

Staff can never act on their own application: review, claim, be assigned,
schedule, decide, read the staff view or the card, and their own application
never appears in `listApplications`. The attempt throws `ForbiddenError` and is
audited durably as `application.self_action_blocked`.
This matters when a member is promoted to staff while their application is
open.

### Privacy

- Drafts are private: staff paths treat never-submitted applications as not
  found, and listing excludes them.
- References: returned to the applicant (their own) and to
  `canViewApplications` via `getApplication`. Never on the review card.
- The applicant view is built field by field: no decision reason, reviews,
  reviewer or decider identity, assignee, or status-change notes.
- Applicant notifications carry only the outcome and the optional
  `applicantMessage`. The internal reason is stored, audited (staff-only
  audit log) and shown in the staff view only.
- Event payloads carry ids, number, domain and role — no answers.

### Input rules

Caps match Discord modal inputs (≤ 4000): motivation / experience / projects
≤ 2000, references ≤ 1000, portfolio URL ≤ 2048, ≤ 10 evidence links (array,
or one text block ≤ 4000 with one link per line; deduplicated). URLs must
be http(s) without credentials and are stored normalized (`URL.href`). Control
characters other than tab/newline are rejected (NUL would otherwise break
Postgres). All inputs are `.strict()`: unknown keys (e.g. `status`,
`applicationId` on applicant calls) are validation errors. Text is stored
verbatim; **surfaces must escape it** (bot: `userText()`; dashboard: React
escaping, never `dangerouslySetInnerHTML`).

## Settings (`applications`)

| Field                             | Default | Meaning                                                                                                  |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `open`                            | `true`  | New drafts and submissions allowed.                                                                      |
| `acceptedRole`                    | `trial` | Granted on acceptance. Only `trial`/`verified` are honoured; anything else makes acceptance fail closed. |
| `minReviewsBeforeDecision`        | `1`     | Non-abstaining reviews required. The decider's own review counts; raise to 2 for four-eyes.              |
| `cooldownDaysAfterRejection`      | `30`    | Days after a rejection before the person can submit again.                                               |
| `draftExpiryDays` _(new)_         | `30`    | Drafts with no edits for this long are withdrawn.                                                        |
| `reviewReminderHours` _(new)_     | `72`    | Reminder once per unclaimed submission, and once per assignment with no counted review, after this long. |
| `withdrawalCooldownHours` _(new)_ | `24`    | Hours a withdrawal after submission blocks a new submission (min 1). See reapply cooldowns.              |

`channels.applicationsReview` is where review cards are posted.

## Events

| Type                                      | When                     | Payload                                                    |
| ----------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `application.status_changed`              | every transition         | `applicationId, number, from, to`                          |
| `application.submitted` _(external)_      | submission               | `applicationId, number, domainKey, referred`               |
| `application.reviewed` _(new)_            | review recorded/replaced | `applicationId, number, recommendation, replaced`          |
| `application.interview_scheduled` _(new)_ | interview set/moved      | `applicationId, number, interviewAt, rescheduled`          |
| `application.accepted` _(external)_       | acceptance               | `applicationId, number, grantedRole`                       |
| `application.rejected`                    | rejection                | `applicationId, number, grantedRole: null`                 |
| `application.withdrawn`                   | applicant or expiry      | `applicationId, number, from, by: 'applicant' \| 'expiry'` |

`subjectMemberId` is the applicant. Role changes additionally emit
`member.role_granted` via `grantRoleUnchecked`.

## Notifications

| Recipient                                               | Type                   | Title                                           | Dedupe                                      |
| ------------------------------------------------------- | ---------------------- | ----------------------------------------------- | ------------------------------------------- |
| applicant                                               | `application.updated`  | APPLICATION SUBMITTED                           | `application:<id>:submitted`                |
| reviewers (`canReviewApplications`, applicant excluded) | `application.received` | APPLICATION RECEIVED                            | `application:<id>:received:<user>`          |
| applicant                                               | `application.updated`  | APPLICATION IN REVIEW                           | `application:<id>:in-review`                |
| assigned reviewer                                       | `application.received` | APPLICATION ASSIGNED                            | `application:<id>:assigned:<revision>`      |
| applicant                                               | `application.updated`  | INTERVIEW SCHEDULED / INTERVIEW MOVED           | `application:<id>:interview:<revision>`     |
| applicant                                               | `application.updated`  | INTERVIEW IN 1 HOUR                             | `application:<id>:interview-reminder:<iso>` |
| applicant                                               | `application.updated`  | APPLICATION ACCEPTED / APPLICATION NOT ACCEPTED | `application:<id>:decision`                 |
| applicant                                               | `application.updated`  | DRAFT CLOSED                                    | `application:<id>:expired`                  |
| reviewers                                               | `application.received` | APPLICATION WAITING                             | `application:<id>:review-reminder:<user>`   |
| assigned reviewer                                       | `application.received` | REVIEW PENDING                                  | `application:<id>:assignment-reminder:<ms>` |
| deciders (when the assignee can no longer review)       | `application.received` | REVIEW STALLED                                  | `…:assignment-reminder:<ms>:<user>`         |

`<revision>` is the review card revision the change produced, so every change
notifies once — moving an interview A → B → A tells the applicant each time —
while a retried or double-clicked request with no change notifies nothing.

## Audit actions

`application.submitted`, `application.viewed`, `application.review_assigned`,
`application.reviewed`, `application.interview_scheduled`,
`application.decided` (includes the internal reason), `application.withdrawn`,
`application.expired`, `application.self_action_blocked` (denied, durable),
plus `access.denied` from `authorize` and `role.granted` from role changes.

## Jobs

| Type                            | Kind      | Schedule            | Behaviour                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | --------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applications.drafts.expire`    | recurring | hourly              | Withdraws drafts with `updated_at` older than `draftExpiryDays` (100 per run, each in its own transaction, re-checked under lock).                                                                                                                                                                                                                         |
| `applications.reviews.remind`   | recurring | hourly              | Once per SUBMITTED application unclaimed for `reviewReminderHours` → all reviewers. Once per assignment in REVIEW with no counted review for `reviewReminderHours` since `review_assigned_at` → the assignee, or the deciders when the assignee can no longer review. Claimed atomically via `review_reminder_sent_at`, which every (re)assignment clears. |
| `applications.interview.remind` | one-off   | `interviewAt − 1 h` | Reminds the applicant if the interview still stands. Keyed per interview time so a reschedule never loses its reminder. Check and notification share one transaction, so a failed attempt leaves nothing behind and the retry sends it in full.                                                                                                            |

Bookkeeping writes (card revision, render lease, reminder flag) keep `updated_at` unchanged,
so they never postpone draft expiry.

## Discord job contract

### `discord.applications.review_card`

Payload: `{ applicationId: uuid, revision: int ≥ 1 }` (`reviewCardJobPayloadSchema`).
Enqueued on every change the card shows, one job per revision
(`application:<id>:review-card:<revision>`). Core may also enqueue a catch-up
render (same key) or a repair render (`…:repair:<renderId>`) with the same
payload shape.

Renders of one card are serialized by a **render lease** on the application
row (`review_card_lease_id`, `review_card_lease_expires_at`, 60 s): Discord
applies concurrent edits of one message in no guaranteed order, so without it
a stale edit could land last and leave live Accept/Reject buttons on a decided
card that nothing would ever re-render.

The bot must, with the worker's system actor and `renderId = String(job.id)`:

1. `applications.beginReviewCardRender(ctx, { applicationId, revision, renderId })`.
   - `{ outcome: 'superseded' }` → return `{ skipped: 'superseded' }`.
   - `{ outcome: 'no_channel' }` → return `{ skipped: 'no review channel' }`.
   - `ConflictError` → let it propagate; the queue retries with backoff.
   - `{ outcome: 'render', card }` → continue. On any failure before step 5,
     call `applications.releaseReviewCardRender(ctx, { applicationId, renderId })`
     (best effort) and rethrow.
2. If `card.message` exists, edit it. On Unknown Message (10008) / Unknown
   Channel (10003), post a new one instead.
3. Otherwise post in `card.channelId` (`channels.applicationsReview`); if the
   stored card was gone and no channel is set, release and return
   `{ skipped: 'no review channel' }`.
4. Render one `panel()` embed: `APP-0042 — <STATUS>`, applicant display name
   and handle, domain, submitted time, assigned reviewer, interview time,
   tally, motivation/projects excerpts (≤ 300 chars) through `userText()`,
   portfolio as plain text, evidence count, referred flag. Buttons from
   `card.actions` (accept/reject only once `minReviewsBeforeDecision` counted
   reviews exist) with custom ids `applications:<action>:<applicationId>`
   (`start_review`, `review`, `schedule_interview`, `accept`, `reject`).
   `allowedMentions: { parse: [] }`. Each button handler calls the matching
   service as the clicking user; custom ids never authorize.
5. `applications.recordReviewCardMessage(ctx, { applicationId, channelId,
messageId, revision: card.revision, renderId })`. This releases the lease.
   If the render was behind the current revision, core re-queues the current
   one; if the render had lost its lease (it outlived 60 s and another render
   took over), its edit may have landed last, so core queues a repair render.
   If `discard` is returned, delete that message (ignore 10008).

Discord permissions (review channel only): View Channel, Send Messages, Embed
Links, Read Message History. The channel must be private to staff holding
`canViewApplications`. Missing access / unknown channel are permanent
failures; rate limits and 5xx retry.

Role changes are synchronized by the existing `discord.roles.sync` contract.

### Suggested bot surface (not implemented here)

- `/apply` → `getMyApplication`; domain select (page 0) → `updateDraft`;
  modal page 1 (motivation, experience, projects, portfolio, evidence) and
  page 2 (references, referral) → `updateDraft`; Submit → `submitApplication`.
  Field labels, placeholders and caps come from `APPLICATION_FORM_FIELDS`.
- Review modal: recommendation + score + note → `reviewApplication`.
- Decide modal: internal reason + applicant message → `decideApplication`.

## Extension points

- **Subscribers**: none yet. Calendar can subscribe to
  `application.interview_scheduled`; analytics to `application.status_changed`.
- **Draft-expiry warning**: add a reminder a few days before
  `draftExpiresAt` (the view already exposes it).
- **Referral attribution**: `referral_codes` is validated here; crediting the
  referrer (e.g. on `application.accepted`) belongs to the invites module.

## Known limitations

- `notifyCapabilityHolders` caps recipients at 50 (core helper).
- One person holding both `canReviewApplications` and
  `canDecideApplications` can review and decide alone when
  `minReviewsBeforeDecision` is 1. Raise it for four-eyes review.
- Sweeps handle 100 rows per run; a larger backlog drains over several hours.
- The review card shows a `referred` flag, not the referrer.
- If the bot crashes after posting a new card but before
  `recordReviewCardMessage`, that message is orphaned (the next render posts a
  fresh one); it carries no private data beyond the card itself.
- A render blocked by the lease waits for the queue's backoff (10 s, then
  longer), so a card can lag a burst of changes by a few seconds.
- An application in INTERVIEW whose interview time passes without a decision
  is not reminded about; `listApplications({ status: 'interview' })` lists
  `interviewAt` so staff can spot it.
