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
needed. Under the last message:

| Control                                                                | Who                            | Does                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **RED FLAG — STOP NOW** `adversarial:redflag:<roleId>`                 | the operative                  | One press, no confirmation (the protocol says _immediately_): `raiseRedFlag`; the STOP DM follows; managers are alerted. Idempotent. |
| **Mark a trigger as carried out** `adversarial:fire:<roleId>` (select) | the operative, exercise active | `fireTrigger` for the chosen approved trigger. Pending triggers never appear.                                                        |

Any failure that would distinguish a real role from a forged id (NOT FOUND, another
person's role) answers **NO BRIEFING**.

### Stop word

A message listener: when the operative types `RED FLAG` (also `red flag`, `red-flag`,
`RED_FLAG`; whole words) anywhere in the server, or anyone types it in the team
channel of a running exercise, `raiseRedFlag` runs as the system actor and the
exercise stops. Nothing is posted in the channel, so the message reveals nothing; the
operative receives the STOP DM and managers are alerted. Trade-off: in a trial where
"red flag" is ordinary vocabulary a teammate can stop the exercise by accident — the
stop word errs on the side of stopping.

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
| Observations        | Timeline of outcomes (reported, detected, resisted, partial, failure), optionally tied to a trigger and a participant (staff-only).                                                                                                                                                                                                                      |
| Evaluation & reveal | Security-culture score (suggested from observations; a different score needs a justification), staff summary, team debrief. **Reveal** once the trial has ended and a debrief exists.                                                                                                                                                                    |
| Scenario library    | **Install starters** (five fictional scenarios, idempotent), **New scenario**, edit (roles keep their snapshot), deactivate, delete (only while unused).                                                                                                                                                                                                 |

Delivery states (briefing revision and DM, STOP notice, debrief) are shown per role so
staff see when a human has to follow up.
