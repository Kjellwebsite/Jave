# Moderation commands

Discord surface of the moderation domain: `apps/bot/src/features/moderation`.
Domain rules live in `@jave/core` (`docs/modules/moderation.md`); every
handler below calls those services **as the user who clicked or typed**, so
capability, hierarchy ("only members ranked strictly below you") and
self-action checks are enforced in one place and audited.

All replies are ephemeral (only the invoking user sees them). The only
channel posts are the security alert card and the raid-mode notice, both in
staff channels. User-provided text (reasons, names, excerpts) is escaped with
`userText()` and no message pings anyone (`allowedMentions: { parse: [] }`).

## Who may use what

| Surface                                     | Capability                   | Default roles                        |
| ------------------------------------------- | ---------------------------- | ------------------------------------ |
| `/mod warn`, `timeout`, `untimeout`, `note` | `canModerate`                | moderator, operations, core, founder |
| `/mod kick`                                 | `canKickMembers`             | moderator and above                  |
| `/mod ban`, `/mod unban`                    | `canBanMembers`              | core, founder                        |
| `/mod quarantine`, `/mod release`           | `canQuarantine`              | moderator and above                  |
| `/mod case`, `/mod history`                 | `canModerate`                | moderator and above                  |
| Revoke a case                               | the case action's capability | as above                             |
| **Moderation history** (user menu)          | `canModerate`                | moderator and above                  |
| **Quarantine** (user menu)                  | `canQuarantine`              | moderator and above                  |
| **Delete & warn** (message menu)            | `canModerate`                | moderator and above                  |
| **Report message** (message menu)           | any member in good standing  | everyone except quarantined/banned   |
| Alert card ACKNOWLEDGE / DISMISS            | `canViewSecurityEvents`      | moderator and above                  |
| Alert card QUARANTINE                       | `canQuarantine`              | moderator and above                  |
| `/raidmode on`, `off`, `status`             | `canManageSecurity`          | core, founder                        |

`/mod` is gated on `canModerate`; each subcommand, select option and form is
additionally checked for its own capability **before** a form or confirmation
is shown ("ACCESS RESTRICTED — …"), and again by the service when it runs.
Nobody acts on themselves or on staff at or above their rank; records about
such people read as not found. Autocomplete answers non-staff with an empty
list without touching the services.

## `/mod` — cases

Every action is recorded as a case (`CASE-0042`) and applied in Discord by the
`discord.moderation.apply` job within seconds. The result card shows the case
reference, reason, duration and a **Member history** button.

| Subcommand   | Options                                                                 | Flow                                                                                                                  |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `warn`       | `member`, `reason?`                                                     | Reason given → recorded. No reason → reason form. The member gets the warning by DM.                                  |
| `timeout`    | `member`, `duration?` (autocomplete), `reason?`                         | Both given → recorded. Otherwise a form with the reason and a duration select.                                        |
| `untimeout`  | `member`, `reason?`                                                     | Lifts the running timeout (reversal case).                                                                            |
| `kick`       | `member`, `reason?`                                                     | Form if no reason → **CONFIRM KICK / CANCEL** card → recorded; DM first, then kick.                                   |
| `ban`        | `member`, `delete_messages?` (keep / 24 h / 7 d), `reason?`             | Form (reason + message history select) if no reason → **CONFIRM BAN / CANCEL** → recorded; DM, then ban.              |
| `unban`      | `user` (autocomplete of live bans, or a pasted Discord ID), `reason?`   | Lifts the ban. Works for users who are not in the server.                                                             |
| `quarantine` | `member`, `duration?` (autocomplete; default until released), `reason?` | Adds the quarantine role and strips JAVE-managed roles (or times out when no quarantine role is set).                 |
| `release`    | `member`, `reason?`                                                     | Removes the quarantine role; a role sync restores managed roles.                                                      |
| `note`       | `member`, `reason?` (the note)                                          | Private staff note. Never shown to the member; nothing happens in Discord.                                            |
| `case`       | `case` (autocomplete: number or text)                                   | Case card: member, moderator, source, status, duration, **Discord sync state** and error; **REVOKE**.                 |
| `history`    | `member`                                                                | Record card: warnings, running timeout, quarantine/ban, last 10 cases; **Open a case…** and **Take action…** selects. |

Durations. Autocomplete offers presets and validates typed values
(`90m`, `1h30m`, `2d`); bare numbers are refused as ambiguous.

