# Moderation & security

`packages/core/src/moderation` · schema: `packages/database/src/schema/moderation.ts` ·
`import { moderation } from '@jave/core'`

Keeps JAVELIN's Discord server safe with the least privilege that works: a pure
automod engine, a risk model, join/raid screening, security events staff can
triage, and moderation cases (warn → ban) with strict hierarchy. Core never
calls Discord; every Discord effect is a `discord.*` job the bot executes and
reports back on.

## Layout

| File                         | Concern                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `engine/normalize.ts`        | Invisible characters, confusables, canonical text, lookalike skeletons |
| `engine/links.ts`, `tlds.ts` | Link and invite extraction, deobfuscation, domain patterns, lookalikes |
| `engine/risk.ts`             | Named weights, noisy-OR combination, context modifiers, action ladder  |
| `engine/automod.ts`          | `evaluateMessage` (pure)                                               |
| `engine/join.ts`             | `evaluateJoin` (pure)                                                  |
| `case-engine.ts`             | `executeCase`: the transactional core of every case                    |
| `cases.service.ts`           | warn/timeout/untimeout/kick/ban/unban/quarantine/release/note, revoke  |
| `cases.query.ts`             | `getCase`, `listCases`, `getCaseHistory`                               |
| `security.service.ts`        | `recordSecurityEvent`, `reviewSecurityEvent`, bot callbacks            |
| `security.query.ts`          | `getSecurityEvent`, `listSecurityEvents`, `getSecurityAlertCard`       |
| `automod.service.ts`         | `screenMessage`, `applyAutomodDecision`                                |
| `raid.service.ts`            | `setRaidMode`, `screenJoin`                                            |
| `sweeps.ts`                  | Recurring expiry sweep                                                 |
| `discord-jobs.ts`            | Discord job contracts (types, zod payloads, bot responsibilities)      |
| `alerts.ts`, `copy.ts`       | Alert card view model, user-facing copy                                |
| `targets.ts`                 | Target loading, hierarchy and overturn rules, denial auditing          |

## Automod engine (pure)

`evaluateMessage({ content, mentionCount, mentionsEveryone, authorRoles, accountAgeDays,
memberAgeMinutes, recent, now, settings, ownInviteCodes, exempt, raidMode, newAccountDays })`
→ `{ signals, modifiers, riskScore, action, trigger, exempt }`.

| Signal              | Weight (severe) | Fires when                                                                |
| ------------------- | --------------- | ------------------------------------------------------------------------- |
| `spam_rate`         | 60 (75)         | messages in `spam.windowSeconds` (incl. this one) > `spam.maxMessages`    |
| `duplicate_content` | 40 (55)         | same normalized text ≥ `spam.duplicateThreshold` times in 6 × window      |
| `mention_spam`      | 55 (75)         | mentions > `maxMentions`                                                  |
| `everyone_mention`  | 35              | `@everyone` / `@here` attempt (text or Discord flag)                      |
| `blocked_link`      | 50              | host matches `links.denylist` (subdomains included)                       |
| `unlisted_link`     | 30              | allowlist mode, host not allowlisted and not first-party Discord          |
| `lookalike_domain`  | 80              | host imitates Discord/Steam/GitHub or an allowlisted domain               |
| `foreign_invite`    | 45              | Discord invite whose code is not one of this server's                     |
| `obfuscated_link`   | 25              | a flagged link/invite was disguised (hxxp, `[.]`, zero-width, fullwidth…) |

"Severe" applies at twice the limit. Normalization folds case, width
(NFKC/NFKD), diacritics, zero-width/bidi/tag characters and basic
Cyrillic/Greek lookalikes. Link extraction handles scheme links, bare domains
(TLD-aware, so `index.ts` and `readme.md` are prose), defanging, ideographic
dots, userinfo tricks (`https://discord.com@evil.com` → `evil.com`) and IDN
hosts. Invites are detected across `discord.gg/`, `discord.gg/invite/`,
`discord.com/invite/`, `discordapp.com/invite/` (incl. `www.`/`ptb.`/`canary.`)
and `dsc.gg/`, also with spaces around dots/slashes. Own codes compare exactly
(Discord codes are case-sensitive).

