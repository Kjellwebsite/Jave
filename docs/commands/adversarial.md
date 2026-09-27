# Discord & dashboard: adversarial (SANDBOX · FICTIONAL DATA ONLY)

Feature `apps/bot/src/features/adversarial` · custom-id namespace `adversarial` ·
dashboard tab `/trials/[id]?tab=adversarial` · domain: `@jave/core` `adversarial` (see
[docs/modules/adversarial.md](../modules/adversarial.md)).

A trial may host a hidden, two-person-authorized **security-culture exercise**: one
operative on one team runs a scripted, harmless test with fictional data, sandbox
accounts and sandbox hosts. The Discord surface is deliberately small — the
operative's briefing and controls, the confidential DMs, the stop word, and the
debrief after the reveal. Everything else is staff work in the dashboard.

## Secrecy rules (tested)

- No participant-facing command, card, button, DM, channel post or error reveals
  whether a trial hosts a role. `/trial list|view|status`, `/team`, the recruitment
  card, the brief post, deadline warnings and every refusal are identical for a team
  with and without an operative (`adversarial.test.ts` compares their shape).
- A participant typing the stop word gets no visible reaction, stops nothing and leaves
  no audit row (see **Stop word**).
- The only operative-facing reads are `/trial briefing` and the briefing DM. Anyone
  who is not the briefed operative — a teammate, a member guessing, a quarantined
  operative, a forged control — gets the same **NO BRIEFING** answer.
- The debrief reaches the team channel only after the reveal.
- In the dashboard the tab exists only for `canManageAdversarial`; for everyone else
  `?tab=adversarial` renders the Overview, and no other tab mentions a role.

## Discord

### `/trial briefing`

Anyone may run it; it answers only the operative. For each of their briefed or active
roles: the briefing (scenario and technique, objective, sandbox assets, approved
triggers, guardrails, operating rules, stop protocol), under the kicker
`CONFIDENTIAL · SANDBOX EXERCISE · FICTIONAL DATA ONLY`, split across messages as
needed. Under the last message — here and in the briefing DM, since JAVE never reads
direct messages:

| Control                                                                | Who                            | Does                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **RED FLAG — STOP NOW** `adversarial:redflag:<roleId>`                 | the operative (server or DM)   | One press, no confirmation (the protocol says _immediately_): `raiseRedFlag`; the STOP DM follows; managers are alerted. Idempotent. |
| **Mark a trigger as carried out** `adversarial:fire:<roleId>` (select) | the operative, exercise active | `fireTrigger` for the chosen approved trigger. Pending triggers never appear.                                                        |

Any failure that would distinguish a real role from a forged id (NOT FOUND, another
person's role) answers **NO BRIEFING**.

### Stop word

A message listener matches `RED FLAG` (also `red flag`, `red-flag`, `RED_FLAG`; whole
words) in server messages and hands the author and channel (a thread's parent) to core
`stopWordTyped` (system actor). Core decides by **who** typed it:

| Typed by                                                             | Where                     | Result                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the operative (briefed or active)                                    | anywhere in the server    | RED FLAG as the operative: the exercise stops, the STOP DM follows, managers are told it was _typed in chat by the operative_.                                                                |
| adversarial staff (`canManageAdversarial`, not in the trial)         | the team channel          | RED FLAG as that staff member (_typed in chat by staff_).                                                                                                                                     |
| anyone else — participants, evaluators, staff competing in the trial | the team channel (active) | Nothing stops. Managers get one **STOP WORD IN CHAT** alert per exercise to check in with the operative. Not audited (a row at that moment would be a tell for staff competing in the trial). |

Participants are never told the stop word, so in a trial like _Red Flag Hunt_ their
"found a red flag" is vocabulary, not a stop call; the operative's briefing says so and
tells them to raise RED FLAG themselves when in doubt. Nothing is ever posted in the
channel. Direct messages to JAVE are not read (no DM intent): the RED FLAG button rides
along with the briefing DM instead.

### Job handlers (`discord.adversarial.*`)

| Job                           | Does                                                                                                                                                                                                                                                                                                   | Discord permissions                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `discord.adversarial.brief`   | `loadBriefingDelivery` (refuses once the role stopped, the kill switch is off or the operative is no longer eligible) → DMs every section; skips superseded revisions and repeats → `markBriefingDelivered` (`sent` / `undeliverable` for closed DMs, which notifies the planner). Never a guild post. | none in the guild (shares it to open a DM)              |
| `discord.adversarial.abort`   | `loadStopNotice` → DMs the fixed STOP title and body (never the reason) → `markStopNoticeDelivered`. Transient failures retry; on the last attempt it reports `undeliverable` first, so core raises a critical alert and a human steps in.                                                             | none in the guild                                       |
| `discord.adversarial.debrief` | `loadDebrief` (after the reveal) → posts the debrief in the team channel, no participant names → `markDebriefPosted`; no channel or a permanent refusal → `undeliverable` (planner notified).                                                                                                          | View Channel, Send Messages, Embed Links (team channel) |

A loader's INVALID_STATE / NOT_FOUND means "must not be sent any more": the job ends
permanently and sends nothing.

## Dashboard — Adversarial tab (`canManageAdversarial`)

Always under the banner **SANDBOX · FICTIONAL DATA ONLY · STAFF ONLY**. Every control
is a confirmation dialog; the adversarial service enforces the kill switch, the
two-person rule, conflict of interest (staff taking part in the trial never reach the
page) and the safety validator.

| Area                | Controls                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switches            | Global kill switch state (settings); **Allow roles / Disallow roles** for this trial (draft … teams set).                                                                                                                                                                                                                                                |
| Plan                | **Plan role**: operative (a selected member of a team; core checks VERIFIED/staff and standing), scenario, optional objective (validated).                                                                                                                                                                                                               |
| Two-person rule     | **Authorize** (`canAuthorizeAdversarial`, not the planner, not an author of any trigger in the plan): signs the plan revision on screen — a plan changed since it was loaded is refused — with the mandatory sandbox attestation and an optional note.                                                                                                   |
| Triggers            | **Add trigger** (label, description, optional time). Before authorization it joins the plan under review; afterwards it stays **Awaiting approval** until another authorizer **Approves** it (attestation; a briefed operative gets a new briefing revision). Pending triggers can be **Withdrawn**; approved ones can be **Marked fired** while active. |
| Lifecycle           | **Brief** (DM) → **Activate** (trial live, before the deadline) → **Conclude**; **Stop** (reason stays internal; a briefed or active operative gets an immediate STOP).                                                                                                                                                                                  |
| Observations        | Timeline of outcomes (reported, detected, resisted, partial, failure), optionally tied to an **approved** trigger and a participant other than the operative (staff-only).                                                                                                                                                                               |
| Evaluation & reveal | Security-culture score (suggested from observations; a different score needs a justification), staff summary, team debrief. **Reveal** once the trial has ended and a debrief exists.                                                                                                                                                                    |
| Scenario library    | **Install starters** (five fictional scenarios, idempotent), **New scenario**, edit (roles keep their snapshot), deactivate, delete (only while unused).                                                                                                                                                                                                 |

Delivery states (briefing revision and DM, STOP notice, debrief) are shown per role so
staff see when a human has to follow up.