| Action     | Presets                                   | Range                              |
| ---------- | ----------------------------------------- | ---------------------------------- |
| timeout    | 10m · 1h · 1d · 7d · 28d                  | 1 minute – 28 days (Discord's cap) |
| quarantine | until released · 1h · 1d · 7d · 28d · 90d | 1 minute – 90 days, or open-ended  |

Reasons are 3–1000 characters. They are shown to the member in the DM notice
(except notes) and written to Discord's audit log (truncated to 512).

**Kick and ban confirmation.** The confirmation holds the action for 10
minutes in the bot process under a random token bound to the issuing
moderator. Only that moderator can confirm or cancel; a token is consumed on
first use, so a double click cannot act twice; after a bot restart pending
confirmations expire (run the command again). A refusal at confirm time (for
example the target was promoted meanwhile) replaces the card, so it cannot be
clicked again.

**History card.** _Open a case…_ lists up to 25 cases; _Take action…_ lists
only the actions the viewer holds, given the member's state (for example
**Release** instead of **Quarantine** while quarantined, only **Unban** and
**Note** while banned). Each choice opens the same reason form as the command.

**Case card.** **REVOKE** appears for non-reversal cases the viewer could have
issued and opens a form for the revocation reason. Revoking a case still in
force lifts it through a reversal case (applied in Discord); otherwise the
case is struck from the record only.

## Context menus

| Menu                   | Target  | Flow                                                                                                                                                                                                                       |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moderation history** | user    | The history card above.                                                                                                                                                                                                    |
| **Quarantine**         | user    | Reason + duration form → quarantine case.                                                                                                                                                                                  |
| **Report message**     | message | Files a confidential `manual_report` security event with a redacted, truncated excerpt (content, embed text, attachment names). Ephemeral "REPORT RECEIVED". One event per message; 5 reports per reporter per 10 minutes. |
| **Delete & warn**      | message | Reason form → a warning (authorizes the whole action), a staff note that keeps the excerpt as evidence, then the message is deleted. Nothing is deleted if the warning is refused.                                         |

Reporting your own message, a message outside JAVELIN, or reporting while
quarantined or banned is refused. The reply is identical whether or not the
message was already reported, so reports stay confidential.

## Security alert card

Posted by `discord.moderation.alert` in `settings.channels.securityAlerts` for
every security event (automod, join screening, member reports) — except
events about a staff member, which only founders and staff ranked above the
subject may read: those notify just those readers and get no card in the
shared channel.

```
JAVE SECURITY · CRITICAL
SECURITY EVENT SEC-0042 — FOREIGN INVITE
USER · RISK SCORE ▰▰▰▰▰▰▰▰▰▱ 92/100 · TRIGGER · EVIDENCE · ACTION · MODERATOR · TIMESTAMP
[ Acknowledge ] [ Dismiss ] [ Quarantine ]
```

| Button          | Does                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Acknowledge** | `open → acknowledged` (shown while open).                                                        |
| **Dismiss**     | closes the event with no action.                                                                 |
| **Quarantine**  | opens the quarantine form prefilled with the event reference; the case marks the event actioned. |

The card is re-rendered from current state after every review or action and
loses its buttons once the event is closed. Two moderators clicking at once:
the second gets "Someone else reviewed this event just now."

## `/raidmode`

| Subcommand     | Flow                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `on [reason]`  | Form if no reason. Every new join is quarantined until switched off; staff alerted; notice posted.      |
| `off [reason]` | Form if no reason. New joins are no longer held; members already held stay quarantined until released.  |
| `status`       | Raid mode, join-burst threshold, auto raid mode, new-account age, suspicious-join holds, automod state. |

Thresholds are changed in the dashboard (Settings → Security / Moderation).

## Automatic protection (gateway listeners)

- **Automod** (`onMessage`). Every guild message from a human is checked by the
  pure engine against a per-process window of the author's recent messages
  (≤ 200 per author, ≤ 5 000 authors, one duplicate window). Clean messages never
  touch the database. Anything flagged goes to `screenMessage`, which resolves the
  author's **JAVE** roles (exemptions come from `settings.moderation.exemptRoles`,
  never Discord roles), account age, raid mode and this server's invite codes,
  then records the security event, deletes the message
  (`discord.moderation.delete_messages`) and times out or quarantines per the risk
  ladder. Bots, DMs and other guilds are ignored; content is capped at 4 000
  characters and mention counts are clamped.
- **Join screening** (`onMemberJoin`). `screenJoin` re-applies a live ban or
  quarantine on rejoin, detects join bursts from the recorded joins (switching
  raid mode on when `autoRaidMode`), records suspicious accounts, and quarantines
  new joins during raid mode (and suspicious ones when
  `quarantineSuspiciousJoins`). Staff are never held automatically.

