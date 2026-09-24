# Verification

`packages/core/src/verification` — `import { verification } from '@jave/core'`

A reusable framework for verifying claims about a member. It is the path by
which something moves from **CLAIMED** to **VERIFIED**. Every verification has:

| Facet    | Where                                                                   |
| -------- | ----------------------------------------------------------------------- |
| WHAT     | `claim` (free text) + typed target (`type`, `targetType`, `targetId`)   |
| WHO      | `subjectMemberId`                                                       |
| WHEN     | `requestedAt`, `reviewStartedAt`, `decidedAt`, `expiresAt`, `revokedAt` |
| EVIDENCE | `verification_evidence` → `evidence` rows owned by the subject          |
| STATUS   | see the state machine                                                   |
| VERIFIER | `assignedVerifierUserId`, `verifierUserId`, `revokedByUserId`           |

Human reference: `VER-0042` (`verificationReference(number)`).

## State machine

```
            startReview            approve
 pending ───────────────► in_review ───────► approved ──revoke──► revoked
   │  ▲                     │  │
   │  └──── unassign ───────┘  └── reject ──► rejected
   ├── approve / reject (direct) ──► approved / rejected
   └── expiresAt reached (pending or in_review) ──► expired
```

`rejected`, `revoked` and `expired` are terminal. An open verification whose
`expiresAt` has passed (inclusive) is treated as expired by every service even
before the sweep marks it. After a terminal state the member may request again.

## Types and targets

A strategy registry (`strategies/`) holds one pure-ish validator plus approval
and revocation side effects per type. Approval side effects are recorded in
`verifications.outcome` so a revocation reverses **exactly** what that approval
changed, and nothing a later decision changed.

| Type           | Target input                | Request rule                                           | Approval                                                                                                                | Revocation                                                          | Extra decider capability |
| -------------- | --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| `identity`     | —                           | see identity rule                                      | grants VERIFIED via `grantRoleUnchecked` (retires the previous progression role)                                        | revokes that VERIFIED grant, restores the previous progression role | —                        |
| `skill`        | `facetKey`, `requestedRank` | known facet + tier; above the current verified rank    | `setVerifiedRank` (source `verification`, `sourceRef` = verification id); verifier may grant another rank above current | reverts only while this approval holds the rank (see skill rule)    | `canModifyRanks`         |
| `project`      | `projectId`                 | subject is an active member of a non-deleted project   | records accepted evidence of kind `project`                                                                             | that evidence → `rejected`                                          | —                        |
| `contribution` | `contributionId`            | contribution belongs to the subject and is `submitted` | `contributions.status = verified` (+ `verifiedBy/At`), publishes `contribution.verified`                                | back to `submitted` if still verified by this decision              | `canVerifyContributions` |
| `achievement`  | `memberAchievementId`       | row belongs to the subject, not revoked, `unverified`  | `verification = verified` (+ `verifiedBy/At`)                                                                           | back to `unverified` if still verified by this decision             | —                        |
| `trial`        | `trialResultId`             | result belongs to the subject and is published         | records accepted evidence of kind `trial` (tagged with the result's facet when known)                                   | that evidence → `rejected`                                          | —                        |

Targets owned by someone else are reported as `NotFound` — identical to a
missing row, so there is no existence oracle. One **open** verification per
normalized target key (`targetKeys` in `rules.ts`, enforced by the partial
unique index `verifications_open_target_uq`). `project` and `trial` also refuse
a new request while an approved verification of the same target stands.

On approval, evidence linked to the request that was still `submitted` becomes
`accepted`. On revocation, exactly that evidence (same decision time and
reviewer) returns to `submitted` — unless another still-approved verification
of the subject also cites it. Then it stays `accepted` and is re-stamped with
that verification's decision time and verifier (the earliest such decision),
so revoking that one later returns it to `submitted`. The revocation audit
records `evidenceRestored` and `evidenceRetained`. Evidence rows linked to one
verification are locked in id order before either step.

A rejection changes nothing but the verification: "not proven" is not "false".

### Skill rule (stacked approvals)

Skill approvals stack as layers on one member's verified rank for one facet
(`strategies/rank-layers.ts`, pure and unit-tested). An approval must grant a
rank above the current one, so the live (approved) layers have strictly
increasing ranks and the verified rank is the highest of them. Any other
verified-rank change (evaluator, trial, import) is a **barrier**: it replaces
every layer approved before it (a change in the same millisecond counts as
later).

Revoking a skill verification:

| Situation                                             | Result (`detail`)                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| this layer is live and holds the current rank         | restore the next live layer below, else the barrier's rank, else unset (`rank_restored`)     |
| a live layer at or above this rank still stands       | rank untouched (`rank_held_by_other_verification`); revoking that one later skips this layer |
| a barrier came after this approval, or the rank moved | rank untouched (`rank_changed_after_approval`)                                               |

Rank-history rows written by the facet's own skill verifications (approvals
and revocations) are never barriers. So, while nothing else changes the rank,
revoking every approval — in any order — unwinds to the rank that stood before
the first one. Approval and revocation lock the member's capability row (and
only one skill verification per member and facet can be open), so rank
decisions on one facet run one at a time.

