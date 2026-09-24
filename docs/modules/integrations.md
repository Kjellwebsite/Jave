# Module: integrations

`packages/core/src/integrations` — integration registry, the inbound webhook
pipeline (GitHub + JAVE-signed providers), delivery processing, linked
external accounts, and outbound webhooks. Schema:
`packages/database/src/schema/integrations.ts`.

```ts
import { integrations } from '@jave/core';
```

## Purpose

Connect JAVE to the outside world without trusting it: every inbound request
is authenticated, replay-protected, size-capped and stored idempotently
before anything is processed; every outbound request is signed, SSRF-checked
and bounded. Integration data never becomes capability on its own — only a
**merged pull request on a linked repository** becomes a contribution; pushes
and releases are project activity.

## Registry

| Function                                                              | Capability              | Notes                                                                                                                               |
| --------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `createIntegration`                                                   | `canManageIntegrations` | provider `github`, `generic`, `sidus`, `supabase`, `monitoring`; slug (3–48, lowercase) → `/api/webhooks/{slug}`; non-secret config |
| `updateIntegration`                                                   | `canManageIntegrations` | name / config                                                                                                                       |
| `rotateIntegrationSecret`                                             | `canManageIntegrations` | JAVE-signed providers only; the old secret stops working immediately                                                                |
| `setIntegrationEnabled`                                               | `canManageIntegrations` | disabled integrations answer 404                                                                                                    |
| `listIntegrations`, `getIntegration`                                  | `canManageIntegrations` | never return secrets (`hasSecret`, `secretSource` only)                                                                             |
| `listWebhookDeliveries`, `getWebhookDelivery`, `retryWebhookDelivery` | `canManageIntegrations` | delivery log; retry re-queues failed/dead deliveries (audited)                                                                      |

Signing secrets (`whsec_…`, 32 random bytes) are generated for every
JAVE-signed provider (generic, sidus, supabase, monitoring), **returned once**,
and stored AES-256-GCM encrypted with `ctx.config.encryptionKey`
(`JAVE_ENCRYPTION_KEY`). Without a valid 32-byte key JAVE refuses with
`DisabledError("Signed integrations (JAVE_ENCRYPTION_KEY required) is currently disabled.")`
rather than storing secrets in the clear. GitHub integrations use the
deployment's `GITHUB_WEBHOOK_SECRET` (passed by the route; never stored).

Config is a flat map of scalars (≤ 20 keys). Keys that look like credentials
(`token`, `secret`, `password`, `apiKey`, …) are refused. Known key:
`relayChannelId` (Discord channel snowflake) — enables the Discord relay for
generic deliveries.

## Inbound pipeline

`receiveWebhook(ctx, { slug, headers, rawBody, secrets: { github } }) → { status, body }`
is framework-agnostic; the dashboard route handler reads the raw body (and
should stop reading past 1 MiB), lowercases header names and returns the
result as JSON.

Order of checks:

1. **Size** — body > 1 MiB (UTF-8 bytes) → `413 payload_too_large`.
2. **Integration** — unknown, malformed or disabled slug → `404 not_found` (indistinguishable).
3. **Signature**
   - GitHub: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, rawBody)>`,
     plus `X-GitHub-Delivery` and `X-GitHub-Event`. Missing server secret → `503 not_configured`.
   - JAVE v1 (generic, sidus, supabase, monitoring):
     `X-Jave-Timestamp: <unix seconds>`,
     `X-Jave-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`
     (several comma-separated `v1=` entries allowed), `X-Jave-Delivery`,
     optional `X-Jave-Event` (default `generic`). Timestamps outside ±5 minutes
     are rejected (replay).
   - Comparisons are constant-time. Failure → `401 invalid_signature` and a
     durable `webhook.signature_invalid` audit (reason in context). Audits are
     capped at 20 per integration per minute so forged floods cannot flood
     the audit log; every forged request is still refused.
4. **Identifiers** — missing/invalid delivery id or event → `400 missing_delivery_headers`.
5. **JSON** — malformed, non-object or nested deeper than 64 → `400`.
   NUL characters (unstorable in Postgres) are stripped; `__proto__` keys stay data.
6. **Persist** — `webhook_deliveries` row + `integrations.process_delivery`
   job in one transaction → `202 { ok, deliveryId }`.
   Idempotency: `(integration, delivery id)` **and** `(integration, signature digest)`
   are unique, so a redelivery _or_ a captured request replayed with a forged
   delivery id answers `200 { ok: true, duplicate: true }` with no reprocessing.
   GitHub deliveries share one deployment-wide secret, so for `github` the keys
   are deployment-wide — `(provider, delivery id)` and `(provider, signature digest)`
   (partial unique indexes): a GitHub request captured for one GitHub
   integration cannot be replayed against another. JAVE-signed providers have
   a secret per integration, so their delivery ids only need to be unique per
   integration (two senders may both count from 1).

### Delivery processing (`integrations.process_delivery`)

`received → processing → processed | ignored`, or `failed` (retried by the
queue with exponential backoff, attempts and `lastError` recorded) → `dead`
after 6 attempts (audited `webhook.delivery_dead`). The processor's effects and
the final status commit in one transaction. `statusReason` explains the outcome.

| Provider                    | Processor                                                                   |
| --------------------------- | --------------------------------------------------------------------------- |
| github                      | see below                                                                   |
| generic                     | stored; with `relayChannelId`, enqueues `discord.integrations.relay`        |
| sidus, supabase, monitoring | stored, marked `ignored` — `no processor configured` (never fake-processed) |

GitHub events:

| Event                                           | Effect                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                                          | processed                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pull_request` closed + merged on a linked repo | contribution (kind `code`, source `github`, `externalRef github:pr:owner/repo#N`, idempotent). `verified` only if the author's linked account is staff-verified **and** bound to the PR author's numeric GitHub id; otherwise `submitted` for review. Bots, unlinked authors, banned/quarantined members, archived projects and `settings.integrations.githubAutoContributions = false` are ignored with a reason. |
| `push` to the default branch                    | `project.github_push` activity event (commit count, head commit, headline) — **never a contribution**                                                                                                                                                                                                                                                                                                              |
| `release` published                             | `project.release_published` activity event                                                                                                                                                                                                                                                                                                                                                                         |
| anything else                                   | ignored (`unsupported event …`)                                                                                                                                                                                                                                                                                                                                                                                    |

