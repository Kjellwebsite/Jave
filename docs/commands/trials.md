# Discord & dashboard: trials

Feature `apps/bot/src/features/trials` · custom-id namespace `trials` · dashboard
`apps/dashboard/app/(console)/trials` · domain: `@jave/core` `trials` (see
[docs/modules/trials.md](../modules/trials.md)). The hidden adversarial role has its own
page: [adversarial.md](./adversarial.md).

Trials turn _claimed_ capability into _verified_ capability: a real mission, a sealed
brief, a published rubric, a deadline, evaluators, published results — and, only when
an evaluator decides so, a VERIFIED rank. Discord is driven by buttons, selects and
modals; the only typed argument is an optional trial reference (autocomplete). Every
reply is ephemeral except the public recruitment card and the posts in private team
channels.

## Slash commands

### `/trial`

| Subcommand         | Who                                                | What it does                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`             | any member                                         | Recruiting and running trials (drafts never), an **Open a trial** select, and an **APPLY · TRIAL-0042** button for every trial the member may apply to right now (core decides per trial).                                       |
| `view [trial]`     | any member                                         | One trial as the member may see it: state, clock (`<t:…:F>` / `<t:…:R>`), their participation, team, submissions and result. The brief and rubric appear only for competitors once the trial is live. Without `trial`: a picker. |
| `apply [trial]`    | TRIAL, VERIFIED or staff in good standing          | Opens the **statement** modal (20–1500 characters). Without `trial`: one APPLY button per open trial. When applying is not possible it says why instead of opening a form (already holding a place, closed, not eligible).       |
| `withdraw [trial]` | a member holding a place, before the start         | Confirmation first (**CONFIRM WITHDRAWAL**), then the place is released and the team channel re-synced. Staff cannot re-apply after withdrawing.                                                                                 |
| `submit [trial]`   | a member of a team, while submissions are open     | The **team submission** modal, prefilled with the team's latest version: summary + one http(s) link per line (≤ 10). The title says **LATE** inside the late window; the description names the version it becomes.               |
| `status`           | any member                                         | Every trial the member took part in: state, team, deadline countdown, submission version, result — with an **Open a trial** select.                                                                                              |
| `briefing`         | anyone (answers only the operative)                | The caller's own confidential briefing, else the same **NO BRIEFING** answer for everyone. See [adversarial.md](./adversarial.md).                                                                                               |
| `manage [trial]`   | `canManageTrials` or `canEvaluateTrials`, no stake | The **trial control panel** (below). Without `trial`: a picker of every trial, running ones first.                                                                                                                               |

`trial` autocompletes only trials the caller may see; a typed `TRIAL-0042`, `#42`, `42`
or exact title resolves the same way. Anything else is NOT FOUND.

### `/team`

Any member. For every team the member is on (teams set, live or in evaluation): team
name and state, the private channel (`<#channel>`), the deadline (`<t:…:F>` ·
`<t:…:R>`) or the start, the roster with the lead, and — once live — the first lines of
the brief. Buttons: **SUBMIT** (when open) and **TRIAL**.

### User context menu: **Trial Record**

Right-click a member → Apps → Trial Record. Yourself: always. Another member: needs
`canViewPrivateProfiles` (core `memberTrialHistory`). Shows every trial competed in
with outcome and final score.

## The recruitment card (public)

Posted by the `discord.trials.announce` job in `settings.channels.announcements`:
heading, kicker, public summary (never the brief), format facts, and **APPLY** while
applications are accepted — otherwise a disabled button stating why (RECRUITMENT
CLOSED, TEAMS SET, LIVE, …). The card is edited in place at every relevant change.

## Staff control panel (`/trial manage`)

Facts: state, clock, participants by status and cap, teams (members, channel,
latest version, briefed), progress (submitted / evaluated), results, assignment seed,
scheduled start, cancellation reason. Only the controls valid for the current state
and the viewer's capabilities are shown; core re-checks every transition, the
capability and conflict of interest.

| State                 | Controls (`canManageTrials`)                                                                             | `canEvaluateTrials` only |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| draft                 | OPEN RECRUITMENT · CANCEL TRIAL                                                                          | —                        |
| recruiting            | SELECT — RANDOM (modal: how many, seed) · SELECT — MANUAL (multi-select) · ASSIGN TEAMS (modal) · CANCEL | —                        |
| teams set             | START · REASSIGN TEAMS · RE-SYNC CHANNELS · CANCEL                                                       | —                        |
| live                  | CLOSE SUBMISSIONS · EXTEND DEADLINE (modal: minutes, reason) · RE-SYNC CHANNELS · CANCEL                 | —                        |
| evaluating            | EVALUATE · PUBLISH RESULTS · CANCEL                                                                      | EVALUATE                 |
| completed / cancelled | — (REFRESH, DASHBOARD)                                                                                   | —                        |

- **Confirmations.** OPEN, START, CLOSE, RE-SYNC, PUBLISH and CANCEL first show the
  consequence with CONFIRM / BACK. PUBLISH previews the tally; when submitted work was
  never scored it says so and the button becomes **PUBLISH — MARK INCOMPLETE** (never
  a fail). CANCEL then asks for a reason (modal).
