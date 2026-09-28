# Discord & dashboard: missions

Feature `apps/bot/src/features/missions` · custom-id namespace `missions` ·
domain: `@jave/core` `missions` (see [docs/modules/missions.md](../modules/missions.md)).

Missions are concrete, verifiable work. Members take them from the card or a
list, submit with evidence, and a reviewer verifies; verified work becomes
evidence on the record. Discord is driven by buttons, selects and modals —
typed arguments are limited to picking a mission (autocomplete).

## Slash command `/mission`

| Subcommand         | Who                                      | What it does                                                                                                                                                |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list [type]`      | any member                               | Open missions, five per page: type, slots, closing time, reward, your status. **Filter by type** select, **Open a mission** select, ACCEPT buttons, paging. |
| `view mission`     | any member (drafts/archives: staff only) | Mission detail: brief, slots, deadline, time limit, evidence, capability, reward, your assignment, and the actions you can take.                            |
| `accept mission`   | member in good standing                  | Takes a self-assignable mission, or accepts one staff assigned to you.                                                                                      |
| `submit [mission]` | the assignee                             | Submission modal (text, evidence title, http(s) link). Without `mission`: straight to the modal when one assignment can take work, else a select.           |
| `mine`             | any member                               | Your missions with status, team, due date, attempts; **Show** select (active / completed / all).                                                            |
| `abandon mission`  | the assignee                             | Asks first — ABANDON MISSION / KEEP IT. Only staff can reassign you afterwards.                                                                             |
| `create`           | `canManageMissions` (OPERATIONS+)        | **NEW MISSION** modal: title, type (select), brief, time limit (hours), deadline (UTC). Creates a draft and shows it with staff controls.                   |
| `publish mission`  | `canManageMissions`                      | Confirms: PUBLISH & ANNOUNCE (posts the card) or PUBLISH QUIETLY.                                                                                           |
| `assign mission`   | `canManageMissions`                      | Assign panel: member picker (up to 25), TEAM & TIME LIMIT modal. Team missions need a team key first.                                                       |
| `review`           | `canVerifyMissions` (OPERATIONS+)        | Review queue, oldest first, one entry per unit (a team reviews as one): VERIFY / REJECT, OPEN EVIDENCE, paging.                                             |

`mission` options autocomplete only what you can act on there (for example `publish`
offers drafts to staff and nothing to members). All replies are ephemeral; only the
mission card is public.

## Buttons, selects and modals

| Custom id                                                                        | Surface                      | Handler                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `missions:accept:<missionId>`                                                    | ACCEPT (card, list, detail)  | `acceptMission` for a waiting staff assignment, else `selfAssignMission` — as the clicking user.               |
| `missions:view:<missionId>`                                                      | DETAILS (card)               | Ephemeral detail for the clicking user.                                                                        |
| `missions:filter` · `missions:list:<type>:<offset>`                              | type select, paging          | Re-renders the open list in place; unknown types mean "every type".                                            |
| `missions:open` · `missions:mine`                                                | selects                      | Detail of the picked mission · your missions for the picked scope.                                             |
| `missions:submit:<missionId>` (button → modal)                                   | SUBMIT / RESUBMIT            | `submitMission` for **your** assignment on that mission. A team submission moves every teammate still working. |
| `missions:submit_pick`                                                           | select                       | Opens the submission modal for the picked mission.                                                             |
| `missions:abandon:<id>` → `missions:abandon_confirm:<id>`                        | ABANDON → confirm            | `abandonMission` for your assignment.                                                                          |
| `missions:create` (modal)                                                        | NEW MISSION                  | `createMission`.                                                                                               |
| `missions:publish:<id>` → `missions:publish_go:<id>:<1\|0>`                      | PUBLISH → announce / quietly | `publishMission({ announce })`.                                                                                |
| `missions:close:<id>` · `missions:reopen:<id>`                                   | CLOSE · REOPEN               | `closeMission` · `reopenMission`.                                                                              |
| `missions:archive:<id>` → `missions:archive_go:<id>`                             | ARCHIVE → confirm            | `archiveMission` (refused while submissions await review).                                                     |
| `missions:edit:<id>` (button → modal)                                            | EDIT                         | Title, brief, time limit, deadline, slots → `updateMission`. A deadline left as shown stays exactly as stored. |
| `missions:settings:<id>`                                                         | SETTINGS                     | Panel: capability select, reward select, type select (drafts), EVIDENCE and SELF-ASSIGN toggles, BACK.         |
| `missions:set_facet\|set_reward\|set_type\|toggle_evidence\|toggle_self:<id>`    | settings controls            | `updateMission` with the one field.                                                                            |
| `missions:assign:<id>` · `missions:assign_opts:<id>` (modal)                     | ASSIGN · TEAM & TIME LIMIT   | Assign panel · team key and hours travel in the picker's custom id.                                            |
| `missions:assign_pick:<id>:<team\|->:<hours\|->` (user select)                   | member picker                | `assignMission`; skipped members are listed with the reason (no slot, already on it, other team, standing).    |
| `missions:review:<offset>[:<missionId>]`                                         | queue paging, REVIEW QUEUE   | Re-renders the queue at that position: every mission's, or (from a detail) that mission's, with FULL QUEUE.    |
| `missions:verify\|reject:<assignmentId>:<offset>[:<missionId>]` (button → modal) | VERIFY · REJECT              | Feedback modal (optional for VERIFY, required for REJECT) → `verifySubmission` / `rejectSubmission`.           |
| `missions:dismiss`                                                               | KEEP IT                      | Closes a confirmation without changes.                                                                         |

Custom ids route; they never authorize. Staff controls are shown only to staff, forms
refuse non-staff **before** opening (ACCESS RESTRICTED), and every action re-checks the
clicking user in core: a forged VERIFY on your own unit is refused and audited
(`mission.self_review_blocked`); assigning yourself is refused and audited
(`mission.self_assign_blocked`); someone else's assignment is NOT FOUND.

The mission detail's REVIEW QUEUE (n) counts that mission's units (a team once) and opens
its queue; the queue stays on that mission through paging and decisions. OPEN EVIDENCE is a
link button only while the link fits Discord (512 characters); a longer one (a pre-signed
storage link, say) shows its host with a DASHBOARD button to the mission's review tab, so
one long link never blocks the queue.

Lists, panels and the review queue re-render in place only when the press — or the modal
it opened (SUBMIT, EDIT, TEAM & TIME LIMIT, VERIFY / REJECT) — came from a private (ephemeral)
message: a decided submission leaves the queue and the next one takes its place. A press on
the public card never rewrites it, whatever custom id it carries: the result arrives as a new
private reply, and the card changes only through `discord.missions.refresh_card`, from the
mission's state.

## Job handlers

### `discord.missions.announce`

1. `getMissionCard` — skipped when unknown, already announced, or no longer open.
2. Posts the card: kicker `MISSION M-0042 · BUILD · OPEN`, brief, slots, deadline, time
   limit, evidence, capability, reward; ACCEPT only when `acceptEnabled`, plus DETAILS.
   `allowedMentions: { parse: [] }`, all text through `userText()`.
3. `markMissionAnnounced`; `{ stored: false }` → deletes the card just posted; a thrown
   callback deletes it and fails the job. A refresh queued by the callback (the mission
   changed while posting) runs immediately.

### `discord.missions.refresh_card`

Re-renders the posted card from current state — edits, close, reopen, archive, and
roster changes on capped missions (slots left; ACCEPT disappears when full). A deleted
card completes the job. Queued with `rerunIfRunning`, so a change during a refresh is
never lost.

Permanent Discord failures dead-letter; rate limits and 5xx retry.

**Discord permissions** in `settings.channels.missions` (fallback `announcements`):
View Channel, Send Messages, Embed Links.

## Dashboard

Nav: OPERATIONS → Missions, visible to every signed-in user.

| Page                  | Viewer                | What                                                                                                                                                                                                                                                                                                                    |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/missions`           | mission staff         | Tabs OPEN · DRAFT · CLOSED · ARCHIVED with counts, type filter, table (holding / cap, awaiting review, deadline), "N awaiting review". NEW MISSION for `canManageMissions`.                                                                                                                                             |
| `/missions`           | members               | Your active missions, then open missions as cards (type filter, slots left, closing date, your status).                                                                                                                                                                                                                 |
| `/missions/new`       | `canManageMissions`   | Mission form: brief (title, type, brief, capability), participation (slots, time limit, deadline in your time zone, evidence, self-assign), reward (achievement, note), with the lifecycle beside it. Creates a draft.                                                                                                  |
| `/missions/[id]`      | anyone who may see it | Facts, brief, **Your assignment** (ACCEPT, SUBMIT with evidence, ABANDON; your submission, evidence and feedback). Staff: EDIT, PUBLISH (announce checkbox), CLOSE, REOPEN, ARCHIVE; **Assignments** tab with the ASSIGN dialog; **Review queue** tab (this mission's units, 20 per page) with VERIFY / REJECT dialogs. |
| `/missions/[id]/edit` | `canManageMissions`   | The same form, prefilled; the type is fixed after publishing. A reward achievement deactivated since stays selectable, so saving never drops it. A deadline left as shown stays as stored, so a closed mission whose deadline passed can still be corrected.                                                            |

- **Assign dialog.** A searchable member picker (members present in the guild, searched on
  the server through the directory, so profile privacy applies; up to 50 per call). Members
  already holding the mission show their state instead of a checkbox, and you are marked
  "You". Team missions take a team key; the time limit overrides the mission default. The
  service skips anyone who cannot take it and the result says why.
- **Review queue** reads `listSubmissionsForReview({ missionId })`: one entry per unit (a team
  reviews as one), oldest first. Your own unit shows no controls; the service refuses it anyway.
- **Server Actions.** `searchAssignableMembersAction` requires `canManageMissions` plus a
  same-origin request and a live session; every mutation runs through `runAction` and
  authorizes in core. A member's own assignment is always resolved from their session, never
  from a submitted id.

Drafts and archived missions are NOT FOUND for members. Evidence links open in a new
tab with `rel="noopener noreferrer nofollow"` and only when they are http(s).
