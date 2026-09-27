# JAVE AI — Discord commands and dashboard (`ai` feature)

Code: `apps/bot/src/features/ai/`, `apps/dashboard/app/(console)/ai/`. Domain rules live in
`@jave/core` (`ai.*`, see [`docs/modules/ai.md`](../modules/ai.md)); the surfaces never
re-implement them. Every AI call runs as the invoking member through core's guarded path:
`canUseAI` → burst limit (6 / 60 s) → `settings.ai.enabled` → input limit → secret redaction →
untrusted-data wrapping → daily limit → provider → ledger (no prompts, no answers stored).

## Answers

All answers are **ephemeral** (personal), **deferred** (the model may take seconds), passed
through `sanitizeForDiscord` (no `@everyone`/`@here`, no user/role/channel/command mentions,
masked links shown as `label (<url>)`), and **paginated**: answers longer than one embed get
`PREV` / `NEXT` buttons. The footer shows the page, today's usage (`12/50 AI REQUESTS TODAY`),
`RESETS 00:00 UTC` and the model. Notices are added when input was redacted, when the supplied
text looked like instructions (treated as data), when the answer was cut, and on the
**MOCK / DEVELOPMENT ONLY** provider.

| Command                                        | Who        | What it does                                                                                                                                                                                                             |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/ask [question] [context]`                    | `canUseAI` | Answer a question. `context` is pasted reference text, wrapped as untrusted data. Without `question`, opens the **ASK JAVE** modal (question + optional context, room for 4000 characters).                             |
| `/research [question]`                         | `canUseAI` | Structured brief: answer, **KEY POINTS**, **CAVEATS**, **SOURCES · MODEL-SUGGESTED — UNVERIFIED**. JAVE does not browse; source URLs are shown as inline code (copyable, never a one-click link). Modal without argument. |
| `/summarize [text \| message_link]`            | `canUseAI` | Summarize pasted text, or one JAVELIN message by link. The link is read **as the member** (`fetchMessageAs`): only messages the member can read themselves; everything else is `NOT FOUND`. Modal without arguments.      |
| `/analyze [text]`                              | `canUseAI` | Claims, evidence, gaps and open questions. Modal without argument.                                                                                                                                                       |
| `/brainstorm [topic] [constraints]`            | `canUseAI` | Concrete ideas and how to test the strongest. Modal without arguments.                                                                                                                                                   |
| `/jave ai-usage`                               | everyone   | Your requests today against the limit. `canViewAnalytics` adds organization totals (aggregates only); `canViewAuditLogs` adds the heaviest members today. Counts only.                                                    |
| `/jave status`                                 | everyone   | Includes the **AI** row: `—` disabled (`AI_PROVIDER=disabled`), `✓` reachable, `✕` down. `provider.health()` is cached for 60 s.                                                                                          |

## Message context menus (right-click a message → Apps)

| Menu            | Who                 | Flow                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ask JAVE`      | `canUseAI`          | Opens a modal bound to the member and the message (held in memory for 15 minutes). An empty question means "respond to this message". The message is untrusted data.                                                                                                                                                                  |
| `Summarize`     | `canUseAI`          | Summarizes the right-clicked message (author and time attributed).                                                                                                                                                                                                                                                                      |
| `Explain`       | `canUseAI`          | Plain-language explanation.                                                                                                                                                                                                                                                                                                            |
| `Create Task`   | `canManageMissions` | The model drafts a mission from the message; core stores a **pending** `create_task` proposal. The reply is the **PREVIEW** (exactly what was stored, with the capability needed to confirm and the expiry) plus **CONFIRM** / **CANCEL**. CONFIRM runs `ai.confirmProposal` as the clicking member and replaces the preview with the **REPORT** (`MISSION DRAFTED — #0007 … Status: DRAFT.`). An expired proposal shows **EXPIRED**; a decided one shows its state. |
| `Save to Sidus` | `canViewMembers`    | Research library — see [`research.md`](./research.md).                                                                                                                                                                                                                                                                                |

## Components and modals (custom ids route, never authorize)

| Custom id                   | Kind   | Rule                                                                                                                                                                                                     |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai:page:<answerId>:<page>` | button | `answerId` is 12 random base64url characters of an in-memory answer (30 minutes, 500 per process). Only the member who asked may page (`ACCESS RESTRICTED` otherwise); missing/forged ids read `EXPIRED`. |
| `ai:confirm:<proposalId>`   | button | Core checks requester / `canConfirmAIActions`, the kind's capability, expiry and the payload hash.                                                                                                       |
| `ai:cancel:<proposalId>`    | button | `ai.rejectProposal` — the requester withdraws, or someone allowed to decide rejects.                                                                                                                    |
| `ai:<ask\|research\|summarize\|analyze\|brainstorm>` | modal | Slash-command forms.                                                                                                                                        |
| `ai:askmsg:<pendingId>`     | modal  | `Ask JAVE` form; the pending message is single-use and owner-bound.                                                                                                                                     |

Answers are never written to the database: after a restart, old page buttons read `EXPIRED`.

## Job — `discord.ai.announce`

Enqueued when someone with `canBroadcast` confirms a `draft_announcement` proposal (dashboard
`/ai`). The handler validates the payload (dead-letters otherwise), skips unless the proposal is
still `confirmed`, posts **one** embed (`JAVELIN · ANNOUNCEMENT`, sanitized title and body,
`allowedMentions: { parse: [] }`) with a per-proposal **nonce** (`sendMessageOnce`, so a retry
after a lost response gets the same message back), then calls `ai.recordAnnouncementDelivery`
(`posted` + message id). A permanent Discord failure (missing channel, missing permissions) or
the last attempt records `failed` with the reason and dead-letters (`PermanentJobError`).

## Dashboard — `/ai` (`canUseAI`)

- **Overview** — provider, model and reachability (detail and check time for
  `canViewSystemStatus`; configuration errors name the variable, never the value), the limits,
  your usage today; organization totals today (`canViewAnalytics`); usage per member today
  (`canViewAuditLogs`).
- **Proposals** — _Awaiting your confirmation_ (`canConfirmAIActions`, kinds whose capability you
  hold, other members' drafts), _Your proposals_ with their REPORT, and _Draft with JAVE AI_
  (announcement: `canBroadcast`; mission: `canManageMissions`). CONFIRM and REJECT open a dialog
  that repeats the preview; buttons appear only where core would allow them.
- **Request ledger** — time, feature, surface, status, model, tokens, latency, error code; for
  `canViewAuditLogs` also the member and a 12-character prompt fingerprint (repeats, never
  content). Filters: feature, status.

## Discord permissions

| Where                                     | Permissions                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Commands, context menus, buttons, modals  | None beyond the application command scope: every reply is an interaction response.                     |
| `/summarize` with a message link          | The bot: View Channel + Read Message History in that channel. The member must hold the same (checked).   |
| Announcements channel (`channels.announcements`) | View Channel, Send Messages, Embed Links.                                                          |
