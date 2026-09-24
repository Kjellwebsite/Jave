# Missions

`packages/core/src/missions` · schema `packages/database/src/schema/missions.ts`

## Purpose

Missions are concrete, verifiable pieces of work staff put in front of members:
build this, research that, run this with a team. A verified mission becomes
evidence on the member's record (kind `mission`, the mission's capability
facet), emits `mission.completed` for the achievement engine, and can grant a
reward achievement. Missions are independent of trials.

Types: `individual`, `team`, `research`, `build`, `social`, `physical`,
`strategy`, `creative`. Only `team` changes mechanics (shared submissions,
staff-formed teams); the others categorize the work.

```ts
import { missions } from '@jave/core';
const draft = await missions.createMission(ctx, { title, brief, type: 'build', durationHours: 72 });
await missions.publishMission(ctx, { missionId: draft.id });
```

## State machines

### Mission

```
draft ──publish──► open ──close──► closed ──archive──► archived (final)
  │                  ▲               │
  └────archive──►    └────reopen─────┘
```

- `publish` (draft only) sets `publishedAt`, emits `mission.published`, and queues
  the Discord card (`announce: false` skips it). A deadline in the past blocks it.
- `close` stops new assignments; work in progress continues until due.
- `reopen` requires the deadline (if any) to be in the future.
- `archive` (draft or closed) is refused while submissions await review;
  in-progress assignments expire with a notice. The archive locks the mission
  row for update before it counts pending submissions, and `submitMission`
  holds a share lock on the same row while it moves work to SUBMITTED. A
  submission therefore either commits first (and blocks the archive) or waits
  and then sees the mission archived.
- The expiry sweep closes open missions whose `deadlineAt` passed
  (`mission.auto_closed` audit, `mission.closed` event).
- `updateMission` works in every state but archived; the type only changes in draft.

### Assignment

```
assigned ──accept──► accepted ──submit──► submitted ──verify──► verified (final)
   │                    │                    │
   │                    │                    └──reject──► rejected ──resubmit──► submitted
   └─── abandon / expire (from assigned, accepted, rejected) ──► abandoned / expired
abandoned / expired ──staff re-assign──► assigned
```

- Self-assignment starts at `accepted`.
- A member must accept before submitting. On team missions, a teammate's
  submission moves every teammate still working (`assigned`, `accepted`,
  `rejected`) to `submitted`.
- Up to `MAX_SUBMISSION_ATTEMPTS` (3) submissions per assignment.
- Submitted work never expires; it waits for review.
- A member who abandoned or let a mission expire cannot self-assign it again;
  staff can re-assign (the row restarts cleanly). A re-assignment keeps the
  team the member first joined; any other team key is skipped as `team_locked`.
  The rows carrying a team key are the team's complete history, and that
  history is what keeps former members from reviewing the team's work.
- Staff never assign a mission to themselves (the whole call is refused and
  audited durably as `mission.self_assign_blocked`). They take a mission like
  any member, through `selfAssignMission`, or another staff member assigns them.
- The expiry sweep re-checks the due date on the row as it is when it expires
  it, so a row abandoned and re-assigned after the sweep read it is left alone.

### Due dates

