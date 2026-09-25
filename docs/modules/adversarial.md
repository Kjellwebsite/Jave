# Adversarial — safe security-culture exercises

`packages/core/src/adversarial` · schema `packages/database/src/schema/adversarial.ts`

## Purpose

JAVELIN trials can contain a hidden **adversarial role**: a participant (the
_operative_) who, under two-person staff authorization, runs a scripted,
harmless test of the team's **security culture**. Does the team paste a key
into chat under time pressure, act on an unverified change to the brief, grant
everyone admin, move a dataset somewhere it should not go, or trust someone
who only claims to be staff?

The framework measures culture, not people's worth. It runs **only** inside
authorized JAVELIN trial environments, with fictional data, sandbox accounts,
CTF-style assets and sandbox hosts. It never touches real credentials, real
personal data, people outside the trial or external systems. Participants may
know that some trials contain hidden roles, but never whether a particular one
does — until the reveal, which always happens for any team that was exposed.

## Entities

| Entity           | Table                         | Notes                                                                                                                                             |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario         | `adversarial_scenarios`       | Library entry: technique, description, objective, guardrails, sandbox assets. Key is immutable.                                                   |
| ADVERSARIAL_ROLE | `adversarial_roles`           | One operative on one team of one trial. Snapshots objective, guardrails and sandbox assets at planning, so what is authorized is what is briefed. |
| OBJECTIVE        | `adversarial_roles.objective` | Defaults to the scenario objective; may be customised at planning (validated).                                                                    |
| TRIGGER          | `adversarial_triggers`        | A planned beat for the operative (`plannedFor`), fired once (`firedAt`).                                                                          |
| OBSERVATION      | `adversarial_observations`    | How the team responded: `resisted`, `detected`, `reported`, `partial`, `failure` (a FAILURE is an observation with outcome `failure`).            |
| EVALUATION       | `adversarial_evaluations`     | 0–10 security-culture score, suggested score, override justification, staff summary, team debrief.                                                |

Invariants enforced by the database: one non-aborted role per operative per
trial and per team (partial unique indexes on `aborted_at is null`); scores
between 0 and 10 (check constraints).

## State machine

```
planned ──authorize (second person, sandbox attested)──► planned (authorized)
planned (authorized) ──brief──► briefed ──activate (trial active, before deadline)──► active
active ──conclude──► concluded ──reveal (trial over, evaluated with debrief)──► revealed
planned | briefed | active | concluded ──abort / RED FLAG / kill switch / trial end──► aborted
aborted (only if it was ever active) ──reveal──► revealed      // the team was exposed
```

- Every transition is compare-and-set (or row-locked); concurrent duplicates
  get `ConflictError`, never a double transition.
- Aborting a briefed or active role always sends the operative an immediate
  STOP. Planned roles are aborted silently — the operative never knew.
- Evaluation is possible for concluded roles and aborted roles that were
  active; it is locked after the reveal.
- The suggested score is computed under the role's row lock (the same lock
  `recordObservation` takes), and the reveal reads the debrief under that lock:
  participants' notifications and the team-channel post always carry the same
  final debrief.
- A scenario is deleted only while no role uses it; the delete locks the
  scenario row, so a concurrent plan either blocks the delete (`ConflictError`)
  or fails cleanly (`ConflictError`), never with a raw database error.

## Rules

**Planning** (`planRole`, `canManageAdversarial`, user actor)

- Global kill switch `settings.trials.adversarialEnabled` must be on (read
  fresh from the database on every check — no cache window).
- `trial.adversarialEnabled` must be true; if the trial has a template, the
  template must allow adversarial roles; the trial must be draft, recruiting,
  teams_assigned or active.
- The team must belong to the trial.
- The operative must be in good standing, VERIFIED or staff, and a
  **selected** participant on the target team. The planner cannot be the
  operative and cannot take part in the trial.
- The scenario must be active; objective, guardrails and assets must pass the
  safety validator.

**Two-person rule** (`authorizeRole`, `canAuthorizeAdversarial`)

