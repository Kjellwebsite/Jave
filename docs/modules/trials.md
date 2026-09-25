# Trials — the Gauntlet

`packages/core/src/trials` · schema `packages/database/src/schema/trials.ts` ·
`import { trials } from '@jave/core'`

## Purpose

Trials are how JAVELIN turns _claimed_ capability into _verified_ capability.
Teams get a real mission, a deadline and a published rubric; evaluators score
the outcome; results are published; an evaluator may then — explicitly — turn a
passing result into a VERIFIED rank for the trial's primary facet.

Principles the module enforces:

- **Outcomes, not effort.** AI tools are allowed. Rubrics measure what the team
  actually accomplished with the tools available, never manual effort.
- **Descriptive, not a score of worth.** A result is evidence for one facet. There
  is no global ranking, no XP, and Discord activity is never an input.
- **No self-dealing.** Nobody evaluates themselves, and nobody with a stake in a
  trial operates, views staff data of, or evaluates that trial — founders included.
- **Adversarial secrecy.** Nothing adversarial ever reaches a participant.

Categories: BUILD, RESEARCH, STRATEGY, INVESTIGATION, CRISIS, CREATION,
COMMUNICATION, LEADERSHIP, MARKETING, TECHNICAL, SECURITY, ADAPTABILITY,
TEAMWORK, EXECUTION.

## State machines

### Trial

```
draft → recruiting → teams_assigned → active → evaluating → completed
  └─────────┴──────────────┴────────────┴──────────┴──→ cancelled
```

| Transition                      | Service                                        | Notes                                                      |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| — → draft                       | `createTrial`                                  | From a template (snapshot) or fully custom.                |
| draft → recruiting              | `openRecruitment`                              | Needs a public summary. Posts the recruitment card.        |
| recruiting → teams_assigned     | `assignTeams`                                  | Needs ≥ 1 selected participant.                            |
| teams_assigned → teams_assigned | `assignTeams`                                  | Reshuffle before the start; old team channels torn down.   |
| teams_assigned → active         | `startTrial` / scheduled auto-start            | Every team must have members.                              |
| active → evaluating             | `closeSubmissions` / close job / overdue sweep | Automatic at deadline + grace.                             |
| evaluating → completed          | `publishResults`                               | Refuses unevaluated submitted work unless acknowledged.    |
| any non-terminal → cancelled    | `cancelTrial`                                  | Reason required; stakeholders notified; channels archived. |

`completed` and `cancelled` are terminal. Content (brief, rubric, sizing,
facets) is editable in draft, recruiting and teams_assigned (`updateTrial`);
the recruitment window only in draft and recruiting. A scheduled start never
precedes the recruitment close, and `maxParticipants` cannot drop below the
number already selected.

### Participant

`applied` → `selected` (by `selectParticipants`) → on a team (by `assignTeams`).
Applicants not selected when teams are assigned become `waitlisted`. Selected
members who are no longer eligible when teams are (re)assigned become
`removed` and are told so. Members may `withdraw` while recruiting or
teams_assigned; after the start they cannot. A withdrawn member may re-apply
while recruiting (staff may not — see below); a removed member may not.

### Submission timing

- `deadline = startedAt + durationMinutes`.
- `grace = settings.trials.submissionGraceMinutes` (default 15), frozen on the
  trial at start.
- Submissions are accepted until `deadline + grace` (inclusive). After the
  deadline they are flagged `isLate`. There is **no automatic score penalty**:
  evaluators see the flag and judge it. Nothing is accepted after
  `deadline + grace` — even before the close job runs — or after a manual close.
- Every submission is a new version (1, 2, …, max 20 per team); evaluators
  assess the latest.

## Rules

**Eligibility.** TRIAL, VERIFIED and staff roles (FOUNDER, CORE, OPERATIONS,
MODERATOR); standing `good`; present in the server. Re-checked at selection
time — a member who lost the TRIAL role after applying is no longer selectable —
and again at team assignment, where a selected member who became ineligible is
marked `removed` (audited in `trial.teams_assigned` as `removedIneligible`).
Participation is opt-in: only applicants can be selected.

**Conflict of interest.** A member with a stake (applied, selected or
waitlisted) cannot: edit, select, assign, start, extend, close, evaluate,
preview, publish, re-provision, cancel, configure adversarial roles, apply rank
consequences, or open the staff view of that trial. Blocks are audited
(`trial.conflict_of_interest_blocked`). Self-evaluation is additionally audited
as `trial.self_evaluation_blocked`. Stakeholding staff are also denied the
evaluator view of other teams' Discord channels (per-member deny overwrites).