### Identity rule

- Eligible: members holding **TRIAL, APPLICANT or MEMBER** (`IDENTITY_ELIGIBLE_ROLES`).
- Already VERIFIED: the request is refused (`Conflict`). If VERIFIED arrives
  between request and approval, the approval succeeds with `granted: false`.
- Staff (FOUNDER, CORE, OPERATIONS, MODERATOR) are verified-equivalent: the
  request is refused; approval changes nothing.
- Anyone else (e.g. SUPPORTER only, or not in the guild) is ineligible.
- Revocation revokes VERIFIED only while the active grant is the one this
  approval made (matched by its grant reason), then restores the recorded
  previous progression role (MEMBER if none), unless the member now holds a
  staff role or another progression role.

## Who may do what

| Action                | Rule                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestVerification` | Self (any member in good standing), or `canVerifyMembers` for someone else. Self-service is capped at 10 open requests.                      |
| `assignVerifier`      | `canVerifyMembers`; not the subject, not the staff opener. The assignee must hold every capability the decision needs.                       |
| `startReview`         | `canVerifyMembers` + type capabilities; two-person rule; if assigned, only the assignee. The reviewer becomes the assignee.                  |
| `decideVerification`  | `canVerifyMembers` + type capabilities; note required; two-person rule; if assigned, only the assignee; subject in good standing to approve. |
| `revokeVerification`  | `canVerifyMembers` + type capabilities; reason required; never the subject.                                                                  |
| `listVerifications`   | `canVerifyMembers`: whole queue with filters. Members: their own only (asking for another subject is refused and audited).                   |
| `getVerification`     | Subject or `canVerifyMembers`. Anyone else gets `NotFound` and an `access.denied` audit entry.                                               |

### Two-person rule

1. Nobody verifies, reviews, routes or revokes a verification about themselves
   — founders included (`verification.self_decision_blocked`, audited durably).
2. A staff member who opened a request **on someone else's behalf** can neither
   review, decide, nor assign it, and cannot be assigned to it
   (`verification.two_person_blocked`). A staff-opened verification therefore
   always involves two distinct staff members.
3. A self-opened request needs one independent verifier.

Revocations are exempt from rule 2 so an opener can withdraw a mistaken approval.
System actors (null user) never conflict.

Subjects see status, claim, target, evidence, decision note and revoke reason.
Staff-only details (`staff`: requester, verifier, revoker, outcome) and the
assigned verifier are hidden from the subject.

## Capabilities

`canVerifyMembers` (OPERATIONS+). Skill decisions additionally need
`canModifyRanks` (CORE+); contribution decisions `canVerifyContributions`
(OPERATIONS+). No capability was added.

## Events

| Event                    | When                                 | External |
| ------------------------ | ------------------------------------ | -------- |
| `verification.requested` | a request was opened                 | no       |
| `verification.approved`  | approved (payload has `grantedRank`) | yes      |
| `verification.rejected`  | rejected                             | no       |
| `verification.revoked`   | revoked (payload has `reverted`)     | no       |
| `verification.expired`   | expired without a decision (**new**) | no       |
| `contribution.verified`  | contribution approval                | yes      |
| `evidence.submitted`     | per new evidence row in a request    | no       |

All carry `subjectMemberId`. Payloads never include notes or reasons. Skill
approvals also cause `capability.verified` (identity module); identity
approvals `member.role_granted` / `member.role_revoked`.

## Notifications

| Type                                     | Recipient         | When                                 |
| ---------------------------------------- | ----------------- | ------------------------------------ |
| `verification.completed`                 | subject           | approved, rejected, revoked, expired |
| `verification.assigned` (**new**, staff) | assigned verifier | assigned by someone else             |

Copy: `VERIFICATION APPROVED` — `VER-0042 — SKILL: Research. Verified at B.`
When the identity module already DMs the subject about the same change
(`rank.updated`), the verification notice goes to the dashboard inbox only.
Dedupe keys: `verification:<id>:<approved|rejected|revoked|expired>`.

## Audit

`verification.requested`, `verification.assigned`, `verification.review_started`,
`verification.approved`, `verification.rejected`, `verification.revoked`,
`verification.expired`, `verification.self_decision_blocked` (denied, durable),
`verification.two_person_blocked` (denied, durable), plus `access.denied` from
`authorize()` and from IDOR attempts on `getVerification`.

## Jobs

| Job                   | Kind      | Schedule     | Behaviour                                                                                                                                                                                   |
| --------------------- | --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verification.expire` | recurring | every 15 min | Expires pending/in-review rows with `expiresAt <= now` in batches of 100 (max 10 batches), one transaction per row; audit + event + notice + card refresh. Any failure makes the job retry. |