## Discord jobs

| Job                                  | Handler                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discord.moderation.apply`           | Skips cases that ended while queued (`getCaseForSync`); DM notice (first attempt only), then timeout / kick / ban / unban / quarantine role add + managed-role strip / release; reports through `markCaseSynced`. |
| `discord.moderation.alert`           | Posts or edits the alert card; records the card with `markSecurityAlertPosted`; a retried post edits instead of posting twice.                                                                                    |
| `discord.moderation.delete_messages` | Bulk delete for messages younger than 14 days, single deletes otherwise; "Unknown Message" counts as deleted.                                                                                                     |
| `discord.moderation.lockdown`        | Posts one RAID MODE — ON/OFF notice for the _current_ raid mode (stale flips post nothing).                                                                                                                       |

Failure handling: missing permissions, hierarchy and unknown channels are
permanent — the case is marked `failed` with Discord's message, the moderator
(or, for automated cases, moderators once per cause per hour) is notified, and
the job dead-letters so it shows in queue health. A member who already left or
closed DMs is recorded as a routine failure and the job completes. Transient
errors retry with backoff and report `failed` on the last attempt.

## Custom ids

Namespace `moderation`. Ids route; they never authorize — every handler
re-checks the clicking user through core, and arguments are shape-validated
(UUID, snowflake, token) before use. Anything else answers "EXPIRED".

| Id                                              | Control                            |
| ----------------------------------------------- | ---------------------------------- |
| `moderation:sec-ack:<eventId>`                  | Alert card ACKNOWLEDGE             |
| `moderation:sec-dismiss:<eventId>`              | Alert card DISMISS                 |
| `moderation:sec-q:<eventId>`                    | Alert card QUARANTINE (opens form) |
| `moderation:sec-q-submit:<eventId>`             | Quarantine form from an alert      |
| `moderation:act:<discordId>`                    | History "Take action…" select      |
| `moderation:act-submit:<action>:<discordId>`    | Reason form for an action          |
| `moderation:case-open:<discordId>`              | History "Open a case…" select      |
| `moderation:case-revoke:<caseId>`               | Case card REVOKE (opens form)      |
| `moderation:revoke-submit:<caseId>`             | Revocation form                    |
| `moderation:history:<discordId>`                | MEMBER HISTORY button              |
| `moderation:confirm:<token>` / `cancel:<token>` | Kick / ban confirmation            |
| `moderation:dw-submit:<token>`                  | Delete & warn form                 |
| `moderation:raid-submit:<on\|off>`              | Raid mode reason form              |

## Discord permissions

Grant the bot's role exactly these (never Administrator):

| Permission                               | Used for                                                    |
| ---------------------------------------- | ----------------------------------------------------------- |
| Moderate Members                         | timeouts, untimeouts, quarantine fallback                   |
| Kick Members                             | kicks                                                       |
| Ban Members                              | bans (with message deletion), unbans                        |
| Manage Roles                             | quarantine role; stripping and restoring JAVE-managed roles |
| Manage Messages                          | automod deletions, Delete & warn                            |
| View Channel, Send Messages, Embed Links | alert cards and raid notices in the staff channels          |

The bot's highest role must sit above the quarantine role and every
JAVE-managed role; Discord refuses to act on the server owner or on members at
or above the bot's role — such cases show as `failed` with the reason in
`/mod case` and on the dashboard.

## Configuration

| Setting                      | Effect                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `roles.quarantineRoleId`     | Indefinite quarantines. Unset: quarantines fall back to timeouts (≤ 28 days). |
| `channels.securityAlerts`    | Alert cards and raid notices. Unset: no cards (events still notify staff).    |
| `channels.staffAlerts`       | Raid notices when `securityAlerts` is unset.                                  |
| `moderation.*`, `security.*` | Automod thresholds, exempt roles, join screening, auto raid mode.             |

## Dashboard

`/moderation` (canModerate): **Cases** (filters, case detail with Discord sync
state and revoke), **Security events** (risk meters, trigger, evidence excerpt,
review), **Member lookup** (record by Discord ID or name), **Raid mode** (switch
with canManageSecurity; screening and automod summary with links to settings).

## Limits

- The recent-message window and pending confirmations are per bot process:
  a restart forgets them (spam counting restarts; confirmations expire).
- Message edits are not screened (Discord's edit event carries no author).
- Raid mode does not pause Discord invites; the lockdown job posts a notice only.
