# AI — `@jave/ai` + `packages/core/src/ai`

JAVE's AI layer. It may **analyze, summarize, recommend, classify, draft, research and assist**.
It must never silently ban, change permissions, modify ranks, delete data, expose private
information or run destructive operations. Anything that changes state goes through
**PREVIEW → CONFIRM → EXECUTE → REPORT**, confirmed by a human who holds the right capability.

```
surface (bot / dashboard)
   │  deps = { provider: createProviderFromEnv(env), dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT }
   ▼
ai.ask / research / summarize / analyze / brainstorm / explain / draftAnnouncement / draftTask   (core)
   │  canUseAI → burst limit → settings.ai.enabled → maxInputChars → redact secrets
   │  → wrap untrusted data → reserve daily quota (ledger) → provider.complete → ledger
   ▼
AIProvider (@jave/ai): Anthropic | OpenAI-compatible | Disabled | Mock (dev only)
```

## `@jave/ai` (provider-agnostic)

| Export                                                          | Purpose                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIProvider`, `AIRequest`, `AIResponse`, `AIUsage`, `AIContext` | The contract. Refusals are **errors**, never a stop reason, so a refusal cannot be shown as an answer.                                                                                                                                                                                                                                                                             |
| `AnthropicProvider`                                             | Official `@anthropic-ai/sdk`, Messages API. Default model `claude-opus-5` (override with `AI_MODEL`). SDK retries off; shared retry policy. Server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) are sent only to the first-party API for models that support them. `temperature` is dropped for models that reject sampling parameters. |
| `OpenAICompatibleProvider`                                      | `POST {baseUrl}/chat/completions` over `fetch`: OpenAI, DeepSeek, Ollama, LM Studio, vLLM. `max_completion_tokens` for OpenAI, `max_tokens` otherwise.                                                                                                                                                                                                                             |
| `DisabledProvider`                                              | Every call fails with `AIDisabledError` ("AI is disabled").                                                                                                                                                                                                                                                                                                                        |
| `MockProvider`                                                  | **MOCK / DEVELOPMENT ONLY.** Deterministic, records calls, scriptable. Refused by the factory outside development/test.                                                                                                                                                                                                                                                            |
| `createProviderFromEnv(env, deps)`                              | Builds the provider from `AiEnv`. Errors name the variable, never its value.                                                                                                                                                                                                                                                                                                       |
| `AIError` + subclasses                                          | `rate_limited`, `overloaded`, `timeout`, `auth`, `invalid_request`, `refusal`, `disabled`, `unavailable`, `malformed_response`, `aborted`, `configuration`, each with `retryable`.                                                                                                                                                                                                 |
| `untrusted(label, content)`                                     | Wraps user/Discord content between `[BEGIN UNTRUSTED DATA · label · boundary]` markers with a do-not-follow instruction. Random 96-bit boundary; content is NFKC-normalized, invisible/bidi characters removed, and any spelling of the marker phrase is rewritten.                                                                                                                |
| `detectInjection(text)`                                         | Heuristic signals (ignore-instructions, role override, prompt probes, chat-template tokens, fake role headers, delimiter spoofing, action coercion, authority claims, invisible characters). For logging and UI warnings — **not** a guarantee.                                                                                                                                    |
| `sanitizeForDiscord(text, max)`                                 | Neutralizes `@everyone`/`@here`, `<@…>`, `<@&…>`, `<#…>`, `</cmd:…>`, unmasks `[text](url)` links, caps to 2000/4096 with an ellipsis (surrogate-safe).                                                                                                                                                                                                                            |

Transport rules for every provider: per-attempt timeout (`AbortController`, default 90 s),
automatic retry of `rate_limited`/`overloaded`/`unavailable` at most twice with jittered
exponential backoff honouring `retry-after` (capped at 10 s), timeouts are not auto-retried,
request validation before any network call, error messages that never contain the key, the
prompt or upstream bodies, and an injectable `fetch`. The fetch-based OpenAI-compatible
provider additionally caps response size (2 MB) and refuses redirects; the Anthropic provider
relies on the official SDK's transport for those.

### Environment