- **ASSIGN TEAMS** modal: strategy select (BALANCED spreads primary domains · RANDOM),
  team size, optional seed. The result lists every team with its lead and the seed
  (reproducible). `assignTeams` reports the scheduled start: _scheduled_ → "starts
  automatically <t:…:R>"; **passed** → "The scheduled start has passed. Start it by
  hand now" with START on the panel; none → "press START when the teams are ready".
- **EVALUATE** (quick evaluation): a team select (latest version, LATE flag, your
  existing score), then a modal with one 0–10 field per criterion (prefilled with your
  earlier scores) and notes. Only for rubrics with **≤ 4 criteria** (a Discord modal
  holds five fields); larger rubrics get a link to the dashboard's Evaluation tab.

## Buttons, selects and modals

| Custom id                                                                        | Surface                          | Handler (as the clicking user)                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `trials:apply:<trialId>` (→ modal `trials:apply:<trialId>`)                      | APPLY (card, list)               | Statement modal → `applyToTrial`.                                                                                                    |
| `trials:view:<trialId>`                                                          | VIEW / TRIAL                     | `getTrialForParticipant`.                                                                                                            |
| `trials:pick:<purpose>`                                                          | trial pickers                    | view · apply · submit · withdraw · manage the picked trial.                                                                          |
| `trials:withdraw:<id>` → `trials:withdraw-yes:<id>`                              | WITHDRAW → CONFIRM WITHDRAWAL    | `withdraw`.                                                                                                                          |
| `trials:submit:<trialId>` (→ modal)                                              | SUBMIT (/team, brief post, view) | Prefilled modal → `submit`.                                                                                                          |
| `trials:status` · `trials:team`                                                  | shortcuts                        | `myTrials`.                                                                                                                          |
| `trials:panel:<id>`                                                              | REFRESH / BACK / CONTROL PANEL   | `getTrialForStaff`.                                                                                                                  |
| `trials:ask:<op>:<id>` → `trials:run:<op>:<id>`                                  | confirmed operations             | `openRecruitment` · `startTrial` · `closeSubmissions` · `reprovisionTeams` · `publishResults` (`publish-incomplete` = acknowledged). |
| `trials:cancel:<id>` (→ modal)                                                   | CANCEL WITH REASON               | `cancelTrial`.                                                                                                                       |
| `trials:sel-random:<id>` (→ modal)                                               | SELECT — RANDOM                  | `selectParticipants({ mode: 'random', count, seed })`.                                                                               |
| `trials:sel-manual:<id>` → `trials:sel-pick:<id>`                                | SELECT — MANUAL → multi-select   | `selectParticipants({ mode: 'manual' })` (replaces the selection).                                                                   |
| `trials:assign:<id>` (→ modal)                                                   | ASSIGN / REASSIGN TEAMS          | `assignTeams`.                                                                                                                       |
| `trials:extend:<id>` (→ modal)                                                   | EXTEND DEADLINE                  | `extendDeadline`.                                                                                                                    |
| `trials:eval:<id>` → `trials:eval-team:<id>` → modal `trials:eval:<id>:<teamId>` | EVALUATE                         | `evaluate` (team target).                                                                                                            |

Custom ids route; they never authorize. A non-UUID or unknown action answers
**EXPIRED — This control is no longer active.**; every handler calls core as the
clicking user, so a member pressing a forged staff control gets ACCESS RESTRICTED
(and the denial is audited), a stakeholding staff member gets the conflict-of-interest
refusal, and another member's resources answer NOT FOUND.

## Job handlers (`discord.trials.*`)

All handlers parse the payload with the core schema, load current state through the
spec loader (system actor), use only the `DiscordGateway` port, send with
`allowedMentions: { parse: [] }` and `userText()`, map permanent Discord failures to
`PermanentJobError`, report through the callback and then run any job the callback
enqueued.

| Job                        | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Discord permissions                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `discord.trials.announce`  | Posts or edits the recruitment card; a deleted card is posted anew → `markAnnouncementPosted`. Skips without an announcements channel.                                                                                                                                                                                                                                                                                                                       | View Channel, Send Messages, Embed Links, Read Message History (announcements)        |
| `discord.trials.provision` | Creates / re-syncs `trial-0042-unit-alpha` under `settings.channels.trialsCategory`: @everyone deny View; members View/Send/History/Attach/Embed/React; evaluator roles View/History/Send; stakeholding staff deny View; the bot keeps View/Send/History/Embed. Optional team role holding exactly the roster → `markTeamProvisioned`; a channel created for a team reshuffled away is deleted. Missing category → dead-letter (configure it, then RE-SYNC). | Manage Channels, View Channel (category); Add Reactions; Manage Roles with team roles |
| `discord.trials.brief`     | Posts the brief (split across embeds), the rubric with weights and the deadline in the team channel, with a SUBMIT button → `markTeamBriefed`. Waits (retry) while the channel is missing.                                                                                                                                                                                                                                                                   | View Channel, Send Messages, Embed Links                                              |
| `discord.trials.warning`   | Deadline warning with the time left and `<t:…:R>`.                                                                                                                                                                                                                                                                                                                                                                                                           | View Channel, Send Messages                                                           |
| `discord.trials.archive`   | Members become read-only (deny Send/React), the channel is renamed, the team role deleted, a closing post added → `markTeamsArchived`.                                                                                                                                                                                                                                                                                                                       | Manage Channels; Manage Roles with team roles                                         |
| `discord.trials.teardown`  | Deletes the channel and role of a team removed by a reshuffle (unknown = done).                                                                                                                                                                                                                                                                                                                                                                              | Manage Channels; Manage Roles with team roles                                         |

