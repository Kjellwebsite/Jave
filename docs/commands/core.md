# Core: Discord surface and development seed

Feature `apps/bot/src/features/core` · custom-id namespaces `onboard`, `profile`,
`settings`, `setup`, `jobs` · domain `@jave/core` (identity, settings, jobs) · development seed
`packages/core/src/seed` (`pnpm db:seed`).

Replies are **ephemeral** unless noted. The only public messages are the welcome card in
`channels.welcome` and a profile card someone chose to share. Custom ids route; they never
authorize: every handler calls core as the clicking user, so forged, stale or replayed ids fail
closed (**ACCESS RESTRICTED**, **INVALID INPUT** or **EXPIRED — This control is no longer
active.**). Every piece of user-provided text goes through `userText()` (markdown escaped,
mentions neutralized); every bot message is sent with `allowedMentions: { parse: [] }`.

## Slash commands

| Command                                | Who                                          | Flow                                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/help`                                | everyone                                     | Generated from the live command catalog, filtered by what the caller may use. **Open dashboard** link when `JAVE_PUBLIC_URL` is set.                                                                                                                      |
| `/start`                               | members                                      | **INITIALIZE JVLN PROFILE** modal: display name, headline, primary domain select, profile visibility select → `completeOnboarding`. Also reachable from the welcome card's **Begin**.                                                                     |
| `/profile [member] [share]`            | members (profile visibility applies)         | JVLN profile card. `share:true` posts it in the channel, except staff-only profiles, which stay ephemeral.                                                                                                                                                |
| `/rank view [member]`                  | members                                      | Capability breakdown per facet: VERIFIED, CLAIMED or UNKNOWN. No aggregate score.                                                                                                                                                                         |
| `/rank claim`                          | members                                      | `capability` and `rank` autocomplete (or CLEAR), optional evidence link → `claimRank`. Claims stay CLAIMED until verified.                                                                                                                                |
| `/rank history [member]`               | yourself; others with `canViewRankHistory`   | The 15 latest rank changes with track, source and actor.                                                                                                                                                                                                  |
| `/rank verify`                         | `canModifyRanks`                             | Member, capability, rank and a required reason → `setVerifiedRank`. Never your own rank.                                                                                                                                                                  |
| `/jave status`                         | everyone; details with `canViewSystemStatus` | Discord, database, queue, AI and webhook checks. Staff see details and, when jobs dead-lettered, a **Dead letters · N** button (below).                                                                                                                   |
| `/jave setup`                          | `canManageSettings`                          | The readiness checklist (below).                                                                                                                                                                                                                          |
| `/settings view`                       | `canViewSettings`                            | Summary of the key settings. Managers also get **Channels · Roles · Flags · Readiness**; everyone else reads "Read-only".                                                                                                                                 |
| `/settings channel [output] [channel]` | `canManageSettings`                          | Without options: the outputs list with an **output select**. With `output`: that output's editor. With both: maps it at once. Kind and access are checked against Discord first; missing channel permissions are saved with an **Action needed** warning. |
| `/settings role [role]`                | `canManageSettings`; staff roles: founders   | Without an option: the mapping with a **role select** (only the targets you may map). With `role` (a JAVE role or QUARANTINE): its editor with Discord's native **role picker** and **Clear**.                                                            |
| `/settings toggle [flag]`              | `canManageSettings`                          | Without an option: the flags with a **flag select**. With `flag`: switches it from its stored value (read fresh); sensitive flags ask for confirmation first.                                                                                             |

## Context menu

| Menu                           | Who     | Flow                                        |
| ------------------------------ | ------- | ------------------------------------------- |
| User → Apps → **JVLN Profile** | members | That member's profile card, always private. |

## `/jave setup` — readiness checklist

One ephemeral panel, four sections. Each line is ✓ ready, ▲ warning, ✕ blocking or — not
configured, with the fix on the line below it (`→ …`). The title reports the number of blocking
issues and warnings.

| Section            | Checks                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server permissions | Every permission of `REQUIRED_PERMISSIONS` (`apps/bot/src/discord/permissions.ts`) on the bot's member; ▲ when the bot holds Administrator (least privilege).                                                                                                                                                                                                                      |
| Role hierarchy     | Every mapped role (and the quarantine role) must sit strictly below the bot's highest role.                                                                                                                                                                                                                                                                                        |
| Role mapping       | Role sync on/off; mapped roles that no longer exist, are @everyone, are managed by an integration, grant Administrator (any target), or grant elevated permissions to non-staff (below); a quarantine role that is also a mapped role; how many JAVE roles are mapped and which stay inside JAVE; ▲ without a quarantine role (quarantine falls back to a 28-day Discord timeout). |
| Channels           | Per configured output: the channel exists, the bot can see it, it is the right kind, a **staff-only** output is not readable by @everyone or by the Discord roles of non-staff JAVE roles, and the bot holds what that output needs in it (permission overwrites applied). Unset recommended outputs are ▲, unset optional ones —.                                                 |

Buttons: **Channels**, **Roles**, **Flags** open the matching settings panels; **Re-check** re-runs
the check in place. **Re-sync roles** (shown while role sync is on and a role is mapped) queues a
`discord.roles.sync` for every present member through core `requestRoleResync`
(`canManageSettings`, audited `settings.roles_resync_requested`) — use it after fixing the role
hierarchy, so roles role sync withheld are applied. A Discord outage renders **SERVICE UNAVAILABLE — JAVE could not read the
server from Discord. Try again shortly.**, never a stack trace.

## `/settings` — outputs, roles and flags

Every change goes through core `updateSettings`: validated, written together with its audit entry
(`settings.updated`, field-level diff) and domain event, and merged over the stored value read
fresh inside the transaction, so a change made meanwhile from the dashboard is never undone by a
cached copy.

### Channel outputs (`settings.channels`)

| Output                                   | Key                                              | Accepts            | The bot needs there                                                                                               | Recommended |
| ---------------------------------------- | ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| Welcome                                  | `welcome`                                        | text, announcement | View Channel, Send Messages, Embed Links, Read Message History                                                    | yes         |
| Announcements                            | `announcements`                                  | text, announcement | same                                                                                                              | yes         |
| Applications review (staff-only)         | `applicationsReview`                             | text, announcement | same                                                                                                              | yes         |
| Verification queue (staff-only)          | `verificationQueue`                              | text, announcement | same                                                                                                              | yes         |
| Tickets                                  | `tickets`                                        | **text only**      | View Channel, Embed Links, Read Message History, Create Private Threads, Send Messages in Threads, Manage Threads | yes         |
| Ticket archive (staff-only)              | `ticketArchive`                                  | text, announcement | posting set + Attach Files                                                                                        | no          |
| Trials category                          | `trialsCategory`                                 | category           | View Channel, Manage Channels                                                                                     | yes         |
| Security alerts (staff-only)             | `securityAlerts`                                 | text, announcement | posting set                                                                                                       | yes         |
| Staff alerts (staff-only)                | `staffAlerts`                                    | text, announcement | posting set                                                                                                       | no          |
| Moderation log, Audit log (staff-only)   | `modLog`, `auditLog`                             | text, announcement | posting set                                                                                                       | no          |
| Missions, Events, Achievements, Research | `missions`, `events`, `achievements`, `research` | text, announcement | posting set                                                                                                       | no          |

Discord creates private threads only in plain text channels, so the tickets output refuses
announcement channels. The channel picker only offers the kinds an output accepts; a channel
outside the server answers **NOT FOUND**. A **staff-only** output (applicant answers, moderation
reasons, private ticket transcripts…) is refused in a channel that @everyone, or the Discord role
of a non-staff JAVE role, can view (their server permissions and the channel's overwrites
applied).

### Role mapping (`settings.roles`)

Targets: every JAVE role (FOUNDER … SUPPORTER) and QUARANTINE. JAVE is the source of truth;
mapped Discord roles follow it through `discord.roles.sync`. One Discord role may back several
JAVE roles (e.g. one "Staff" role for every staff tier).

Who may map what (core `mayMapRole`, enforced by `updateSettings` for the bot and the dashboard
alike): **staff mappings (FOUNDER, CORE, OPERATIONS, MODERATOR) are founder-only**, and anyone
else maps only roles strictly below their own highest role. A mapped role reaches every holder of
the JAVE role, so changing a mapping is as strong as granting the role. Core's refusal:
**Only a founder can map staff roles to Discord.**

Refused by the bot, which can inspect the Discord role:

- @everyone and roles managed by an integration (boosters, bots) — Discord never lets anyone assign them;
- a role that grants **Administrator**, for any target: JAVE never hands out Administrator;
- a Discord role with **elevated permissions** (Manage Server, Manage Roles, Manage Channels,
  Manage Webhooks, Manage Messages, Manage Threads, Manage Expressions, Kick, Ban, Moderate
  Members) behind a **non-staff** JAVE role (VERIFIED, TRIAL, APPLICANT, MEMBER, SUPPORTER) or
  QUARANTINE: JAVE hands the role to every holder, so that would be privilege escalation. Staff
  roles (mapped by founders only) may follow such roles;
- a role at or above the bot's highest role: Discord would refuse every change. Drag JAVE's role
  above it first;
- a quarantine role that is also a mapped role (core: quarantine strips every mapped role).

The dashboard cannot inspect Discord roles, so role sync re-checks at the moment it acts (below):
whatever path a mapping took, Administrator is never handed out and elevated roles reach members
only through a staff mapping.

A new mapping (or sync switched back on) re-syncs every present member in the background. A
**replaced or cleared** mapping also retires the old Discord role: JAVE removes it from every
member who holds it (`discord.roles.retire`), so a demoted member never keeps a role JAVE once
managed. The panel says so: "<@&Mods> is no longer managed. JAVE removes it from every member."
With role sync off nothing is removed.

### Flags (`/settings toggle`)

| Flag                                   | Sensitive (asks first) |
| -------------------------------------- | ---------------------- |
| `applications.open`                    |                        |
| `trials.enabled`                       |                        |
| `trials.adversarialEnabled`            | yes                    |
| `trials.createTeamRoles`               |                        |
| `tickets.enabled`                      |                        |
| `ai.enabled`                           |                        |
| `moderation.automodEnabled`            | yes                    |
| `moderation.blockForeignInvites`       |                        |
| `security.autoRaidMode`                | yes                    |
| `security.quarantineSuspiciousJoins`   | yes                    |
| `roles.syncToDiscord`                  | yes                    |
| `notifications.dmEnabled`              |                        |
| `notifications.announceAchievements`   |                        |
| `analytics.enabled`                    |                        |
| `integrations.githubAutoContributions` |                        |
| `integrations.sidusAutoSync`           |                        |

The flag select and the confirmation carry the target state, not a toggle: the option labelled
"Tickets → OFF" (value `tickets.enabled:off`) sets OFF, even if someone switched it on the
dashboard in the meantime, and answers **NO CHANGE** when it already holds; so does pressing
**Switch ON** twice (`settings:flagset:<flag>:on|off`). Raid mode is absent on purpose — it runs through
`/raidmode` (reason, alerts, lockdown). Development-only switches stay in the dashboard.

## Dead letters (`/jave status`)

**Dead letters · N** (staff with `canViewSystemStatus`, only when N > 0) lists the ten newest
dead-lettered jobs: id, type, attempts and the escaped error excerpt (payloads are never shown).
Settings managers (`canManageSettings`) also get a **Retry a job** select → core
`retryDeadJob` (audited `job.retried`); the job runs right after the interaction and re-reads
current state, so a retry never replays a stale decision. **Refresh** reloads the list.

## Buttons, selects and modals

| Custom id                                        | Where                                    | Handler                                                            |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `onboard:begin`                                  | welcome card **Begin**                   | Opens the onboarding modal.                                        |
| `onboard:submit` (modal)                         | INITIALIZE JVLN PROFILE                  | `completeOnboarding`.                                              |
| `profile:self`, `profile:facets:<memberId>`      | profile card                             | `getProfile` as the clicking user (visibility applies).            |
| `setup:recheck`                                  | readiness panel, settings panels         | Re-runs `/jave setup` (`canManageSettings`).                       |
| `setup:resync`                                   | readiness panel **Re-sync roles**        | `requestRoleResync` (`canManageSettings`), then re-runs the check. |
| `settings:panel:summary\|channels\|roles\|flags` | panel buttons                            | Opens that panel (all but the summary need `canManageSettings`).   |
| `settings:channel` (select)                      | outputs list                             | Opens an output's editor.                                          |
| `settings:chset:<output>` (channel select)       | output editor                            | Maps the chosen channel.                                           |
| `settings:chclear:<output>`                      | output editor **Clear**                  | Unsets the output.                                                 |
| `settings:role` (select)                         | role mapping list                        | Opens a target's editor (the actor must be allowed to map it).     |
| `settings:roleset:<target>` (role select)        | role editor                              | Maps the chosen role.                                              |
| `settings:roleclear:<target>`                    | role editor **Clear**                    | Removes the mapping (and retires the old role).                    |
| `settings:flag` (select, value `<flag>:on\|off`) | flags panel                              | Sets a plain flag to that state, or opens the confirmation.        |
| `settings:flagset:<flag>:on\|off`                | confirmation **Switch ON/OFF**           | Sets the flag to that state.                                       |
| `jobs:dead`                                      | `/jave status`, dead letters **Refresh** | `listJobs` (`canViewSystemStatus`).                                |
| `jobs:retry` (select)                            | dead letters                             | `retryDeadJob` (`canManageSettings`).                              |

A refusal after a component deferred its update (wrong channel kind, role not allowed, Discord
unavailable) arrives as its own ephemeral message; the panel stays usable.

## Jobs and gateway listeners

| Job / event             | Handler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `discord.roles.sync`    | Adds and removes only **mapped** roles to match the member's JAVE roles; unrelated roles and the quarantine role are never touched. While standing is **quarantined** or **banned** (or the member is deleted) every mapped role is stripped; release sets the standing back and the next sync restores them. Reads the mapping **fresh** (`getSettingsFresh`): the dashboard may have changed it, and queued this job, within the bot's 15-second settings cache. Before adding, it screens each role against Discord (`role-screen.ts`) and **withholds** (logged, no dead letter) a role that grants Administrator, an elevated role not reached through one of the member's staff mappings, an integration-managed role, or a role at or above the bot's highest role (apply it later with **Re-sync roles**). Idempotent; enqueued with `{ dedupeKey: roles-sync:<memberId>, rerunIfRunning: true }`. Other permanent Discord errors dead-letter. |
| `discord.roles.retire`  | `{ memberId, roleId }`: removes a Discord role a mapping change let go of from the member, unless it is mapped again (or is the quarantine role) by then, or role sync is off. Idempotent; `{ dedupeKey: roles-retire:<roleId>:<memberId>, rerunIfRunning: true }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `notifications.deliver` | Notification DMs. Closed DMs are recorded, never retried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| member join / leave     | `recordGuildJoin` (identity, join screening, role sync) and the welcome card in `channels.welcome`; `recordGuildLeave`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Quarantine itself (adding the quarantine role, or the timeout fallback) belongs to moderation's
`discord.moderation.apply` job; role sync and moderation agree on the result.