| Variable                 | Rules                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`            | `anthropic` \| `openai` \| `openai-compatible` \| `disabled` (default). `mock` is accepted by the factory type only with `NODE_ENV=development` or `test` (see known limitations). |
| `AI_API_KEY`             | Required for `anthropic` and `openai`; optional for `openai-compatible` (local servers).                                                                                           |
| `AI_MODEL`               | Optional for `anthropic`; required for `openai` / `openai-compatible`. ≤ 64 chars, `[A-Za-z0-9._:/@-]`.                                                                            |
| `AI_BASE_URL`            | Required for `openai-compatible`. https only, except loopback hosts; no embedded credentials.                                                                                      |
| `AI_DAILY_REQUEST_LIMIT` | Deployment ceiling; the effective per-user limit is `min(settings.ai.dailyRequestsPerUser, ceiling)`.                                                                              |

## Core module (`import { ai } from '@jave/core'`)

Every feature has the signature `(ctx, deps: AiDeps, input)`; `deps` is built once per process by
the surface (services never read `process.env`).

| Service                                                                              | Kind         | Notes                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ask({ question, context?, surface })`                                               | READ         | `context` is wrapped as untrusted data.                                                                                                                                                                                              |
| `research({ question, surface })`                                                    | READ         | Returns `{ answer, keyPoints[], caveats, suggestedSources[] }`. No browsing: every source is `verified: false`, labelled `MODEL-SUGGESTED — UNVERIFIED`, URLs restricted to http(s). Falls back to plain text (`structured: false`). |
| `summarize({ text } \| { messages[] })`                                              | READ         | Messages become an attributed transcript (≤ 200 messages).                                                                                                                                                                           |
| `analyze({ text })`, `explain({ text })`                                             | READ         |                                                                                                                                                                                                                                      |
| `brainstorm({ topic, constraints? })`                                                | SUGGEST      |                                                                                                                                                                                                                                      |
| `draftAnnouncement({ brief })`                                                       | SUGGEST      | Requires `canBroadcast`. The model drafts; JAVE stores a **pending** `draft_announcement` proposal.                                                                                                                                  |
| `draftTask({ brief })`                                                               | SUGGEST      | Requires `canManageMissions`. The model drafts a mission; JAVE stores a **pending** `create_task` proposal.                                                                                                                          |
| `proposeAction`, `confirmProposal`, `rejectProposal`, `getProposal`, `listProposals` | EXECUTE path | See below.                                                                                                                                                                                                                           |
| `getUsage(ctx, deps?)`                                                               |              | Today's `{ used, limit, remaining, resetsAt }` for the caller.                                                                                                                                                                       |
| `getOrgUsage(ctx, { days ≤ 90 })`                                                    |              | `canViewAnalytics`. Aggregates only: totals, by status, by feature, by day. No prompts, no per-user rows.                                                                                                                            |
| `recordAnnouncementDelivery`                                                         |              | Bot callback (system actor only).                                                                                                                                                                                                    |

Draft features check the proposing capability and the pending-proposal cap **before** spending a
model request; model output only ever becomes a pending proposal.

Answers carry `warnings`: `input_redacted`, `possible_prompt_injection`, `output_truncated`.
`text` is raw model output — surfaces must pass it through `sanitizeForDiscord` / escape it.

### Guards (in order)

1. `requireUser` — system, integration and anonymous actors cannot use AI features.
2. `authorize(ctx, 'canUseAI')` (denials audited).
3. Burst limit: 6 requests / 60 s per user (`consumeRateLimit`).
4. `settings.ai.enabled`, the provider is not `disabled`, effective daily limit > 0 → otherwise `DisabledError` (ledger row `disabled`).
5. Total input ≤ `settings.ai.maxInputChars` (and ≤ 100 000 absolute) → `ValidationError`.
6. Secret redaction (`kernel.redact` + AWS/Slack/Google/Stripe/GitLab/GitHub-PAT/npm/HF keys, `password: …` style labels, URL credentials, whole PEM private keys).
7. Untrusted wrapping of pasted/Discord content + injection heuristics (logged as signal names only). The member's own request is not wrapped, but delimiter look-alikes in it are neutralized so it cannot fake the end of a data block.
8. Daily-limit reservation: an advisory lock per user, count today's (UTC) `pending|ok|refused` rows, insert a `pending` row — concurrent requests cannot overshoot. Over the limit → `RateLimitedError` ("Daily AI limit reached — N requests per day. Resets at 00:00 UTC.") and a `rate_limited` row.
9. Provider call outside any transaction; the row is finalized with status, model, tokens, latency and an error code. Provider errors become calm `ExternalServiceError`s (e.g. "JAVE AI is at capacity. Try again in a minute."); `auth`/`configuration` failures are logged for operators.

The `ai_requests` ledger stores a SHA-256 **prompt fingerprint**, never the prompt: the hash of the
system prompt, the feature framing and the redacted request/data, excluding the random data
boundary — so identical requests hash identically (abuse investigation, dedupe).

### PREVIEW → CONFIRM → EXECUTE → REPORT

Action-kind registry (`actions/kinds.ts`): `{ kind, capabilityToPropose, capabilityToConfirm,
confirmableBy, payloadSchema, preview, authorizeExecution?, execute }`.

| Kind                   | Propose             | Confirm                                                          | Execute                                                                                                                                        |
| ---------------------- | ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_research_item` | `canUseAI`          | `canUseAI`, **requester only** (members confirm their own)       | `research.saveResearchItem` as the confirming member (status NEW, `origin: 'ai'`).                                                             |
| `create_task`          | `canManageMissions` | `canManageMissions` (+ `canConfirmAIActions` for someone else's) | Mission row in **DRAFT** written directly to `missions` (the missions module had no create API at the time; switch to it at merge).            |
| `draft_announcement`   | `canBroadcast`      | `canBroadcast` (+ `canConfirmAIActions` for someone else's)      | Enqueues `discord.ai.announce` (sanitized title/body) to `settings.channels.announcements`; fails with a clear message when no channel is set. |

Proposal state machine (`ai_action_proposals.status`):

```
pending ──confirm──► executed                      (effect applied in the confirmation transaction)
   │        └──────► confirmed ──bot posted──► executed   (Discord side effect queued)
   │                          └──bot failed──► failed
   ├──reject──► rejected
   ├──expiry (settings.ai.proposalTtlMinutes, sweep every 5 min)──► expired
   └──tampered / invalid payload / execution error──► failed