- The authorizer must be a different person from the planner and must not be
  the operative or a participant of the trial.
- `sandboxAttested: true` is mandatory (attests fictional data and sandbox
  accounts only).
- Everything the operative will see — objective, guardrails, assets and every
  trigger — is re-validated under the row lock.
- After authorization, the plan changes only with a second person: new
  triggers must be added by someone holding `canAuthorizeAdversarial` who is
  neither the planner nor the operative. A briefed operative receives the
  updated briefing as a new revision.

**Conflict of interest.** Staff who take part in a trial are treated as
participants for that trial's roles. Role-scoped operations answer exactly as
for a missing role (audited `adversarial.conflict_of_interest_blocked`), lists
omit those trials, and they are excluded from every staff notification about
the trial.

**Visibility.** Every read requires `canManageAdversarial`, except the
operative's own briefing (`getMyBriefing`, `listMyBriefings`), available once
briefed and while the operative is in good standing. Anyone else — including a
teammate guessing an ID — gets the same `NotFoundError` as for a role that
does not exist. The audit log is readable only by roles that also hold
`canManageAdversarial` (tested invariant).

**No leakage before the reveal.** Pre-reveal transitions publish **no domain
events**: events fan out to subscribers (analytics, member activity, webhooks)
that are not bound by `canManageAdversarial`, so an event would reveal that a
trial hosts a role. They are audited instead. The only event is
`adversarial.revealed`. Discord job payloads carry IDs only; content is
loaded at send time.

## Safety validator (`safety.ts`, pure)

Strict by design: it rejects when in doubt; staff reword.

| Rule                  | Applies to | Rejects                                                                                                                                                                                                          |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `too_long`            | all        | Text over 10 000 characters (not scanned).                                                                                                                                                                       |
| `hidden_characters`   | all        | Bidi overrides, zero-width and control characters.                                                                                                                                                               |
| `secret`              | all        | Anything the kernel redaction patterns match, plus further credential shapes, key/value secret assignments and long random tokens. Only fictional `JVLN-SANDBOX-…` keys are allowed. The secret is never echoed. |
| `external_link`       | all        | Any URL, bare domain or e-mail domain outside `jvln.test`, `example.com/.org/.net` (and subdomains); non-http(s) schemes; defanged, full-width and ideographic-dot tricks.                                       |
| `personal_data`       | content    | Requests for passwords, 2FA/OTP/recovery codes, SSNs, bank/card data, home addresses, phone numbers, real accounts or identities.                                                                                |
| `out_of_scope`        | content    | Production or real systems, off-platform accounts, people outside the trial, malware, DoS, IP addresses, localhost, mass or raw mentions.                                                                        |
| `missing_prohibition` | guardrails | Guardrails missing any of the standard prohibitions (`STANDARD_PROHIBITIONS`, verbatim, case- and whitespace-insensitive).                                                                                       |

Kinds: `content` (scenario, objective, triggers), `guardrails`, `report`
(observations, summaries, debriefs). Abort reasons and RED FLAG notes are
**sanitized and cut, never rejected** (secrets redacted, hidden characters
removed, over-long text truncated) — a STOP is never blocked by validation.

The operative briefing always contains the guardrails, the operating rules and
the **stop-word protocol**: saying or typing `RED FLAG` ends the exercise
immediately.

## Scoring

`suggestScore(outcomes)` starts at 5 and adds reported +2, detected +1.5,
resisted +1, partial −1, failure −2.5, rounded and clamped to 0–10. No
observations → no suggestion (UNKNOWN is not a score): the evaluator must set
one and justify it. Any score that differs from the suggestion requires a
justification. The operative cannot record observations on or evaluate their
own role.

## Services

