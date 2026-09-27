# Invites, referrals and analytics: Discord and dashboard

Feature `apps/bot/src/features/invites` · custom-id namespace `invites` ·
dashboard `apps/dashboard/app/(console)/analytics`, `…/referrals` and the
health strip on `/overview` · domain `@jave/core` `invites` and `analytics`
(see [docs/modules/invites.md](../modules/invites.md) and
[docs/modules/analytics.md](../modules/analytics.md)).

Replies are **ephemeral** unless noted. The only public card is the referral
leaderboard when its author asks for it (`share:`); it carries no controls.

Custom ids route; they never authorize. Every handler calls core as the
clicking user, so forged, stale or replayed ids fail closed: a member pressing
a staff control gets **ACCESS RESTRICTED** (audited as `access.denied`),
someone else's referral code reads like an unknown one (**NOT FOUND**, no
audit row that could confirm it exists), and an id that is not a UUID or a
known period is refused before anything is read.

## Slash command `/invites`

| Subcommand        | Who                                                   | Flow                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mine`            | every member                                          | Your funnel **INVITED → JOINED → RETAINED → VALID** (rates of joined), the exits (LEFT · INVALID · UNDER REVIEW — a count only, never which signal), active codes with claims, the five latest referrals (a staff-only invitee profile reads **Private member**), and whether you are listed on leaderboards. **Referral code** and **Leaderboard** buttons. The copy states the live lifecycle rules (`analytics.retentionDays`, `validRequiresOnboarding`). |
| `code`            | every member                                          | Your codes: **New code** (random, while fewer than 3 personal codes are active), **Deactivate a code** (select; past referrals keep their credit), **Enter a code** (only shown while you may still claim: no code used yet, in the server, joined within 30 days — core decides), **Funnel**.                                                                                                                                                                |
| `leaderboard`     | `canViewMembers` (every role but APPLICANT/SUPPORTER) | VALID, unflagged referrals only. Members who opted out (`showOnLeaderboards`), keep a staff-only profile, are not in good standing or were deleted never appear. Ties share a rank. Options: `period` (all time · 90 · 30 · 7 days, by validation date) and `share` (post the card publicly, without controls). The private card has a **Period** select that updates it in place.                                                                            |
| `campaign create` | `canManageCampaigns` (core, founder)                  | **NEW CAMPAIGN** modal: key (2–48 lowercase letters, digits, dashes; permanent), name (2–120), description (≤ 2000), start and end as `YYYY-MM-DD` UTC days (end inclusive; empty = open). Refused before the modal opens without the capability. Answers with the campaign card.                                                                                                                                                                             |
| `campaign list`   | `canViewAnalytics` (operations and above)             | Every campaign with its state (ACCEPTING · SCHEDULED · ENDED · INACTIVE) and funnel; **Open a campaign** select; **New campaign** for managers.                                                                                                                                                                                                                                                                                                               |
| `campaign attach` | `canManageCampaigns`                                  | **Campaign** select (active campaigns) → invite picker (live mirrored invites, most used first, 25 per page with **Previous / Next**). Only future joins through the invite credit the campaign; history is never rewritten.                                                                                                                                                                                                                                  |

Campaign card (from list, attach or create): state, window, funnel, attached
invites; managers get **Attach invite**, **Deactivate / Activate** (the target
state rides in the id, so a repeated press is idempotent), **Detach an invite**
(select, only invites attached to this campaign) and **All campaigns**.

## Context menu

| Menu                              | Who                                      | Flow                                                                                                                                                            |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User → Apps → **Referral Funnel** | yourself; anyone with `canViewAnalytics` | The member's funnel and exits. Staff also see **FAST LEAVES**; nobody else sees anomaly detail. Members targeting someone else get ACCESS RESTRICTED (audited). |

## Buttons, selects and modals

| Custom id                                        | Where                                          | Handler                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invites:mine`                                   | codes card **Funnel**                          | `getMyReferrals` → funnel card (in place).                                                                                                            |
| `invites:codes`                                  | funnel card **Referral code**                  | `getMyReferrals` → codes card (in place).                                                                                                             |
| `invites:code-new`                               | codes card **New code**                        | `createReferralCode` (core enforces the 3-code cap: CONFLICT past it).                                                                                |
| `invites:code-off` (select)                      | codes card **Deactivate a code**               | `deactivateReferralCode` (owner or `canManageCampaigns`).                                                                                             |
| `invites:claim` → modal `invites:claim`          | codes card **Enter a code**                    | `claimReferralCode`: once per person, never your own code, within 30 days of an observed join, not while quarantined or banned, 10 attempts per hour. |
| `invites:board:<period>`                         | funnel card **Leaderboard**                    | `getReferralLeaderboard` (in place).                                                                                                                  |
| `invites:board-period` (select)                  | private leaderboard **Period**                 | Same, for the chosen period. An unknown period answers EXPIRED.                                                                                       |
| `invites:camp-list`                              | campaign card **All campaigns**                | `listCampaigns` (in place).                                                                                                                           |
| `invites:camp-new` → modal `invites:camp-create` | campaign list **New campaign**                 | `authorize(canManageCampaigns)` before the modal; `createCampaign` on submit.                                                                         |
| `invites:camp-view` (select)                     | campaign list **Open a campaign**              | `getCampaign` + attached invites.                                                                                                                     |
| `invites:camp-view-id:<campaignId>`              | invite picker **Back**                         | Same, by id.                                                                                                                                          |
| `invites:camp-attach` (select)                   | `/invites campaign attach`                     | Invite picker, first page.                                                                                                                            |
| `invites:inv-page:<campaignId>:<offset>`         | campaign card **Attach invite**, picker paging | Invite picker page (`canManageCampaigns`; a negative or fractional offset is refused).                                                                |
| `invites:inv-pick:<campaignId>` (select)         | invite picker                                  | `attachInviteToCampaign`.                                                                                                                             |
| `invites:inv-detach:<campaignId>` (select)       | campaign card **Detach an invite**             | Checks the invite is attached to this campaign, then detaches it.                                                                                     |
| `invites:camp-active:<campaignId>:<0\|1>`        | campaign card **Deactivate / Activate**        | `updateCampaign({ active })`.                                                                                                                         |