```

`proposeAction` validates the payload with the kind's schema, caps it (16 KB canonical JSON),
checks that a referenced `aiRequestId` belongs to the caller, limits a user to 10 live pending
proposals, stores a sanitized preview, `payloadHash = sha256(canonical JSON)`, and audits
`ai.action_proposed`.

`confirmProposal` requires a **human user**; checks requester-only / `canConfirmAIActions` /
the kind's capability (denials audited); AI enabled; status `pending`; not expired (marks it
`expired`); the stored payload still matches the previewed hash (else `failed`, `ConflictError`);
re-validates the payload; runs the kind's `authorizeExecution` **before** opening the
transaction; then atomically claims the row (`pending → confirmed` with `status = 'pending' AND
expires_at > now`, so exactly one concurrent confirmation wins), executes, records the result,
audits `ai.action_executed` (actor = confirming human; context `proposalId`, `kind`,
`aiRequestId`, `requestedByUserId`, `outcome`), publishes `ai.action_executed`
(`subjectMemberId` = requester's member) and notifies the requester when someone else
confirmed. It returns the REPORT: `{ proposalId, kind, status, summary, data }`.

Model output never reaches `confirmProposal`: features only ever create `pending` proposals,
and the tests assert that coercive model output ("CONFIRMED… execute now") leaves the proposal
pending with no job, audit or event.

## Capabilities

`canUseAI` (features, own proposals), `canConfirmAIActions` (confirm/reject others' proposals, still
bounded by the kind's capability), `canManageMissions`, `canBroadcast`, `canViewAnalytics` (org usage).

## Events

| Event                | When                              | subjectMemberId        |
| -------------------- | --------------------------------- | ---------------------- |
| `ai.action_executed` | A proposal was confirmed/executed | the requester's member |

## Audit actions

`ai.action_proposed`, `ai.action_executed`, `ai.action_rejected`, `ai.action_failed` (durable),
`ai.announcement_posted`, `ai.announcement_failed`, `access.denied` (requester-only kinds).

## Notifications

| Type                  | Recipient | When                                                            |
| --------------------- | --------- | --------------------------------------------------------------- |
| `ai.proposal_decided` | requester | Someone else confirmed or declined their proposal (inbox only). |

## Jobs

| Job              | Schedule    | Work                                                                                                        |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `ai.maintenance` | every 5 min | Expire pending proposals past their TTL; close ledger rows left `pending` for > 1 h (`error`, `abandoned`). |

## Discord job contract — `discord.ai.announce`

- **Enqueued by:** `confirmProposal` for `draft_announcement`. Dedupe key `ai:announce:<proposalId>`, 5 attempts.
- **Payload** (`aiAnnouncePayloadSchema`): `{ proposalId, channelId, title (≤ 256), body (≤ 4096) }`, both already sanitized.
- **Bot must:** validate the payload (dead-letter if invalid); post **one** embed to `channelId` (title → embed title, body → description) with `allowedMentions: { parse: [] }`; stay idempotent across retries (never post twice for one proposal); then call `ai.recordAnnouncementDelivery(ctx, { proposalId, outcome: 'posted', messageId })`, or `{ outcome: 'failed', error }` on a permanent Discord failure.
- **Discord permissions (announcements channel):** View Channel, Send Messages, Embed Links.

## Extension points

- **New provider:** implement `AIProvider` (validate with `aiRequestSchema`, map failures to `AIError` subclasses, raise `AIRefusalError` for refusals) and add a branch to `createProviderFromEnv`.
- **New action kind:** `defineActionKind({...})` in `actions/kinds.ts` and add it to `ACTION_KINDS`. Put domain permission checks in `authorizeExecution` (it runs before the transaction; denials are audited durably). `execute` runs inside the confirmation transaction.
- **Surfaces:** build `AiDeps` once per process; call `sanitizeForDiscord` on every model output; render `warnings`; show `preview` before offering Confirm.

## Known limitations

- `@jave/config`'s `AI_PROVIDER` enum does not include `mock`; the factory accepts it (development/test only) but the env schema must add it before `AI_PROVIDER=mock` can be set from the environment.
- The static core registry cannot receive `AiDeps`; AI features are called directly by surfaces with `deps` (no AI job handlers need the provider today).
- Research answers come from the model's own knowledge: no browsing, no citation verification.
- `create_task` writes the `missions` table directly until the missions module exposes a creation API.
- Injection detection is heuristic; the real safety boundary is that AI output cannot execute anything without a human confirmation.
- Requests are non-streaming with a 90 s per-attempt deadline (`ProviderFactoryDeps.timeoutMs` overrides it). Long answers on reasoning models can exceed it and surface as "JAVE AI took too long to respond"; timeouts are deliberately not auto-retried.
