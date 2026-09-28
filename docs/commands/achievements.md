# Discord & dashboard: achievements

Feature `apps/bot/src/features/achievements` · custom-id namespace `achievements` ·
domain: `@jave/core` `achievements` (see [docs/modules/achievements.md](../modules/achievements.md)).

Achievements mark verified outcomes. The surfaces show them against the
catalog — unlocked, locked, hidden — and let staff award, revoke and verify.
There is no score anywhere: no totals, no points, no ranking of people.

## Slash commands and context menu

| Command                                             | Who                                     | What it does                                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/achievements view [member] [share]`               | anyone who may see the member's profile | **JVLN ACHIEVEMENTS** panel: `✓` verified unlocks, `◇` pending verification, `—` locked, `▸ HIDDEN` masked entries; rarity and share of active members. Pages of ten with PREVIOUS / NEXT. |
| Right-click a member → Apps → **JVLN Achievements** | same                                    | The same panel for that member.                                                                                                                                                            |
| `/achievements award member achievement reason`     | `canAwardAchievements` (OPERATIONS+)    | Manual award. `achievement` autocompletes the full catalog for staff (hidden ones flagged), nothing for members. Awards needing verification start as `◇` pending.                         |
| `/achievements revoke member achievement reason`    | `canAwardAchievements`                  | Revokes an active award. The member is notified and any public card is removed.                                                                                                            |

- Replies are ephemeral. `share: true` posts the panel in the channel **without controls**
  and never for a staff-only profile (it stays ephemeral).
- A hidden achievement the member unlocked is shown on their panel, as on their profile;
  everything else hidden stays masked for non-staff.
- Nobody awards, revokes or verifies their own achievements; the service refuses and audits it.

## Buttons, selects and modals

| Custom id                                         | Surface              | Handler                                                                                                  |
| ------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `achievements:page:<memberId>:<page>`             | PREVIOUS / NEXT      | Re-renders the panel in place; forged pages are clamped. Visibility is re-checked on every click.        |
| `achievements:award:<memberId>` (button → modal)  | AWARD (staff panel)  | Modal with a select of active achievements the member lacks + reason → `awardAchievement`.               |
| `achievements:revoke:<memberId>` (button → modal) | REVOKE (staff panel) | Modal with a select of the member's awards + reason → `revokeAchievement`.                               |
| `achievements:verify:<memberId>`                  | VERIFY (staff panel) | Ephemeral select of the member's pending awards.                                                         |
| `achievements:verify_pick:<memberId>` (select)    | pending-award select | `verifyMemberAchievement` for each pick; one refusal (own award, you awarded it) does not stop the rest. |

Staff buttons appear only for `canAwardAchievements` and never on your own panel. The
member id in a custom id only routes: every handler calls core as the clicking user, so
a member pressing a forged AWARD gets **ACCESS RESTRICTED** and nothing changes. Paging,
verification results and the AWARD / REVOKE modals replace only a private (ephemeral) panel
(after a modal: the notice on top of the refreshed member view); a press or modal arriving from
a public message is answered privately and never edits it.

## Job handlers

### `discord.achievements.announce`

1. `getAchievementAnnouncement` — `null` (revoked, unverified, hidden, staff-only
   profile, already announced) completes without posting.
2. Posts one card: title `ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.`,
   kicker `RARITY · ACHIEVEMENT`, description, holder; `<@member>` in content with
   `allowedMentions: { parse: [] }` (nobody is pinged); all text through `userText()`.
3. `markAchievementAnnounced`; `{ stored: false }` → deletes the card just posted. If the
   callback throws, the card is deleted and the job fails so the retry starts clean.
   A retraction queued by the callback (award revoked meanwhile) runs immediately.

Permanent Discord failures (missing access, unknown channel) dead-letter; rate limits and
5xx retry with backoff.

### `discord.achievements.retract`

Deletes the card of a revoked award. Unknown message or channel = already gone = done.

**Discord permissions** in `settings.channels.achievements`: View Channel, Send Messages,
Embed Links (deleting its own messages needs nothing more).

## Dashboard: `/achievements`

Visible to every signed-in user (nav: PEOPLE → Achievements).

| Viewer                               | What                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyone                             | Catalog grid: unlocked entries plated in chrome with the unlock date, pending ones flagged, hidden ones masked (`HIDDEN · Classified.`), rarity, and the share of active members holding each (with `canViewMembers`).                                                                    |
| `canAwardAchievements` (OPERATIONS+) | Readouts: active achievements, unlocks held by active members, active members (the population of every share), awards pending verification. AWARD and REVOKE dialogs. **Pending verification** tab (25 per page): VERIFY — or "Your award" / "You awarded it" where four-eyes forbids it. |
| `canManageAchievements` (CORE+)      | Definitions table: rule (`Mission verified × 10`, `Manual`, `Inert rule`), rarity, held by (holders · share), inactive and hidden flags. NEW ACHIEVEMENT and EDIT open the definition dialog with the **criteria builder**; DELETE; SEED STARTERS installs the missing starter catalog.   |

- **Award / revoke dialogs.** A searchable member picker (members present in the guild,
  searched on the server through the directory, so profile privacy applies), then the
  achievement: AWARD offers the active achievements the member does not hold, REVOKE only
  the awards they hold (their active awards are looked up when the member is picked). A
  reason is required. Nobody acts on their own achievements; the service refuses and audits it.
- **Criteria builder.** The outcomes offered are exactly the core allow-list
  (`ACHIEVEMENT_EVENT_TYPES`), passed in by the server; first-step events (`project.created`)
  pin the threshold to 1. The service validates every rule again; errors appear inline.
- **Server Actions.** `searchAwardableMembersAction` and `memberAwardsAction` require
  `canAwardAchievements` (least privilege: only staff who can use the dialog can search from
  it) plus a same-origin request and a live session. Award, revoke, verify and the definition
  actions run through `runAction` and authorize in core.