Staff who compete in a trial must not hold Administrator: it bypasses overwrites.

## Dashboard (`/trials`, `canManageTrials` in the nav)

| Page                                  | Who                                                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/trials`                             | trial staff                                        | Readouts (live, recruiting, evaluating, drafts), state tabs with counts, table with state, format and the live clock. Empty and filtered-empty states.                                                                                                                                                                                                                                                                                                                                                           |
| `/trials/new`                         | `canManageTrials`                                  | Start from a template (fills everything; the trial keeps a snapshot) or custom: title, category, public summary, sealed brief, **rubric editor** (criteria, relative weights with live shares, keys, reorder), evidence facets (the first is primary), duration, team size, cap, recruitment close and scheduled start in the viewer's time zone. The adversarial switch appears only with `canManageAdversarial` and the global switch on, and is disabled for templates that do not allow it. Creates a draft. |
| `/trials/templates` (`/new`, `/[id]`) | `canManageTrials`                                  | Template list, **Install starters** (idempotent; never overwrites edits), create, edit (key immutable), deactivate / reactivate with confirmation. `allowsAdversarial` is shown and editable only with `canManageAdversarial`.                                                                                                                                                                                                                                                                                   |
| `/trials/[id]`                        | `canManageTrials` or `canEvaluateTrials`, no stake | Header with state, category, format, summary and the countdown that matters now. Tabs below. A stakeholder sees a calm refusal with the reason; members see ACCESS RESTRICTED.                                                                                                                                                                                                                                                                                                                                   |
| `/trials/[id]/edit`                   | `canManageTrials`                                  | Edit content in draft / recruiting / teams set (warned: editing the brief or rubric bars you from competing). Locked afterwards.                                                                                                                                                                                                                                                                                                                                                                                 |

Tabs of `/trials/[id]`:

- **Overview** — the state machine rail; started / deadline / accepts-work-until; facts;
  the sealed brief and rubric; **Next step** controls by state, each behind a
  confirmation that states the consequence (OPEN RECRUITMENT with optional close
  time, START, CLOSE SUBMISSIONS, EXTEND DEADLINE with minutes and reason, RE-SYNC
  CHANNELS, CANCEL TRIAL with reason); Discord presence (card, channels provisioned).
- **Participants** — applicants with status, team, lead, statement, primary domain.
  While recruiting: **Random draw** (count, seed) and a checkbox selection that
  replaces the current one.
- **Teams** — **preview** a seeded assignment (strategy, size, seed; ineligible members
  named; each member's primary domain shown), then **Assign these teams** commits
  exactly the previewed seed. Team cards: roster, lead, channel state (pending, ready,
  briefed, archived) with an Open in Discord link, latest version.
- **Submissions** — every version per team, newest first, late flag, safe external
  links only (http(s), `rel="noopener noreferrer nofollow"`).
- **Evaluation** — evaluator rules (no stakeholder evaluates, nobody scores themselves,
  late work judged not penalised, missing work is INCOMPLETE never FAIL); per team a
  score grid of every evaluation (team and individual) with per-criterion scores,
  weights and weighted totals; **Score** dialog (team or one member, 0–10 per
  criterion, live weighted preview, notes) while evaluating.
- **Results** — live preview while evaluating (NOT YET SCORED warning; PUBLISH with an
  explicit "publish anyway, marking them incomplete" acknowledgement), then the
  published record sorted by outcome. **Apply** per passing member (`canModifyRanks`,
  never yourself): a confirmation with the rank (the recommendation or lower) and an
  optional note. Never automatic; applies once.
- **Adversarial** — only with `canManageAdversarial`; see [adversarial.md](./adversarial.md).

Every mutation is a Server Action through `runAction` (same-origin check, live
session, error reference) calling the core service; the page never decides a rule.

## Tests

- Bot: `cd apps/bot && npx vitest run src/features/trials src/features/adversarial --maxWorkers=2`
  (member flows, staff flows, job handlers, adversarial surface, leak tests).
- Dashboard e2e (own database, e.g. `jave_e2e_trials`):
  `E2E_DATABASE_URL=postgres://jave:jave@localhost:5432/jave_e2e_trials E2E_PORT=3141 npx playwright test e2e/trials.spec.ts e2e/trials-visual.spec.ts`
  after `next build`. Fixtures: `e2e/seed-trials.ts` (TEST DATA ONLY).
  `JAVE_SCREENSHOTS=1` with the visual spec alone refreshes `docs/screenshots/trials-*.png`.