Domain patterns: a **denylist** entry always covers subdomains (`evil.com`
blocks `x.evil.com`); an **allowlist** entry is exact (plus `www.`) unless
written `*.example.com`. Link mode `off` disables link rules (invites are
governed by `blockForeignInvites`). Exempt roles (`settings.moderation.exemptRoles`)
and the caller's `exempt` flag skip evaluation entirely.

### Risk model

`riskScore = min(100, round(noisyOR(weights) × min(1.6, Π modifiers)))` where
`noisyOR = 100·(1 − Π(1 − wᵢ/100))` — evidence accumulates but saturates
below 100. Modifiers only amplify existing violations: account < 1 day ×1.35,
account younger than `security.suspiciousAccountAgeDays` ×1.2, joined < 30 min
×1.15, raid mode ×1.2.

Action ladder: any violation → `delete`; risk ≥ 60 → `timeout`
(`settings.moderation.spamTimeoutSeconds`); risk ≥
`settings.moderation.quarantineRiskScore` → `quarantine`. Examples: a foreign
invite deletes (45); the same from a day-old account times out (61); a
lookalike-domain invite quarantines (92); the classic raid-bot message
(`@everyone` + mentions + invite, new account) scores 100.

## Join screening (pure)

`evaluateJoin({ accountAgeDays, hasAvatar, username, displayName, recentJoins, now, settings })`
→ `{ suspicious, raidDetected, riskScore, signals, joinsInWindow }`. Signals:
`very_new_account` 50, `new_account` 30, `no_avatar` 10, `username_link` 40,
`impersonation_name` 25 (admin/mod/staff/support/official/founder/jave/javelin/
discord/system on the lookalike skeleton), `generated_name` 10, `join_burst` 35.
`suspicious` = account younger than `suspiciousAccountAgeDays` or risk ≥ 40.
`raidDetected` = joins in `(now − joinBurstWindowSeconds, now]` ≥ `joinBurstCount`.

## State machines

**Security event**: `open → acknowledged | dismissed | actioned`,
`acknowledged → dismissed | actioned`; `dismissed`/`actioned` are terminal.
Acting on an event through a case (`securityEventId`) marks it `actioned`.
Reviews use optimistic concurrency (a concurrent review gets `ConflictError`).

**Case**: every action is an append-only case (`CASE-0042`). Timeouts,
quarantines and bans are _live_ until they end (`ended_reason`):
`expired` (sweep / Discord), `lifted` (untimeout/release/unban), `superseded`
(a new timeout, or a ban ending a quarantine/timeout), `revoked`. At most one
live case per user and action (partial unique index). Every transaction that
changes a user's cases first takes a row lock on that user (`lockTarget`), so
concurrent actions (ban vs quarantine, sweep vs manual release, revoke vs
release) serialize and see each other's live cases. Reversal cases
(`untimeout`, `release`, `unban`) carry `reverts_case_id`. `revokeCase` strikes
a case (appeal granted, issued in error); if it is still in force it is lifted
through a reversal case. Reversals themselves cannot be revoked.