`resolveDueAt`: explicit `dueAt` (future, not after the mission deadline) →
else `now + durationHours` (assignment override, else the mission's) capped at
the mission deadline → else the mission deadline → else none. Once the mission
deadline has passed no new work can be scheduled. Due dates are fixed at
assignment time; later deadline edits do not move existing assignments.

## Capabilities

| Action                                                  | Who                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| create, update, publish, close, reopen, archive, assign | `canManageMissions` (OPERATIONS+)                                                 |
| verify, reject, review queue                            | `canVerifyMissions` (OPERATIONS+), never your own unit                            |
| self-assign, accept, abandon, submit                    | the member, in good standing, own assignment only                                 |
| open missions, my missions, mission detail              | any member; drafts/archived are NOT_FOUND for non-staff                           |
| assignee identities, submissions of others              | mission staff only                                                                |
| member history                                          | self and mission staff: all; others: verified only, subject to profile visibility |
| `getMissionCard`, `markMissionAnnounced`                | system actor (bot worker)                                                         |

- Self-review is blocked for anyone in the unit (the whole team, in any
  assignment state, including members who walked away) and audited durably as
  `mission.self_review_blocked`. Team membership cannot be shed: staff cannot
  re-assign themselves, and nobody can move a former member to another team.
- Someone else's assignment is reported as NOT_FOUND (no IDOR, no id probing),
  including for staff: capabilities never open another member's assignment.

## Events

| Event               | When                                    | Subject     |
| ------------------- | --------------------------------------- | ----------- |
| `mission.published` | draft → open                            | —           |
| `mission.assigned`  | staff assignment or self-assignment     | assignee    |
| `mission.accepted`  | assignee accepted                       | assignee    |
| `mission.submitted` | submission (payload lists all unit ids) | submitter   |
| `mission.completed` | verification, **one per member**        | each member |
| `mission.rejected`  | rejection, one per member               | each member |
| `mission.expired`   | due date passed, or mission archived    | assignee    |
| `mission.abandoned` | assignee walked away                    | assignee    |
| `mission.closed`    | closed, auto-closed or archived         | —           |

## Notifications

| Type               | Copy                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission.assigned` | `MISSION ASSIGNED` · `M-0042 — Title. Due 2026-03-04 12:00 UTC. Accept it to start.`                                                         |
| `mission.deadline` | `MISSION DEADLINE` · `M-0042 — Title. Due in 24h.`; `MISSION EXPIRED` · `M-0042 — Title. The deadline passed without a verified submission.` |
| `mission.reviewed` | `MISSION VERIFIED` · `M-0042 — Title. Verified and on your record.`; `MISSION RETURNED` · `… Feedback: … 2 attempt(s) left.`                 |

Dedupe keys: `mission-assigned:<assignment>:<time>`,
`mission-deadline:<assignment>:<dueAt>`, `mission-expired:<assignment>:<assignedAt>`,
`mission-review:<assignment>:<assignedAt>:<attempt>`. A staff re-assignment reuses
the row and resets the attempt count, so the expiry and review keys carry the
assignment cycle (`assignedAt`): every review of every cycle is delivered.

## Audit

`mission.created`, `mission.updated` (fields), `mission.published`,
`mission.closed`, `mission.reopened`, `mission.archived`, `mission.auto_closed`,
`mission.assigned` (member ids, skipped), `mission.verified`, `mission.rejected`
(feedback), `mission.self_review_blocked` and `mission.self_assign_blocked`
(denied, durable).

## Jobs

| Job                           | Every  | Purpose                                                                                                                                                        |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missions.expire_overdue`     | 5 min  | Expire in-progress assignments past due; close lapsed missions. Batches of 200.                                                                                |
| `missions.deadline_reminders` | 15 min | Remind once per due date, 24 h ahead. Skips assignments created inside the window and exhausted rejections. `reminder_due_at` re-arms when the due date moves. |

Both are registered through `recurringJobs` and run as the system actor.

## Rewards

On verification, `rewardAchievementKey` is granted through
`achievements.awardAchievementFromSystem` with a system actor
(`systemActor('mission reward')`), inside the verification transaction. It
never overrides a revocation and skips members who already hold it. The
achievement engine separately counts `mission.completed` (FIRST MISSION,
OPERATOR, RELENTLESS).

## Discord job contracts

### `discord.missions.announce`

Payload `{ missionId: uuid, channelId: snowflake }` (`missionAnnouncePayloadSchema`).
Queued on publish. Channel: `settings.channels.missions`, falling back to
`settings.channels.announcements`; with neither set nothing is queued.

Bot:

1. `getMissionCard(ctx, { missionId })`. If null, already announced
   (`announcement !== null`) or `status !== 'open'`, complete without posting.
2. Post the card in `channelId` (`allowedMentions: { parse: [] }`, all text
   through `userText()`). Show an **ACCEPT** button with custom id
   `card.acceptCustomId` (`missions:accept:<missionId>`) only when
   `card.acceptEnabled`.
3. `markMissionAnnounced(ctx, { missionId, channelId, messageId })`.
   `{ stored: false }` → delete the message just posted (another attempt won).
   The report and any card refresh it queues commit together. If the callback
   **throws**, nothing was stored: delete the message just posted, then fail the
   job so the retry starts again at step 1.

ACCEPT button: call `selfAssignMission(ctx, { missionId })` as the clicking
user and reply ephemerally. The custom id routes; it never authorizes.

Permissions in the channel: **View Channel, Send Messages, Embed Links**.

### `discord.missions.refresh_card`

Payload `{ missionId }`. Queued when an announced mission is edited, closed,
auto-closed, reopened or archived (and by `markMissionAnnounced` if the mission
changed state while the card was posting). Bot: `getMissionCard`; if it has an
`announcement`, edit that message to the new card, with ACCEPT only when
`acceptEnabled`. Unknown message → complete. No callback. Permissions: same as
announce (editing its own message).

## Views

- `listOpenMissions(ctx, { type?, limit, offset })` — open missions, slots left,
  the viewer's own assignment status. Hidden reward achievements are masked
  (`{ hidden: true, rarity }`) for non-staff.
- `listMyMissions(ctx, { scope: 'active' | 'completed' | 'all' })`.
- `getMissionDetail(ctx, { missionId })` — counts for everyone, the viewer's own
  assignment, and `assignments` with identities for mission staff only.
- `getMemberMissionHistory(ctx, { memberId, limit })`.
- `listSubmissionsForReview(ctx, { limit, offset })` — one entry per unit (team
  or individual), oldest first, flagged `isOwn` when the reviewer is in the unit.

## Input limits

Title 3–120 (single line), brief 10–4000, submission 1–4000, evidence title
2–200 + http(s) URL ≤ 2048, feedback 3–2000, reward note 2–200, team key
`^[a-z0-9][a-z0-9_-]{0,31}$`, ≤ 50 members per assign call, `maxAssignees`
1–1000, `durationHours` 1–2160, deadline within 730 days. Control characters are
refused. Unknown fields are refused (`strict`).

## Extension points

- Staff review notifications: there is no staff notification type for new
  submissions yet; the dashboard polls `listSubmissionsForReview`. Add a
  `mission.submission_received` notification type (staff) to push them.
- New mission mechanics (e.g. peer review) extend `ASSIGNMENT_TRANSITIONS` in
  `rules.ts`, which is the single source of truth and is unit tested.

## Known limitations

- There is no invitation-only visibility. A mission meant for specific members
  (published with `announce: false` and `selfAssignable: false`) still appears
  in `listOpenMissions`, without an ACCEPT path.
- Team submissions are recorded on every teammate's assignment (text and
  evidence are copied); there is no separate team entity.
- A due date is fixed at assignment. Moving the mission deadline does not move
  existing assignments; staff can re-assign after expiry.
- The review queue scans at most 500 submitted rows per call.
- A guild with a single staff member cannot put that person on a staff-assigned
  or team mission: someone else must assign them. Individual missions can be
  made self-assignable instead.
- The locking between submissions and archiving cannot be exercised under
  PGlite, which runs one transaction at a time. A test asserts that the lock is
  taken (the mission row's `xmax` inside the submitting transaction).
