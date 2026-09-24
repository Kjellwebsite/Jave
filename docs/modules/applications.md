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

| Function                                                                         | Who                                                                                  | Notes                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getOrCreateDraft(ctx)`                                                          | self, good standing, not already TRIAL/VERIFIED/staff                                | Returns the open application or a new draft. New drafts need `applications.open`.                                                                                                     |
| `updateDraft(ctx, patch)`                                                        | self                                                                                 | Draft only. Omitted = unchanged; `null`/`""` = clear. Validates domain against the catalog and the referral code (exists, active, not your own; stored in canonical case).            |
| `submitApplication(ctx)`                                                         | self                                                                                 | `applications.open`; rejection cooldown; requirements (domain, motivation ≥ 30, experience ≥ 30, and one of projects / portfolio / evidence link). Grants APPLICANT to plain members. |
| `withdrawApplication(ctx, { reason? })`                                          | self                                                                                 | Any open state. Returns APPLICANT to MEMBER.                                                                                                                                          |
| `getMyApplication(ctx)`                                                          | self                                                                                 | Applicant-safe view + `applicationsOpen`, `eligible`, `cooldownEndsAt`.                                                                                                               |
| `listApplications(ctx, filters)`                                                 | `canViewApplications`                                                                | Submitted applications only. Filters: `status` (one or many), `domainKey`, `assignedToMe`, `number`; `sort` oldest/newest; `limit`/`offset`.                                          |
| `getApplication(ctx, { applicationId })`                                         | `canViewApplications`                                                                | Full staff view: answers, references, reviews with reviewers, history, decision reason. Audited as `application.viewed`.                                                              |
| `startReview(ctx, { applicationId, reviewerUserId? })`                           | `canReviewApplications`; `canDecideApplications` to assign someone else or take over | SUBMITTED → REVIEW, or reassignment during REVIEW/INTERVIEW.                                                                                                                          |
| `reviewApplication(ctx, { applicationId, recommendation, score?, note? })`       | `canReviewApplications`                                                              | One review per reviewer (upsert). Score 1–5 required unless `abstain`. A first review moves SUBMITTED → REVIEW.                                                                       |
| `scheduleInterview(ctx, { applicationId, interviewAt, applicantMessage? })`      | `canDecideApplications`                                                              | REVIEW → INTERVIEW, or reschedule. 15 minutes – 90 days ahead. Schedules a reminder 1 h before.                                                                                       |
| `decideApplication(ctx, { applicationId, decision, reason, applicantMessage? })` | `canDecideApplications`                                                              | Needs `minReviewsBeforeDecision` non-abstaining reviews. Accept grants `acceptedRole` (TRIAL or VERIFIED only; never demotes). Reject returns APPLICANT to MEMBER.                    |
| `getReviewCard(ctx, { applicationId })`                                          | `canViewApplications` (the worker's system actor)                                    | Data for the Discord card. No references, no decision reason.                                                                                                                         |
| `recordReviewCardMessage(ctx, …)`                                                | system actor only                                                                    | Bot callback; see the Discord contract.                                                                                                                                               |

Pure exports for surfaces: `APPLICATION_FORM_FIELDS` (labels, placeholders,
caps, modal pages), `APPLICATION_FIELD_LIMITS`, `missingRequirements`,
`REQUIREMENT_MESSAGES`, `splitLinkList`, `isSafeHttpUrl`, `staffActionsFor`,
`tallyReviews`.

### Conflict of interest

Staff can never act on their own application: review, claim, be assigned,
schedule, decide, read the staff view or the card. The attempt throws
`ForbiddenError` and is audited durably as `application.self_action_blocked`.
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

| Field                         | Default | Meaning                                                                                                  |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `open`                        | `true`  | New drafts and submissions allowed.                                                                      |
| `acceptedRole`                | `trial` | Granted on acceptance. Only `trial`/`verified` are honoured; anything else makes acceptance fail closed. |
| `minReviewsBeforeDecision`    | `1`     | Non-abstaining reviews required. The decider's own review counts; raise to 2 for four-eyes.              |
| `cooldownDaysAfterRejection`  | `30`    | Days after a rejection before the person can submit again.                                               |
| `draftExpiryDays` _(new)_     | `30`    | Drafts with no edits for this long are withdrawn.                                                        |
| `reviewReminderHours` _(new)_ | `72`    | Reviewers are reminded once when a submission waits this long unclaimed.                                 |

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
| assigned reviewer                                       | `application.received` | APPLICATION ASSIGNED                            | per assignment                              |
| applicant                                               | `application.updated`  | INTERVIEW SCHEDULED / INTERVIEW MOVED           | `application:<id>:interview:<iso>`          |
| applicant                                               | `application.updated`  | INTERVIEW IN 1 HOUR                             | `application:<id>:interview-reminder:<iso>` |
| applicant                                               | `application.updated`  | APPLICATION ACCEPTED / APPLICATION NOT ACCEPTED | `application:<id>:decision`                 |
| applicant                                               | `application.updated`  | DRAFT CLOSED                                    | `application:<id>:expired`                  |
| reviewers                                               | `application.received` | APPLICATION WAITING                             | `application:<id>:review-reminder:<user>`   |

## Audit actions

`application.submitted`, `application.viewed`, `application.review_assigned`,
`application.reviewed`, `application.interview_scheduled`,
`application.decided` (includes the internal reason), `application.withdrawn`,
`application.expired`, `application.self_action_blocked` (denied, durable),
plus `access.denied` from `authorize` and `role.granted` from role changes.

## Jobs

| Type                            | Kind      | Schedule            | Behaviour                                                                                                                             |
| ------------------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `applications.drafts.expire`    | recurring | hourly              | Withdraws drafts with `updated_at` older than `draftExpiryDays` (100 per run, each in its own transaction, re-checked under lock).    |
| `applications.reviews.remind`   | recurring | hourly              | Reminds reviewers once per SUBMITTED application older than `reviewReminderHours` (claimed atomically via `review_reminder_sent_at`). |
| `applications.interview.remind` | one-off   | `interviewAt − 1 h` | Reminds the applicant if the interview still stands. Keyed per interview time so a reschedule never loses its reminder.               |

Bookkeeping writes (card revision, reminder flag) keep `updated_at` unchanged,
so they never postpone draft expiry.

## Discord job contract

### `discord.applications.review_card`

Payload: `{ applicationId: uuid, revision: int ≥ 1 }` (`reviewCardJobPayloadSchema`).
Enqueued on every change the card shows, one job per revision
(`application:<id>:review-card:<revision>`).

The bot must:

1. `applications.getReviewCard(ctx, { applicationId })` with the worker's
   system actor. If `card.revision > payload.revision` → return
   `{ skipped: 'superseded' }`.
2. If `card.message` exists, edit it. On Unknown Message (10008) / Unknown
   Channel (10003), post a new one instead.
3. Otherwise post in `card.channelId` (`channels.applicationsReview`); if that
   is unset → `{ skipped: 'no review channel' }`.
4. Render one `panel()` embed: `APP-0042 — <STATUS>`, applicant display name
   and handle, domain, submitted time, assigned reviewer, interview time,
   tally, motivation/projects excerpts (≤ 300 chars) through `userText()`,
   portfolio as plain text, evidence count, referred flag. Buttons from
   `card.actions` with custom ids `applications:<action>:<applicationId>`
   (`start_review`, `review`, `schedule_interview`, `accept`, `reject`).
   `allowedMentions: { parse: [] }`. Each button handler calls the matching
   service as the clicking user; custom ids never authorize.
5. `applications.recordReviewCardMessage(ctx, { applicationId, channelId,
messageId, revision: card.revision })`. If `discard` is returned, delete
   that message (ignore 10008). The callback keeps whichever message carries
   the newer revision, so racing renders converge on one card.

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