**Staff applicants.** Staff can read a sealed brief through the staff view, so:
the trial's creator cannot apply, nor can staff who changed its brief or rubric
(`trials.editor_user_ids`); staff holding `canManageTrials` or
`canEvaluateTrials` may apply once (audited `trial.staff_applied`) and cannot
re-apply after withdrawing.

**Sealed brief.** The brief and rubric are shown to competitors only once the
trial is active. Non-competitors never see them through the member view.
Recruitment shows the public `summary`. Past draft, it cannot be shortened
below the minimum, so the card never goes blank.

**Scheduled start.** `openRecruitment` refuses a `scheduledStartAt` that
already passed. `assignTeams` returns `scheduledStart` (`scheduled`, `passed`
or null) so the surface can prompt a manual start. A skipped auto-start is
audited and alerts `canManageTrials` holders (`trial.attention`).

**Discord re-syncs.** Provisioning and archive jobs are enqueued with
`rerunIfRunning`: a withdrawal or late channel that lands while the job runs
makes it run once more instead of being dropped. A reshuffle locks the old
team rows before retiring them, so a channel id committed meanwhile is torn
down, or the bot's callback finds the team gone and deletes the channel.

**Adversarial secrecy.** `adversarialEnabled` and template `allowsAdversarial`
appear only in views for holders of `canManageAdversarial`. Member views are
built from explicit field whitelists; events never carry adversarial fields.
Enabling needs `canManageAdversarial`, `settings.trials.adversarialEnabled`, and
(for template trials) a template with `allowsAdversarial`.

### Team assignment (pure, `planTeams`)

Deterministic given (candidates, team size, strategy, seed) — input order does
not matter. The seed (generated if omitted) is stored on the trial and in the
`trial.teams_assigned` audit entry, so any assignment can be reproduced.

- **Team count** is ⌊n/size⌋ or ⌈n/size⌉, whichever keeps sizes closest to the
  target (ties → fewer, larger teams). Sizes differ by at most one, larger
  teams first. Fewer members than `size` → one team. 0 members → no teams.
  Examples at size 3: 4 → [4], 5 → [3, 2], 7 → [4, 3], 10 → [4, 3, 3].
- **random**: seeded shuffle of everyone, dealt round-robin.
- **balanced**: members grouped by primary domain (largest group first), each
  group shuffled, then dealt round-robin — per domain, team counts differ by
  at most one.
- **Lead**: highest lead priority (VERIFIED/staff above TRIAL); ties → first
  dealt (seeded).
- **Names**: UNIT ALPHA, UNIT BRAVO, … UNIT ZULU, UNIT ALPHA 2, …

Random selection (`selectParticipants` mode `random`) is seeded the same way.

### Scoring (pure, `computeResults`)

- Each evaluation scores **every** rubric criterion 0–10 (integers).
  `overallScore = Σ(weight·score) / Σ(weight)`, rounded to 2 decimals.
- `teamScore` = mean of the team evaluations of the member's team.
- `individualScore` = mean of the member's individual evaluations, else `teamScore`.
  When a team has no team evaluation, individual scores stand in for it.
- `final = teamWeight·team + (1 − teamWeight)·individual` (`settings.trials.teamWeight`, default 0.6).
- Outcome: `final ≥ distinctionThreshold` → DISTINCTION; `≥ passThreshold` → PASS;
  else FAIL (a distinction threshold below the pass mark counts as the pass mark).
- **INCOMPLETE** when the team never submitted (`no_submission`) or nothing about
  the member was evaluated (`not_evaluated`). A missing evaluation is never
  turned into a FAIL. `publishResults` refuses while submitted work is
  unevaluated unless called with `acknowledgeIncomplete: true`.
- Thresholds and weights are read at publish time.

### Recommended rank (pure, `recommendRank`)

For the trial's primary facet (first valid `facetKeys` entry), passing outcomes only:

| Final score | Recommended |
| ----------- | ----------- |
| ≥ 9.0       | A           |
| ≥ 8.0       | B           |
| ≥ 7.0       | C           |
| ≥ 6.0       | D           |
| ≥ 5.0       | E           |
| otherwise   | F           |

A single trial never recommends S: S needs sustained, independently evidenced
excellence. Disabled tiers are dropped.

### Rank consequence (`applyRankConsequence`)