**Discord sync** (`discord_sync`): `pending → applied | failed`, `failed → applied`;
`applied` is final; notes (and actions on members not in the server) are
`not_required`. A quarantine without `settings.roles.quarantineRoleId` is
still enforced: the apply payload carries `quarantineFallback: 'timeout'` and
the bot times the member out (capped at Discord's 28 days); release lifts it.
Configure a quarantine role for indefinite quarantines — `/jave setup` flags it.

Ending a case (lift, supersede, revoke) cancels its queued apply job, and the
bot must call `getCaseForSync(caseId)` before acting and skip cases with
`apply: false`. If an apply is still reported after its case ended (it was
mid-flight), `markCaseSynced` audits `moderation.case_applied_after_end` and
re-sends the reversal that ended it, so Discord converges on JAVE's state.

Sync failures on automated cases notify moderators once per failure cause per
hour (`mod-sync-failed:<cause>:<hour>`), never once per case — a raid cannot
bury staff in DMs. Failures on manual cases go to the issuing moderator.

**Member standing** (owned here): quarantine → `quarantined`; release →
`good`; ban → `banned`; unban → `good`. Timeouts do not change standing.
Quarantined and banned members hold no capabilities.

## Capabilities and rules

**Superseding is overturning.** A new timeout ends a running timeout; a ban
ends a live quarantine and timeout. Ending a case this way is subject to the
same rule as lifting it: staff cannot supersede a case issued by someone who
outranks them (checked before the action with a durable `access.denied`
audit, and again inside the transaction under the target lock). Equal- and
higher-ranked staff may replace each other's decisions.

**Records about staff.** Case and security-event reads hide records whose
subject is the caller or ranks at or above the caller (founders see all but
their own). Such records read as not found — including who reported them.

| Action                         | Capability                                                   |
| ------------------------------ | ------------------------------------------------------------ |
| warn, timeout, untimeout, note | `canModerate`                                                |
| kick                           | `canKickMembers`                                             |
| ban, unban                     | `canBanMembers`                                              |
| quarantine, release            | `canQuarantine`                                              |
| revoke a case                  | the capability of the case's action (baseline `canModerate`) |
| case lists / history           | `canModerate`                                                |
| view / triage security events  | `canViewSecurityEvents`                                      |
| raid mode                      | `canManageSecurity`                                          |

- Nobody acts on themselves; a user acts only on members ranked strictly
  below their highest role. Founders are therefore only actionable
  out-of-band (by the Discord server owner) — deliberate.
- Automated actors (system, integrations) never take punitive action
  (warn/timeout/kick/ban/quarantine) against staff; automod additionally
  never actions `exemptRoles` — those events are recorded as `flagged`. The
  case engine re-checks this itself, so a caller that forgets cannot bypass it.
- Lifting or revoking a case issued by higher-ranked staff is denied.
- You cannot revoke a case about yourself or about a member now ranked at or
  above you (e.g. promoted since), or review a security event about yourself
  or about staff at/above your rank.
- Staff and integrations file reports only (`none`/`flagged`), staff only with
  `manual_report`; their dedupe keys are namespaced so they can never suppress
  automod detections. `discordUser` profiles (which upsert users) are
  system-only.
- Bot callbacks (`markCaseSynced`, `markSecurityAlertPosted`) and gateway entry
  points (`screenMessage`, `applyAutomodDecision`, `screenJoin`) are system-only.
- Every denial is audited durably as `access.denied`; authorization precedes
  lookups so unauthorized callers cannot probe for existence.
- The module index exports only authorized services. Internal helpers that
  skip authorization (`executeCase`, `createSecurityEvent`, `enqueueDiscordJob`,
  `load*View`) are not importable from `@jave/core`, so no surface can queue a
  raw `discord.moderation.apply` without a case (tested).

## Services

Cases: `warnMember`, `timeoutMember` (60 s – 28 days, `MAX_TIMEOUT_SECONDS`),
`untimeoutMember`, `kickMember`, `banMember` (`deleteMessageDays` 0–7),
`unbanMember`, `quarantineMember` (optional 60 s – 90 days), `releaseMember`,
`addModNote`, `revokeCase`, `markCaseSynced`, `getCase`, `listCases`,
`getCaseHistory`. Targets are `targetUserId` or `targetDiscordId` (the bot must
have synced the user). Optional `securityEventId` links the case to an event of
the same user; optional `source: 'ai_suggested'` for confirmed AI proposals.

Security: `recordSecurityEvent`, `reviewSecurityEvent`, `getSecurityEvent`,
`listSecurityEvents` (status/trigger/source/action/user/min risk/time filters,
pagination), `getSecurityAlertCard`, `markSecurityAlertPosted`.

Automod: `screenMessage` (one call per message: resolves roles, account age,
join time, own invite codes from `invite_codes`, then evaluates and applies;
messages from bot accounts (`author.isBot`) are exempt, since integrations
legitimately post links)
and `applyAutomodDecision` (security event + deletion + automod case with
`moderatorUserId = null`; idempotent per message ID; a message from an author
already timed out/quarantined only deletes).

Raid: `setRaidMode` and `screenJoin` (re-applies a live quarantine/ban on
rejoin; auto-enables raid mode on a burst when `autoRaidMode`; records
suspicious joins; while raid mode is on — or for suspicious joins with
`quarantineSuspiciousJoins` — new non-staff joins are quarantined).

## Events (`events/catalog.ts`)

`moderation.case_created`, `moderation.case_revoked` (new),
`security.event_raised`, `security.event_reviewed` (new),
`security.raid_mode_changed` (new). All `external: false`;
`subjectMemberId` is set when the event is about a member.

## Audit actions

`moderation.case_created`, `moderation.case_revoked`,
`moderation.case_sync_failed` (result `failure`), `security.event_reported`,
`security.event_reviewed`, `security.raid_mode_changed`, plus `access.denied`.

## Notifications (`notifications/catalog.ts`)

- `moderation.notice` (new, member-facing, inbox only): WARNING ISSUED,
  TIMEOUT — 10M, REMOVED FROM JAVELIN, BANNED FROM JAVELIN, ACCESS RESTRICTED —
  QUARANTINE, and the lifted variants. The Discord DM is sent by the apply job
  (so it can precede a kick/ban) — never twice. Notes never notify.
- `moderation.sync_failed` (new, staff): DISCORD SYNC FAILED — CASE-0042, to the
  issuing moderator, or to all `canModerate` holders for automated cases.
- `security.alert` (existing): every security event notifies
  `canViewSecurityEvents` holders (subject and reporter excluded); `critical`
  with DM when risk ≥ `quarantineRiskScore`, otherwise inbox only. Joins during
  raid mode do not notify individually (the RAID MODE — ON alert covers them).

## Jobs

- `moderation.sweep_expired` — recurring every minute: closes timeouts Discord
  already lifted and releases expired quarantines (system `release` case,
  standing restored, Discord job to remove the role, member notified). Batch of
  100 per run; safe against concurrent manual releases (counted as `skipped`).
  Each release is its own transaction: an unexpected failure is logged and
  counted as `failed` without blocking the rest of the batch; if nothing in
  the batch could be released the job fails so the error is retried and
  visible in the queue.

## Discord job contracts (`discord-jobs.ts`)

All handlers must be idempotent, use `allowedMentions: { parse: [] }` and
escape user text (`userText()`). Permanent Discord errors (missing permission,
hierarchy, unknown member) complete the job and report `failed`; transient
ones retry.

| Job                                  | Bot must                                                                                                                                                                                                                                                                                                                                                                       | Callback                                                                    | Discord permission                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `discord.moderation.apply`           | By `action`: warn → DM `dmText` (closed DMs = failed); timeout → DM then `member.timeout(timeoutUntil)`; untimeout → `timeout(null)`; kick → DM then kick; ban → DM then ban with `deleteMessageSeconds`; unban → unban ("Unknown Ban" = applied); quarantine → DM, add `quarantineRoleId`, remove `managedRoleIds`; release → remove `quarantineRoleId`. Use `auditReason`.   | `markCaseSynced({ caseId, status, error })`                                 | Moderate Members; Kick Members; Ban Members; Manage Roles (quarantine role and managed roles below the bot's top role) |
| `discord.moderation.alert`           | `post`: render `getSecurityAlertCard` in `channelId` with ACKNOWLEDGE / DISMISS / QUARANTINE buttons while actionable (suggested IDs `mod:sec:ack:<id>`, `mod:sec:dismiss:<id>`, `mod:sec:quarantine:<id>`); `update`: edit `messageId` and drop the buttons once reviewed. Buttons call `reviewSecurityEvent` / `quarantineMember({ securityEventId })` as the clicking user. | `markSecurityAlertPosted({ securityEventId, channelId, messageId })` (post) | View Channel, Send Messages, Embed Links                                                                               |
| `discord.moderation.delete_messages` | Delete `messageIds` in `channelId` (bulk when > 1 and < 14 days old); "Unknown Message" = success.                                                                                                                                                                                                                                                                             | none                                                                        | Manage Messages                                                                                                        |
| `discord.moderation.lockdown`        | Optional. Converge to the _current_ `settings.security.raidMode`: post a notice in `noticeChannelId`; optionally pause invites.                                                                                                                                                                                                                                                | none                                                                        | Send Messages; Manage Server (optional)                                                                                |

Full list of Discord permissions moderation needs: **Moderate Members**
(timeouts), **Kick Members**, **Ban Members**, **Manage Roles** (quarantine
role; the bot's role must sit above it and every managed role), **Manage
Messages** (delete spam), **View Channel / Send Messages / Embed Links**
(alerts), **View Audit Log** (optional, correlate Discord-native actions),
**Manage Server** (optional, lockdown). Never Administrator. Discord also
refuses to act on the server owner or members at/above the bot's role — such
failures surface as `failed` sync with the moderator notified.

The quarantine role must deny View Channel everywhere except one
review channel. Because allow overwrites from other roles win in Discord, the
apply job strips JAVE-managed roles during quarantine and a
`discord.roles.sync` restores them on release.

## Bot integration (extension points)

- Message handler: keep a short per-author buffer (content + time, ≤ 200,
  ~60 s), call `screenMessage(systemCtx, { author, channelId, messageId, content,
mentionCount, mentionsEveryone, recent, extraInviteCodes })`, then
  `runJobsNow(ctx.effects.jobIds)`. Pass `exempt: true` for channels where
  links are expected.
- Join handler: `recordGuildJoin` then `screenJoin(systemCtx, { discordUser })`
  (order does not matter).
- Buttons/commands: call the case services with the clicking user's context.
- AI: confirmed proposals call the case services with `source: 'ai_suggested'`.

## Known limitations

- `apps/bot` role sync (`features/core/role-sync.ts`) only strips managed roles
  for `banned`; it should treat `quarantined` the same, or a role change / rejoin
  sync can re-add roles while quarantined. Owned by the bot team.
- Raid mode is written through `updateSettings`, which merges over a 15 s
  per-process settings cache; two processes changing _other_ security fields
  within that window can overwrite each other (settings-service limitation).
- Automod quarantines are indefinite until staff release them; raid-mode holds
  have no bulk release yet.
- Duplicate detection is exact on normalized text; randomized suffixes evade it
  (the rate limit still applies). Confusable folding is a curated subset, not
  the full Unicode confusables table.
- `restricted` standing is not set by moderation; a release restores `good`.
- Bans, kicks and timeouts applied natively in Discord (not through JAVE) are
  unknown to JAVE: `unbanMember` refuses a user JAVE does not consider banned.
  Mirroring Discord's `guildBanAdd`/`guildAuditLogEntryCreate` into cases is
  an extension point for the bot team (needs View Audit Log).
- Bot accounts are exempt from automod, so a compromised third-party bot is
  not screened; restrict bot permissions in Discord.
- Founders can only be actioned out-of-band (the rank rule is strict `<`,
  so founder-on-founder is denied). A compromised founder account must be
  handled by the Discord server owner.
- Revoking a warning does not send a "withdrawn" notice.