Unknown actions answer **EXPIRED — This control is no longer active.** User
text on every card (campaign names and descriptions, member names) goes
through `userText()`; every bot message is sent with
`allowedMentions: { parse: [] }`.

Result copy is calm and exact: `CODE CREATED`, `REFERRAL RECORDED — Your join is
credited to Mara Voss. It counts once you stay and complete onboarding.` (the onboarding clause only when `analytics.validRequiresOnboarding` is on),
`CAMPAIGN CREATED — AUTUMN-TRIALS`, `INVITE ATTACHED — MARACORE`.

## Gateway listeners (join attribution)

The module defines **no `discord.*` job contracts**: the bot feeds core, it
never acts on Discord for referrals. One `InviteTracker` per process keeps the
last complete invite snapshot in memory.

| Event                           | Work                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                         | `gateway.listInvites()` → cache → `invites.syncInvites` (system actor).                                                                                                                                                   |
| `inviteCreate` / `inviteDelete` | The same re-sync. Bursts coalesce: while one re-sync waits in the queue, further events share it.                                                                                                                         |
| `guildMemberAdd` (non-bot)      | `before` = the cache (or `inviteUsageSnapshot`, the database mirror, when the cache is cold) · `after` = `listInvites()` · `detectUsedInvite(before, after)` · mirror `after` · `attributeJoin` with Discord's join time. |
| `guildMemberRemove`             | Nothing here: the core feature records the leave and the `member.left` event closes the referral.                                                                                                                         |