## External accounts

| Function                                                              | Who                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `linkGithubAccount({ username })`                                     | yourself (good standing); self-declared, unverified; changing it resets verification |
| `unlinkGithubAccount({ memberId? })`                                  | yourself, or `canVerifyMembers` for others                                           |
| `setExternalAccountVerification({ memberId, verified, externalId? })` | `canVerifyMembers`, **never your own**; `externalId` = GitHub numeric user id        |
| `getExternalAccounts({ memberId })`                                   | yourself, `canViewPrivateProfiles`, `canVerifyMembers`                               |

Usernames are unique (lowercase). A numeric id match always wins; a login
match counts only while no id is bound, so a renamed-and-reclaimed login never
inherits someone's identity. Verify accounts out of band (e.g. a gist or a
commit from the account) and record the numeric id.

## Outbound webhooks

| Function                                                                                          | Capability                                                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `createOutboundWebhook({ name, url, eventTypes })`                                                | `canManageIntegrations`; returns the signing secret once       |
| `updateOutboundWebhook`                                                                           | `canManageIntegrations`; re-enabling clears the failure streak |
| `rotateOutboundSecret`, `deleteOutboundWebhook`, `listOutboundWebhooks`, `listOutboundDeliveries` | `canManageIntegrations`                                        |

- Only catalog events with `external: true` can be subscribed, and only events
  whose payload visibility is `public` (or absent) are delivered.
- URLs are shown masked (`https://host/…`) after creation and never written to
  audit context: chat-app webhook URLs embed credentials in the path.
- **Target rules** (`ssrf.ts`, checked on save and before every send):
  https only; `http://` only when `settings.integrations.allowInsecureForDev`
  is on (**DEVELOPMENT ONLY**, independent of NODE_ENV, audited like every
  settings change); no credentials; no `localhost`/`.local`/`.internal`/
  single-label hosts; no private, loopback, link-local, CGNAT, multicast,
  reserved or documentation IPv4 literals; IPv6 literals must be global
  unicast (2000::/3) outside documentation/Teredo/special ranges, and 6to4
  wrappers of blocked IPv4 are refused. Decimal/hex/octal IPv4 tricks are
  normalized by the WHATWG URL parser before the check. Before connecting,
  the hostname is resolved and **every** answer must be public.