| Function                                                                                                                                                      | Capability / actor                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `createScenario`, `updateScenario`, `deleteScenario`, `getScenario`, `listScenarios`, `seedStarterScenarios`                                                  | `canManageAdversarial`                                         |
| `planRole`, `briefRole`, `activateRole`, `concludeRole`, `abortRole`, `addTrigger`, `recordObservation`, `evaluateRole`, `revealRole`, `getRole`, `listRoles` | `canManageAdversarial`                                         |
| `authorizeRole`                                                                                                                                               | `canAuthorizeAdversarial`, second person                       |
| `raiseRedFlag` (idempotent, including concurrent calls; never blocked by validation)                                                                          | the briefed operative (any standing) or `canManageAdversarial` |
| `fireTrigger`                                                                                                                                                 | the operative (good standing) or `canManageAdversarial`        |
| `getMyBriefing`, `listMyBriefings`                                                                                                                            | the operative only                                             |
| `loadBriefingDelivery`, `loadStopNotice`, `loadDebrief`, `mark*` callbacks                                                                                    | system actor (bot worker) only                                 |

`seedStarterScenarios` is idempotent and seeds five fictional scenarios:
Urgent Token Request, Unverified Brief Change, Permission Shortcut, Data Export
Ask, Impersonated Evaluator. Edited starter scenarios are never overwritten.

## Audit

Every action is audited: `adversarial.scenario_created|updated|deleted|viewed`,
`scenarios_listed`, `scenarios_seeded`,
`role_planned|authorized|briefed|activated|concluded|aborted|evaluated|revealed`,
`trigger_added|fired`, `observation_recorded`, `role_viewed`, `roles_listed`,
`briefing_viewed`, `briefings_listed`, `briefing_delivered`,
`stop_notice_delivered`, `debrief_posted`, and the denials
`two_person_rule_blocked`, `self_assignment_blocked`,
`self_evaluation_blocked`, `conflict_of_interest_blocked`, `access.denied`.
Denials are written durably (outside the transaction) so they survive the
rollback of the refused operation.

## Events

| Event                  | When         | Notes                                                              |
| ---------------------- | ------------ | ------------------------------------------------------------------ |
| `adversarial.revealed` | `revealRole` | `external: false`; `subjectMemberId` = operative (public by then). |

Subscribed: `trial.cancelled`, `trial.submissions_closed`, `trial.completed`
(reconcile the trial's roles — the trial row is the source of truth, never the
payload) and `settings.updated` for section `trials` (enforce the kill switch).

## Notifications

| Type                   | Recipient            | When                                                                                 |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `adversarial.briefing` | operative            | Briefed (inbox pointer only), briefing updated, exercise live, concluded, revealed.  |
| `adversarial.stop`     | operative            | Any abort of a briefed/active role (critical; the DM is the Discord job).            |
| `adversarial.revealed` | team participants    | At the reveal, with the debrief.                                                     |
| `adversarial.staff`    | authorizers, planner | Authorization requested, authorized, briefing/debrief undeliverable, reveal pending. |
| `adversarial.alert`    | managers             | RED FLAG raised, STOP undeliverable (critical).                                      |

Staff notifications exclude anyone taking part in the trial.

## Jobs