Default expiry: `VERIFICATION_EXPIRY_DAYS = 30` from the request.

## Discord job contract — `discord.verification.queue_card`

Keeps one staff-facing card per verification in
`settings.channels.verificationQueue` (new optional field). Enqueued in the
same transaction as the state change on request, assignment, review start,
decision, revocation and expiry — only when the channel is set or a card
already exists. Dedupe key: `verification-card:<id>:<status>:<assignee|none>`.

Payload: `{ verificationId: uuid }` (`queueCardJobPayloadSchema`).

The bot must:

1. Parse the payload; on failure throw `PermanentJobError`.
2. Call `verification.getQueueCard(ctx, verificationId)` with the worker's system context.
3. If `channelId` is null, complete without acting.
4. If `messageId` is set, edit that message in `channelId`; on Unknown Message,
   post a new one. Otherwise post a new message in `channelId`. When posting,
   send `nonce` = `vc` + job id with `enforce_nonce: true` so a retried job
   does not post twice.
5. Render with `panel()`: title `${reference} — ${typeLabel}`, status label,
   subject (display name + handle), target label, claim, evidence count,
   requested/expires timestamps, assigned verifier. `claim`, `targetLabel` and
   names are user-provided — pass them through `userText()`. Send with
   `allowedMentions: { parse: [] }`. Never put evidence URLs or notes on the card.
6. Report with `verification.markQueueCardPosted(ctx, input)` (system actor
   only). `input` holds `verificationId`, `channelId` and `messageId` (the
   message now showing the card), plus `previousMessageId` and `revision`:
   the `messageId` and `revision` step 2 returned. The callback is a
   compare-and-set on the recorded message id:
   - `recorded: false` — another run's card is on record. If this run posted a
     new message, delete it (ignore Unknown Message). Go to step 2.
   - `recorded: true, stale: true` — the verification changed after this
     render. Go to step 2 (the next pass edits the recorded card).
   - `recorded: true, stale: false` — done.

   Loop at most `QUEUE_CARD_MAX_RENDERS` (3) times, then throw a retryable
   error so the job backs off and runs again.