## Discord permissions

- **Members:** Use Application Commands. Everything here is ephemeral, so no channel permission is
  needed, except to read the welcome card.
- **The bot, server-wide:** exactly `REQUIRED_PERMISSIONS` — View Channel, Send Messages, Send
  Messages in Threads, Embed Links, Attach Files, Read Message History, Manage Roles, Manage
  Channels, Create Private Threads, Manage Threads, Manage Messages, Moderate Members, Kick
  Members, Ban Members, Manage Server (invites), Manage Events. Never Administrator.
- **Per channel:** the table above; `/jave setup` checks it with permission overwrites applied.
- **Role hierarchy:** JAVE's highest role above every mapped role and the quarantine role.
- **Introspection** (read-only `DiscordGateway` additions): `botMember()`,
  `botPermissionsIn(channelId, audienceRoleIds?)` (the bot's permissions there, whether
  @everyone can view it, and which of the given roles can), `listRoles()` (with each role's
  permissions).

## Development seed — `pnpm db:seed`

DEVELOPMENT DATA ONLY. Seeds an empty, migrated database with a coherent JAVELIN organization for
local development and demos:

```bash
pnpm db:migrate
pnpm db:seed            # refuses a database that already has members
pnpm db:seed -- --reset # local databases only: empties every JAVE table first
```

