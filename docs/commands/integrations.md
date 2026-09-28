# Discord & HTTP: integrations

Feature `apps/bot/src/features/integrations` · custom-id namespace `integrations` ·
domain: `@jave/core` `integrations` (see [docs/modules/integrations.md](../modules/integrations.md)).

## Slash commands

| Command                        | Who                                 | What it does                                                                                                                                                                              |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/github link`                 | yourself (good standing)            | **LINK GITHUB ACCOUNT** modal (username, prefilled when one is linked). Self-declared; changing it resets verification.                                                                   |
| `/github status`               | yourself                            | Your linked account card: username, **VERIFIED ✓** or **SELF-DECLARED ◇**, bound numeric id, with CHANGE USERNAME · UNLINK and a GitHub profile link.                                     |
| `/github verify member:<user>` | `canVerifyMembers` (never yourself) | The member's account card with VERIFY / RE-BIND ID · REVOKE · UNLINK. VERIFY opens a modal for the numeric GitHub user id (from `api.github.com/users/<login>`), which binds the account. |

All replies are ephemeral.

## Buttons and modals

| Custom id                                                                 | Surface               | Handler                                                                                                     |
| ------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `integrations:ghlinkopen`                                                 | LINK ACCOUNT / CHANGE | Opens the link modal for the **clicking** user.                                                             |
| `integrations:ghlink` (modal)                                             | link modal            | `linkGithubAccount` (unique, lowercase; taken usernames are refused).                                       |
| `integrations:ghunlink:<memberId>` → `integrations:ghunlinkok:<memberId>` | UNLINK → confirm      | `unlinkGithubAccount` — yourself, or `canVerifyMembers` for others.                                         |
| `integrations:ghverifyopen:<memberId>`                                    | VERIFY / RE-BIND ID   | Staff only; opens the id modal.                                                                             |
| `integrations:ghverify:<memberId>` (modal)                                | id modal              | `setExternalAccountVerification({ verified: true, externalId })`; self-verification is refused and audited. |
| `integrations:ghrevoke:<memberId>`                                        | REVOKE                | `setExternalAccountVerification({ verified: false })`.                                                      |

The member id in these custom ids is only a routing hint: core authorizes the
clicking user, so a forged UNLINK for someone else is refused.

## Job handler: `discord.integrations.relay`

Posts one sanitized summary of an inbound **generic** delivery to the
integration's `relayChannelId`:

1. validates the payload (`relayJobPayloadSchema`) — invalid → dead-letter;
2. skips if the delivery already has `relayMessageId` (retry idempotency);
3. sends one `panel()` embed — kicker `INTEGRATION`, title and text passed
   through `userText()` (markdown escaped, mentions neutralized), no buttons,
   `allowedMentions: { parse: [] }` — with a message nonce derived from the job
   id (`sendMessageOnce`), so a retry after Discord accepted the post but before
   the callback committed returns that message instead of posting twice;
4. reports `markRelayDelivered`, or `markRelayFailed` + dead-letter on a
   permanent Discord error (unknown channel, missing access); transient
   errors retry with backoff.

**Discord permissions** in the relay channel: View Channel, Send Messages, Embed Links.

## Dashboard: `/integrations` (`canManageIntegrations`)

| Tab          | What                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound      | Registry: provider, enabled state, endpoint URL (copy), secret source, last event/error. ADD INTEGRATION (signing secret shown **once** with a copy button), EDIT (name, relay channel), ROTATE, DISABLE / ENABLE.                              |
| Deliveries   | Inbound log filtered by integration and status: event, status, attempts, reason/error. Selecting a row shows the detail with the payload collapsed (`<details>`), escaped and capped at 20 000 characters; RETRY DELIVERY for failed/dead ones. |
| Outbound     | Subscriptions with masked URLs, event badges, failure streak, auto-disable reason. ADD WEBHOOK (event picker grouped by family, external catalog events only; secret shown once), EDIT, ROTATE, DISABLE / ENABLE, DELETE.                       |
| Outbound log | Deliveries filtered by webhook and status: event, status, HTTP status, attempts, error.                                                                                                                                                         |

Warnings appear when `JAVE_ENCRYPTION_KEY` (secrets cannot be stored) or
`GITHUB_WEBHOOK_SECRET` (GitHub answers 503) is missing — never their values.

## HTTP: inbound webhook routes

| Route                       | Handler                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/webhooks/github` | Integration with slug `github`, verified with `GITHUB_WEBHOOK_SECRET`.            |
| `POST /api/webhooks/{slug}` | Any registered integration (JAVE v1 signature, or GitHub's for GitHub providers). |

GitHub repository or organization webhook settings: **Payload URL** — the
endpoint shown on `/integrations`; **Content type** — `application/json`
(GitHub's default form type is decoded too); **Secret** — the value of
`GITHUB_WEBHOOK_SECRET`; events — pull requests, pushes, releases.

Both call `server/webhooks/inbound.ts`:

1. rate limit — 120 requests per minute per slug and sender address (keyed
   hash, never the raw IP) → `429` with `Retry-After`;
2. size cap — a declared `Content-Length` above 1 MiB is refused before
   reading, and a body stream is cancelled as soon as it passes 1 MiB → `413`;
3. the **raw** body (UTF-8, byte-order mark kept, never parsed or
   re-serialized) and lowercased headers go to `integrations.receiveWebhook`,
   which verifies the signature, replay window and idempotency;
4. the pipeline's status and JSON body are returned with `Cache-Control: no-store`
   (`202` accepted, `200 {duplicate: true}`, `401`, `404`, `400`, `503`).
   A `400` for a verified sender (bad delivery headers, unreadable JSON) also
   sets the integration's last error, shown on the Inbound tab.
   Unexpected failures answer `500 { error: 'internal_error', reference }`.

No session cookie is read; the routes are outside the dashboard's CSRF origin
checks (senders are servers) and are public paths in `proxy.ts`.