| Job                 | Kind                    | Behaviour                                                                                                                                                                                                |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adversarial.sweep` | recurring, every 15 min | Enforce the kill switch; abort roles whose operative lost eligibility; reconcile roles of finished/cancelled trials; remind managers once when a reveal is 3 days overdue. Tolerates concurrent changes. |

## Discord job contracts (`discord-jobs.ts`)

All handlers: validate the payload with the exported zod schema; load content
through the loader (never render from the payload); treat a loader's
`INVALID_STATE`/`NOT_FOUND` as "do not send" (permanent); send with
`allowedMentions: { parse: [] }` and escape every text with `userText()`;
report back through the callback (idempotent).

| Job type                      | Payload                | Bot must                                                                                                                                                                                                                                                                                                       | Discord permissions                                  | Callback                                                       |
| ----------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `discord.adversarial.brief`   | `{ roleId, revision }` | `loadBriefingDelivery({ roleId, revision })` → send nothing if `superseded` (a newer revision's job delivers; jobs may run concurrently) or `alreadyDelivered`; otherwise DM every section (scenario, objective, assets, triggers, guardrails, operating rules, stop protocol). Never post in a guild channel. | None in the guild (shares the guild to open a DM)    | `markBriefingDelivered({ roleId, revision, outcome })`         |
| `discord.adversarial.abort`   | `{ roleId }`           | `loadStopNotice` → DM the fixed STOP title and body (never the reason). Skip if `alreadyDelivered`. Throw on transient errors (12 attempts).                                                                                                                                                                   | None in the guild                                    | `markStopNoticeDelivered({ roleId, outcome })`                 |
| `discord.adversarial.debrief` | `{ roleId }`           | `loadDebrief` → post the debrief in the team channel (`channelId`). Skip if `alreadyPosted`; if `channelId` is null report `undeliverable`. Never add participant names.                                                                                                                                       | ViewChannel, SendMessages, EmbedLinks (team channel) | `markDebriefPosted({ roleId, outcome, channelId, messageId })` |

`undeliverable` outcomes escalate: closed DMs for a briefing notify the
planner; an undeliverable STOP raises a critical alert so a human contacts the
operative; a missing team channel notifies the planner (participants already
got the debrief as a notification).

## Tests

`packages/core/src/adversarial/*.test.ts`, run with
`cd packages/core && npx vitest run src/adversarial --maxWorkers=2`.

| File                 | Covers                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `safety.test.ts`     | Validator: secrets, links/hosts, personal data, out-of-scope targets, guardrails, obfuscation, pathological input.       |
| `pure.test.ts`       | Scoring, state predicates, briefing/debrief builders, capability invariants.                                             |
| `scenarios.test.ts`  | Library CRUD, idempotent seeding, snapshots.                                                                             |
| `lifecycle.test.ts`  | Full flow on a trial built with direct inserts; two-person rule; kill switch; trial gates; operative constraints.        |
| `operations.test.ts` | Abort and RED FLAG, defense in depth, delivery callbacks, triggers/observations/time edges, evaluation.                  |
| `visibility.test.ts` | IDOR and leak tests: participants, moderators and operations read nothing; nothing observable before the reveal.         |
| `conflict.test.ts`   | Staff competing in a trial; quarantined operatives.                                                                      |
| `jobs.test.ts`       | Kill-switch enforcement, trial reconciliation, sweep, reminders, registry wiring.                                        |
| `contracts.test.ts`  | The three Discord job contracts executed through the real queue by a simulated bot worker (test double), incl. failures. |
| `hardening.test.ts`  | Races: scenario delete vs. plan, re-evaluation vs. reveal, observation vs. evaluation; audited library reads.            |

## Extension points

- **Stop-word listener.** A bot gateway listener may call `raiseRedFlag`
  (system actor) for a role when the operative types `RED FLAG`. Not wired in
  v0.1; the operative and staff raise it through the services.
- **Sandbox domains** are a code constant (`SANDBOX_DOMAINS`), deliberately not a
  setting: widening them is a code review, not a toggle.
- **Trials module.** This module reads the trials schema directly and reacts
  to `trial.*` events; it needs the trials module to keep
  `trials.adversarial_enabled` hidden from participants.

## Known limitations

- The validator is keyword- and shape-based. It blocks obvious and obfuscated
  mistakes (defanged links, full-width text, zero-width splitting), not a
  determined insider rewording prohibited intent; the two-person rule is the
  control for that.
- Strictness produces false positives on ordinary prose ("beyond the trial
  brief", "done.Next"); the error names the phrase so staff can reword.
- Staff who hold `canManageAdversarial` can read every role outside trials they
  take part in; there is no per-role ACL.
- Operative eligibility loss is enforced immediately for self-service and by
  the 15-minute sweep for running exercises (there is no standing-changed
  event yet).
- The reveal notifies participants who are still `selected` on the team; one
  who withdrew or was removed after exposure sees the debrief only in the team
  channel (if they still have access).
- The debrief text is staff-written. The validator blocks secrets and links,
  not names; keeping it free of individual participants' names is the
  evaluator's responsibility (the generated sections never name them).
- Evaluators accepting the suggested score (no `score` given) accept the
  suggestion as computed at save time; an observation recorded between viewing
  and saving changes it.