`DATABASE_URL` comes from the environment (or `.env`). The seed refuses under
`NODE_ENV=production`, against URLs whose host or database name contains `prod`, on a database
that already holds members (unless `--reset`), and `--reset` anywhere but a local host (loopback,
`*.localhost` or a single-label docker-compose host). Refusals never echo credentials.

**What it builds.** The module (`packages/core/src/seed`) replays about 150 days of history
through the real core services under a manual clock, draining the real job queue as time passes,
so audit entries, rank history, domain events, achievements and notifications are genuine
consequences. The organization's "now" is the current hour.

- 28 members: founder, core (2), operations (2), moderators (2), verified, trial, applicants,
  members and a supporter, plus a quarantined spammer, an account flagged by join screening and
  a brand-new arrival who has not onboarded; claimed and verified capabilities with rank
  history.
- Applications in every state (draft, submitted, review, interview, accepted, rejected,
  withdrawn) with reviews.
- A completed 48-Hour Ship (teams, versions, team and individual evaluations, a distinction, a
  fail, rank consequences and promotions), a live evidence sprint and a recruiting strategy trial.
- Missions (open, assigned, accepted, submitted, verified, a rejection and resubmission, closed, a
  draft); projects in every status with milestones, members and contributions.
- A past kickoff with check-ins, a five-team tournament played to a champion, upcoming events with
  RSVPs; tickets open, claimed, waiting and closed with messages and internal notes; moderation
  cases (one revoked) and security events (open, acknowledged, actioned); the starter achievements
  with awards; research items; skill verifications; read and unread notifications.