Never automatic. Requires `canModifyRanks`, a published passing result with a
recommendation, and no stake in the trial. The rank defaults to the
recommendation and may be set lower, never higher: the trial is evidence for
at most what it measured (a higher rank is an evaluator decision through
`setVerifiedRank`, attributed to the evaluator). Creates `evidence` (kind `trial`, `sourceType 'trial'`,
`sourceId` = trial id), calls `setVerifiedRank` with `source: 'trial'` and
`sourceRef` = trial id (so the rank history, audit, event and notification come
from identity), and stores `rankHistoryId` on the result. Applies once per
result; never lowers or repeats a verified rank (a lower recommendation is
refused — evaluators can still use `setVerifiedRank` directly). Self-application
is refused and audited.

## Capabilities

| Capability               | Used for                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `canManageTrials`        | Templates, create/edit/open/select/assign/start/extend/close/publish/cancel, re-provision, staff view |
| `canEvaluateTrials`      | `evaluate`, `previewResults`, staff view                                                              |
| `canModifyRanks`         | `applyRankConsequence`                                                                                |
| `canManageAdversarial`   | Adversarial flags (templates and trials), seeing them in views                                        |
| `canViewMembers`         | Member views, `applyToTrial`, `submit` (blocks quarantined/banned members)                            |
| `canViewPrivateProfiles` | Another member's `memberTrialHistory`                                                                 |

No capability was added.

## Services

Templates: `createTemplate`, `updateTemplate` (partial; key immutable),
`deactivateTemplate`, `getTemplate`, `listTemplates`, `seedStarterTemplates`
(idempotent; six curated templates, never overwrites edits). The seed is
curated code, so a manager without `canManageAdversarial` may install Red
Flag Hunt (`allowsAdversarial`); enabling adversarial roles on a trial still
needs that capability and the global switch.

Lifecycle: `createTrial`, `updateTrial`, `setAdversarialEnabled`,
`openRecruitment`, `applyToTrial`, `withdraw`, `selectParticipants`,
`assignTeams`, `startTrial`, `extendDeadline`, `submit`, `closeSubmissions`,
`evaluate`, `previewResults`, `publishResults`, `applyRankConsequence`,
`cancelTrial`.

Views: `getTrialForParticipant`, `getTrialForStaff`, `listTrials`, `myTrials`,
`memberTrialHistory`, `remainingTime`. Members see trials from recruiting
onwards, plus cancelled trials they took part in — the same rule for the
participant view and the countdown; anything else answers NOT_FOUND. Trial
staff see every status.

Discord: spec loaders and callbacks below, plus `reprovisionTeams`.

Jobs: `sweepOverdueTrials` (system actor only).

Helpers that skip authorization (`startTrialInternal`,
`closeSubmissionsInternal`, `loadTemplate`, `assertFacetKeys`) are
module-private; the internals additionally refuse non-system actors for
automatic triggers.

Pure: `planTeams`, `planTeamSizes`, `computeResults`, `weightedScore`,
`recommendRank`, `trialTiming`, `warningSchedule`, `canTransition`.

## Events

| Type                          | External | When                                                 |
| ----------------------------- | -------- | ---------------------------------------------------- |
| `trial.created`               | no       | createTrial                                          |
| `trial.recruiting`            | yes      | openRecruitment                                      |
| `trial.participant_applied`   | no       | applyToTrial (subject: applicant)                    |
| `trial.participant_withdrawn` | no       | withdraw (subject: member) — **added**               |
| `trial.participant_selected`  | no       | newly selected (subject: member)                     |
| `trial.teams_assigned`        | no       | assignTeams                                          |
| `trial.started`               | yes      | start (manual or scheduled)                          |
| `trial.deadline_extended`     | no       | extendDeadline — **added**                           |
| `trial.submission_received`   | no       | submit (subject: submitter)                          |
| `trial.submissions_closed`    | no       | close (manual, deadline job, sweep)                  |
| `trial.evaluation_recorded`   | no       | evaluate (subject: member if individual) — **added** |
| `trial.result_published`      | no       | per competitor (subject: member)                     |
| `trial.passed`                | yes      | per PASS/DISTINCTION (subject: member)               |
| `trial.completed`             | yes      | publishResults, once                                 |
| `trial.cancelled`             | no       | cancelTrial                                          |

Payloads never contain adversarial fields, scores of others, or Discord IDs.

## Notifications

| Type                                            | Recipients                                     | When                                                                   |
| ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `trial.update` **(added)**                      | participants                                   | team assignment / waitlist / removal, submissions closed, cancellation |
| `trial.starting`                                | competitors                                    | start                                                                  |
| `trial.deadline`                                | competitors                                    | each deadline warning; deadline extension                              |
| `trial.evaluation_requested` **(added, staff)** | holders of `canEvaluateTrials` without a stake | submissions closed                                                     |
| `trial.result`                                  | competitors                                    | publishResults                                                         |