- **Delivery** (`integrations.deliver_outbound`): `POST` JSON envelope
  `{ id, type, occurredAt, aggregate, subjectMemberId, data }` (secret-looking
  values redacted) with headers `X-Jave-Event`, `X-Jave-Delivery` (stable
  across retries — dedupe on it), `X-Jave-Timestamp`,
  `X-Jave-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.
  10 s timeout, redirects never followed. 2xx = delivered. 408/425/429/5xx,
  timeouts and network errors retry with backoff (6 attempts); other statuses
  (including 3xx) are final.
- **Auto-disable**: after `OUTBOUND_MAX_CONSECUTIVE_FAILURES` (10) failures in
  a row the subscription is disabled, audited (`integration.outbound_auto_disabled`)
  and `canManageIntegrations` holders get an `integration.alert` notification.
  JAVE-side problems (unreadable secret) fail the delivery without counting.
- `fetch` and DNS resolution are injected through
  `createIntegrationJobHandlers({ fetch, resolveHost })` — no hidden globals.
  Production uses the global `fetch` and `dns.lookup`.

Receivers verify with the same JAVE v1 scheme (`verifyJaveSignature` is exported).

## Events

| Event                                                                | External        | Notes                                      |
| -------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| `integration.account_linked`                                         | no              | subject: the member                        |
| `integration.account_verified`                                       | no              | subject: the member; payload `verified`    |
| `project.github_push`, `project.release_published`, `contribution.*` | see projects.md | emitted while processing GitHub deliveries |

Subscriber: `integrations.outbound_webhooks` (all external events → outbound deliveries).

## Notifications

| Type                     | When                                               |
| ------------------------ | -------------------------------------------------- |
| `integration.alert`      | an outbound webhook was auto-disabled (staff)      |
| `verification.completed` | a linked GitHub account was verified or unverified |
| `contribution.updated`   | a merged PR was recorded (via projects)            |

## Jobs

| Job                             | Kind | Dedupe                          |
| ------------------------------- | ---- | ------------------------------- |
| `integrations.process_delivery` | core | `webhook:<deliveryId>`          |
| `integrations.deliver_outbound` | core | `outbound:<outboundDeliveryId>` |

Deleting an outbound subscription cascades to its deliveries; delivery jobs
still queued for it complete as `{ skipped: 'subscription deleted' }` rather
than dead-lettering.
| `discord.integrations.relay` | Discord contract | `relay:<deliveryId>` |

## Discord job contract: `discord.integrations.relay`

Payload (`relayJobPayloadSchema`): `{ deliveryId, channelId, title (≤ 100), text (≤ 1500) }`.
`title`/`text` are already stripped of control characters and have every
mention neutralized (zero-width space after `@` and `<#`).

The bot must:

1. Validate the payload; dead-letter if invalid.
2. Skip if the delivery already has `relayMessageId` (retry idempotency).
3. Post one `panel()` embed in `channelId`: title = `title`, kicker
   `INTEGRATION`, description = `userText(text)` (markdown escaped), with
   `allowedMentions: { parse: [] }`. No buttons, no pings.
4. Report back with `integrations.markRelayDelivered(ctx, { deliveryId, messageId })`,
   or `integrations.markRelayFailed(ctx, { deliveryId, reason })` for permanent
   failures (unknown channel, missing access). Throw on transient errors so
   the job retries. Both callbacks require the system actor (the worker).

Required Discord permissions in the channel: **View Channel, Send Messages, Embed Links**.

## Audit

`integration.created|updated|enabled|disabled|secret_rotated`,
`webhook.signature_invalid` (durable, denied, rate-capped),
`webhook.delivery_dead`, `webhook.delivery_retried`,
`integration.outbound_created|updated|deleted|secret_rotated|outbound_auto_disabled`,
`external_account.linked|unlinked|verified|unverified`,
`external_account.self_verification_blocked` (durable, denied). Secrets and
full outbound URLs never appear in audit context.

## Extension points

- **Processors**: `DEFAULT_PROCESSORS` has one explicit entry per provider.
  Replace `sidus` (research module) or pass `processors` to
  `createIntegrationJobHandlers`. A processor gets `(ctx, delivery,
integration)` inside the processing transaction and returns
  `{ status: 'processed' | 'ignored', reason }`; throwing retries.
- **Transport**: inject a DNS-pinning `fetch` (e.g. an undici Agent with a
  `lookup` that refuses private answers) to close the rebinding window.
- **Verification**: a GitHub OAuth flow could call
  `setExternalAccountVerification` from a system context.

## Known limitations

- DNS rebinding: the resolved-address check happens just before `fetch`,
  which resolves again; a hostile resolver can still flip answers in between.
  Pin addresses with a custom `fetch` to close it.
- Two different GitHub deliveries with byte-identical bodies are treated as
  duplicates (signature digest, deployment-wide). GitHub payloads are
  practically unique; when an org hook and a repository hook deliver the same
  event body, processing it once is the desired outcome.
- Push and release activity from a linked **private** repository shows up in
  the project's feed (and `project.release_published` goes out through
  outbound webhooks when the project is public). Link only repositories whose
  commit headlines and release names may be shown at the project's visibility.
- A processor's `reason` is stored truncated to 200 characters (`statusReason`).
- The route must pass the raw body exactly as received; re-serialized JSON
  breaks signatures.
- Invalid-signature requests still cost one rate-limit upsert each; put
  IP-level rate limiting in front of `/api/webhooks/*`.
- Self-declared GitHub usernames can be squatted until staff unlink them;
  contributions from unverified accounts stay `submitted` until reviewed.