Several card jobs for one verification may run at once (the worker runs
claimed jobs in parallel and the dedupe key includes the status). The
compare-and-set keeps exactly one card; the freshness check makes the card
converge to the latest state. `revision` is a 16-hex-character fingerprint of
everything rendered. A development-only reference handler that follows these
steps against an in-memory channel lives in `testing/fake-queue-card-bot.ts`
(**MOCK / DEVELOPMENT ONLY**).

Discord permissions (queue channel only): **View Channel, Send Messages, Embed
Links, Read Message History.** Manage Messages is not needed: the bot deletes
only its own messages.

No other Discord side effects: subject notices travel through the notification
system (`notifications.deliver`).

## Schema (`packages/database/src/schema/verification.ts`)

Added to `verifications`: `target_key` (normalized target identity),
`target_label` (snapshot for display), `outcome` (jsonb, what approval changed),
`review_started_at`, `queue_channel_id`, `queue_message_id`;
`requested_by_user_id` became nullable (system/integration openers).
Indexes: `verifications_open_target_uq` (partial unique, open statuses),
`verifications_expiry_idx`, `verification_evidence_evidence_idx`.
Migration: `drizzle/0001_verification.sql`.

## Extension points

- **New type**: add the enum value, a target schema (`schemas.ts`), a key
  builder (`targetKeys`), a strategy (`strategies/`) and register it in
  `VERIFICATION_STRATEGIES`. Services do not change.
- **Automated verification**: a system or integration actor holding
  `canVerifyMembers` may open and decide requests (e.g. a trials module opening
  verifications for published results). Such requests have
  `requestedByUserId = null` (`openedBy: 'system'`).
- **Expiry window**: `VERIFICATION_EXPIRY_DAYS`; the identity eligibility list:
  `IDENTITY_ELIGIBLE_ROLES`.

## Security notes

- All ids are validated as UUIDs before touching SQL; text is trimmed,
  length-capped (claim 500, note 2000, reason 1000, evidence title 200,
  description 2000, URL 2048) and rejects NUL/control characters.
- Evidence URLs must be `http(s)` without embedded credentials.
- Claims, notes, reasons and target labels are stored verbatim: every surface
  must escape them (React does; the bot uses `userText()`).
- Decisions lock the row (`FOR UPDATE`) and update conditionally on status, so
  concurrent decisions apply exactly once.
- All authorization and durable denial audits run before a transaction opens.

## Known limitations

- The identity eligibility list and expiry window are constants, not settings
  (the settings contract only allows new fields in existing sections).
- Project verification does not check for conflicts of interest beyond the
  two-person rule (e.g. a project owner who is also staff may verify a teammate).
- Evidence can be linked to several verifications at once (ownership is the
  only check). Revocation handles this (see above), but the dashboard should
  show which verifications cite a piece of evidence.
- Card jobs dedupe on `<id>:<status>:<assignee>` against pending or running
  jobs. If a transition returns to the key of a card job that has already
  reported a fresh card but is not yet marked complete, that enqueue is
  dropped; the card then lags until the next transition (a window of
  milliseconds).
- Every integration test file builds and migrates a fresh PGlite database in
  `beforeEach`; under heavy machine load that can exceed the shared 60 s hook
  timeout, so this module's suites raise it (`KIT_SETUP_TIMEOUT_MS`) and the
  per-test timeout (`KIT_TEST_OPTIONS`). Building the migrated snapshot once
  per run belongs in the shared test harness.
- Staff are not notified of new requests (no staff inbox fan-out); the queue
  card and `listVerifications` are the intake surfaces.
- Contribution, achievement and trial rows are read and minimally updated
  directly; their owning modules' services are not called.