Every notification has a dedupe key on the underlying fact
(`trial:<id>:result:<member>` etc.).

## Audit

Sensitive actions are audited in the same transaction as the change:
`trial.template_created`, `trial.template_updated`, `trial.template_deactivated`,
`trial.templates_seeded`, `trial.created`, `trial.updated`,
`trial.adversarial_toggled`, `trial.recruitment_opened`, `trial.staff_applied`,
`trial.participants_selected` (mode, seed, selection), `trial.teams_assigned`
(strategy, seed, teams, removed members), `trial.started`,
`trial.deadline_extended`, `trial.submissions_closed`, `trial.evaluated`
(per-criterion scores), `trial.results_published`,
`trial.rank_consequence_applied`, `trial.cancelled`.

Written durably (they survive the rollback of the refused action):
`access.denied`, `trial.conflict_of_interest_blocked`,
`trial.self_evaluation_blocked`, `rank.self_verification_blocked`,
`trial.auto_start_skipped`.

## Background jobs (core, system actor)

| Type                       | Scheduled                                                                  | Behaviour                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trials.deadline_warning`  | start/extension, at deadline − m for each `deadlineWarningsMinutes`        | Skips unless active with the same deadline; reports the time actually left; never fires after the deadline; fans out DMs and `discord.trials.warning`.                                                     |
| `trials.close_submissions` | start/extension, at deadline + grace                                       | Closes only if still active, deadline unchanged, and due.                                                                                                                                                  |
| `trials.auto_start`        | assignTeams / updateTrial when `scheduledStartAt` is set and in the future | Starts if still waiting and the schedule is unchanged (re-checked under the row lock); an impossible start (e.g. an empty team) is skipped and audited as `trial.auto_start_skipped`, never dead-lettered. |
| `trials.sweep_overdue`     | recurring, every 10 minutes                                                | Safety net: closes any active trial past deadline + grace.                                                                                                                                                 |

Dedupe keys include the deadline/start instant, so rescheduling never collides
with stale jobs; stale jobs are also cancelled best-effort and are no-ops if
they run anyway.

## Discord job contracts

Source of truth: `discord-jobs.ts`. All handlers live in `apps/bot` (not yet
implemented). Rules common to every handler: parse the payload with the
exported zod schema; load current state through the named **spec loader**
(system actor only); be idempotent; render user text with `userText()` and send
with `allowedMentions: { parse: [] }`; map `DiscordActionError.permanent` to
`PermanentJobError`; report back through the named **callback** (system actor
only — user actors are refused).

| Job type                   | Payload                                             | Spec loader               | Callback                 |
| -------------------------- | --------------------------------------------------- | ------------------------- | ------------------------ |
| `discord.trials.announce`  | `{ trialId }`                                       | `getAnnouncementSpec`     | `markAnnouncementPosted` |
| `discord.trials.provision` | `{ trialId, teamId }`                               | `getTeamProvisioningSpec` | `markTeamProvisioned`    |
| `discord.trials.brief`     | `{ trialId, teamId }`                               | `getTeamBriefSpec`        | `markTeamBriefed`        |
| `discord.trials.warning`   | `{ trialId, teamId, minutesRemaining, deadlineAt }` | `getTeamWarningSpec`      | —                        |
| `discord.trials.archive`   | `{ trialId }`                                       | `getArchiveSpec`          | `markTeamsArchived`      |
| `discord.trials.teardown`  | `{ trialId, teamName, channelId, roleId }`          | — (self-contained)        | —                        |

**announce** — `skip` | `post` (send the card to `channelId`, then
`markAnnouncementPosted`) | `edit` (edit `messageId`; if it is gone, post anew
and report). The card carries `heading`, `kicker`, `summary`, `facts`; an APPLY
button (opens a statement modal → `applyToTrial`) while
`acceptingApplications`, otherwise a disabled button labelled `buttonLabel`.
Enqueued on open, at `recruitmentClosesAt`, on card-relevant edits, when teams
are assigned, and on completion/cancellation. Skipped when no announcements
channel is configured. _Permissions:_ View Channel, Send Messages, Embed Links,
Read Message History in `settings.channels.announcements`.

**provision** — `skip` | `ensure`: create (or keep) a text channel
`channelName` (e.g. `trial-0042-unit-alpha`) under `parentCategoryId`
(`settings.channels.trialsCategory`) with `topic`; set overwrites to exactly:
@everyone deny View; each `memberDiscordIds` allow View/Send/Read History/Attach/
Embed/React; each `evaluatorRoleIds` (Discord roles mapped from JAVE roles
holding `canEvaluateTrials`) allow View/Read History/Send; each
`denyDiscordIds` (staff with a stake elsewhere in the trial) deny View. With
`createRole` (`settings.trials.createTeamRoles`), keep a team role `roleName`
whose holders equal `memberDiscordIds`. Then `markTeamProvisioned`. If the
callback throws NOT_FOUND (team reshuffled away), delete what was just created.
Throws INVALID_STATE (dead-letters) when the trials category is not configured
— configure it and call `reprovisionTeams`. Re-run on withdrawal and via
`reprovisionTeams` to re-sync membership. _Permissions:_ Manage Channels and
View Channel in the trials category; Manage Roles only with team roles (bot
role above them).

**brief** — `skip` | `wait` (throw a retryable error) | `post`: in `channelId`,
a panel `heading`, the brief (split across embeds as needed), the rubric
(label, weight %, description), the deadline as `<t:unix:F>` and
`<t:unix:R>`; then `markTeamBriefed`. Enqueued at start for provisioned teams,
and by `markTeamProvisioned` for teams provisioned after the start.
_Permissions:_ View Channel, Send Messages, Embed Links.

**warning** — `skip` (trial closed, deadline moved, no channel) | `post`:
send `message` with the deadline timestamp. _Permissions:_ View Channel, Send Messages.

**archive** — `skip` | `archive`: for each team, member overwrites become
View + Read History, deny Send/React; post `closingMessage`; rename to
`archivedChannelName`; delete the team role if any; then `markTeamsArchived`
with the handled team ids. Channels are kept read-only as the record.
`markTeamProvisioned` re-enqueues it when provisioning finished after the
trial ended. _Permissions:_ Manage Channels; Manage Roles with team roles.

**teardown** — delete `channelId` and `roleId` if set (unknown counts as
success). Used when a reshuffle deletes teams that already had Discord
resources. _Permissions:_ Manage Channels; Manage Roles with team roles.

Staff who take part in a trial must not hold Administrator — it bypasses
channel overwrites.

## Settings

Read: `trials.enabled`, `defaultTeamSize`, `passThreshold`,
`distinctionThreshold`, `teamWeight`, `deadlineWarningsMinutes`,
`adversarialEnabled`; `channels.trialsCategory`, `channels.announcements`;
`roles.discordRoleIds`.

Added to `trials`: `submissionGraceMinutes` (0–1440, default 15),
`createTeamRoles` (default false).

## Schema changes (`trials.ts`, migration `0001_trials.sql`)

- `trials`: `summary`, `grace_minutes`, `assignment_strategy`,
  `assignment_seed`, `cancel_reason`; checks on team size, duration, grace.
- `trial_teams`: `briefed_at`, `archived_at`.
- `trial_templates`: checks on team-size range and duration.
- `trial_evaluations`: `overall_score` 0–10 check. `trial_scores`: 0–10 check.
- Indexes: `trial_participants(member_id)`, `trial_results(member_id)`.

## Extension points

- **Bot handlers** for the six contracts (`apps/bot/src/features/trials`). The
  MOCK / DEVELOPMENT ONLY bot in `trials/testing/fixtures.ts` shows the exact
  call sequence for each and is exercised by the tests.
- **Eligibility** is `ELIGIBLE_ROLES` / `eligibilityProblem` — one place to change.
- **Rank ladder** is `RANK_RECOMMENDATION_LADDER`; new tiers (S+, SS) need no
  change here because a single trial never recommends S.
- **Achievements / analytics** subscribe to `trial.passed`,
  `trial.result_published` and `trial.completed` (all carry `subjectMemberId`
  where they are about a member).
- **Adversarial module** owns roles/observations; it can read
  `adversarialEnabled` through `getTrialForStaff` (with `canManageAdversarial`)
  and toggle it with `setAdversarialEnabled`.

## Known limitations

- Rescheduling a deadline notifies competitors by DM; team channels are not
  told (the next warning in the channel carries the new deadline).
- Late submissions carry no automatic penalty — by design, evaluators judge.
- A member banned or quarantined after team assignment stays on their team
  (they can no longer submit); removing them is left to moderation. Before
  that point, assignment removes them.
- Residual conflict risk: staff who read a brief before ever applying are not
  tracked; the creator block, the no-re-apply rule and the `trial.staff_applied`
  audit make this visible rather than impossible.
- Results use settings (thresholds, team weight) as they are at publish time.
- Soft-deleted members keep their participation rows and results.