**Personas.** Discord IDs `100000000000000001`…`6` are the dashboard's dev-login personas
(founder, core, operations, moderator, verified, member) with the same usernames, so a dev login
(`JAVE_DEV_AUTH=true`) lands in the populated organization. The member persona holds a draft
application to finish.

**Deterministic.** A seeded RNG (`javelin`) drives every choice. Trial rosters are dealt from an
assignment seed searched for the story's teams, and evaluation scores vary around exact targets,
so every run produces the same people, rosters and outcomes (only database ids and the dates,
which follow the anchor, differ).

**Where it stands in for Discord or the database** (all labelled in the code):

- Bot-side jobs are completed by a stand-in (MOCK / DEVELOPMENT ONLY): moderation actions are
  marked applied through the bot's callback, notification DMs are recorded as skipped, posts are
  skipped (the seed maps no posting channels).
- Ticket threads and their messages use the bot's callbacks (`markThreadCreated`,
  `recordMessage`) with Discord-shaped ids of the fictional server; the ticket channels point at
  placeholder ids. Map real channels with `/settings channel` before running the bot against a
  real guild — `/jave setup` flags the placeholders.
- Timestamp alignment: a few columns are stamped by the database (`default now()`) or by drizzle
  (`$onUpdate`) instead of the service clock. After the story, those later than the anchor are
  moved back to the story time the row's own data implies, and anything left is clamped to the
  anchor. These updates and the `--reset` truncation are the seed's only raw writes.
- A few jobs stay scheduled after the anchor (reminders, deadlines, the recruiting trial's
  announcement): the bot runs them when their time comes.

The CLI lives in `packages/core/src/scripts/seed.ts` rather than `@jave/database`, because the
seed runs core services and the database package cannot depend on core. Tests:
`packages/core/src/seed/*.test.ts` (seeds PGlite, checks counts and invariants, refuses a second
run, resets and replays the same story).