**The heuristic.** Discord does not say which invite a member used. The bot
compares use counts before and after the join and credits an invite only when
**exactly one** invite rose by **exactly one** use. The guild's vanity URL is
one more entry in the snapshot (`vanity: true`), so a join through it is
attributed with method `vanity` and no inviter. An invite that disappeared is
a candidate only when that use consumed its last `maxUses` (Discord deletes
it); the mirror keeps deleted codes so it is still credited. Anything else —
no change, two invites rising, a jump of two (a join the bot missed while
offline), a failed fetch — is recorded as **unknown**, never guessed.

**Race safety.** Re-syncs and joins run on one serial queue per process, so
each join's `before` is exactly the `after` of the operation before it. Two
members joining through different invites before either event is processed
both read as unknown (two invites changed) rather than one being credited
with the other's invite. `attributeJoin` is idempotent per invitee and join
time, so a replayed gateway event creates nothing. The mirror is written
before attribution, so an invite created seconds before the join is known
with its inviter even if its create event has not arrived yet.

**Failure modes.** A failed `listInvites()` (for example Missing Access) never
calls `syncInvites` — an empty list would mark every code deleted — and the
join is still recorded, as unknown. A failed mirror write is logged and never
blocks attribution.

## Discord access

- Permission **Manage Guild**: Discord returns guild invites and vanity usage
  only to it. `DiscordGateway` exposes nothing else that needs it
  (`listInvites()`), so the bot never exercises the rest of what the permission
  allows. Without it every join is `unknown`; codes, campaigns via codes, the
  lifecycle, leaderboard and funnels keep working.
- Intents: `GuildInvites` (create/delete events) and the privileged
  `GuildMembers` (joins and leaves).
- Every card is an interaction reply: no channel permission is needed for
  `/invites`, including the shared leaderboard.

## Dashboard

| Page                        | Who                                                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/analytics`                | `canViewAnalytics`; others see ACCESS RESTRICTED         | Range filter (7 · 30 · 90 days) above everything it scopes; eight health readouts; members (daily joins above / leaves below, D7 / D30 retention, onboarding, members present); pipeline (applications by stage with time to decision and acceptance rate, trials with pass rate, missions, projects, contributions); outcomes over time (small multiples); tickets (first response, SLA breach rate), moderation cases by action, security events by trigger; JAVELIN progress (outcomes to date, progression roles, VERIFIED / CLAIMED / UNKNOWN per domain and peak verified tier per domain). Every chart has a keyboard readout and a table twin; a day without a snapshot reads as missing, never as zero. When `analytics.enabled` is off: ANALYTICS DISABLED. |
| `/overview` health strip    | `canViewAnalytics` (others: not shown, no denial logged) | Net members, D30 retention, median decision time, SLA breach rate for the last 30 days, linking to `/analytics`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/referrals`                | `canViewAnalytics`                                       | Server-wide funnel with exits; tabs **Inviters** (per-inviter funnels, filter by campaign, anomaly signals as counts), **Campaigns**, **Review queue** (flagged referrals still reviewable, highest score first, with every flag explained), **Invites** (the mirror).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/referrals/campaigns/[id]` | `canViewAnalytics`                                       | Campaign funnel, attached invites, per-inviter funnels restricted to the campaign, settings. A malformed or unknown id is a 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Mutations (`canManageCampaigns`, core and above; core authorizes every one and
audits it; the UI hides controls the viewer cannot use):

| Control                                                                  | Action                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **New campaign** dialog                                                  | `createCampaign` — same fields and limits as the Discord modal.                       |
| Campaign **Settings** form                                               | `updateCampaign` — a date left as displayed keeps the stored instant.                 |
| **Activate / Deactivate** (confirm)                                      | `updateCampaign({ active })`.                                                         |
| **Attach an invite** / **Detach** (confirm)                              | `attachInviteToCampaign` — detach only for an invite attached to this campaign.       |
| **Delete campaign** (confirm)                                            | `deleteCampaign` — offered only when nothing was ever credited; otherwise deactivate. |
| Review queue **Clear flags** / **Invalidate** (confirm, reason required) | `reviewReferral` — never on a referral you are part of (refused and audited).         |
