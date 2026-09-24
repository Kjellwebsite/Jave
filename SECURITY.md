# Security

JAVE holds identity, capability evidence, applications, moderation records and
private trial data for JAVELIN. This document describes the threat model, the
controls that exist in code, and how to report a vulnerability.

## Reporting

Report vulnerabilities privately to the JAVELIN core team (a FOUNDER or CORE
member) — never in a public channel. Include reproduction steps. Do not test
against production data you are not authorized to access.

## Assets

| Asset                                                                                            | Where                                          | Sensitivity       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------- |
| Discord bot token, OAuth client secret, session secret, encryption key, AI keys, webhook secrets | Environment only                               | Critical          |
| Applicant data (references, decision reasons)                                                    | `applications`, `application_reviews`          | High              |
| Adversarial trial plans                                                                          | `adversarial_*`                                | High (staff-only) |
| Moderation cases, security events, staff notes                                                   | `mod_cases`, `security_events`, `member_notes` | High              |
| Ticket transcripts and internal notes                                                            | `ticket_messages`                              | High              |
| Capability claims/verifications, rank history                                                    | `member_capabilities`, `rank_history`          | Medium            |
| Dashboard sessions                                                                               | `sessions` (SHA-256 of token only)             | High              |

## Actors and trust boundaries

- **Discord users** reach JAVE through interactions and gateway events. Every
  interaction is re-authorized from the database; custom IDs route but never
  authorize.
- **Dashboard users** authenticate with Discord OAuth2 (state + PKCE). Sessions
  are random 256-bit tokens; only their hash is stored.
- **Integrations** (GitHub, generic webhooks) authenticate with HMAC signatures.
- **AI providers** receive redacted, delimited content and can only _propose_
  actions.
- **Staff** act through capabilities, bounded by the role hierarchy.

## Controls

### Authorization

- Capability-based (`packages/core/src/permissions`); code never checks role names.
- Staff capability sets are strictly nested; members hold no staff capabilities (tested).
- Role hierarchy: only roles strictly below your own are assignable; nobody edits their own roles.
- Self-dealing is blocked and audited: self-verification of capability, self-review
  of applications, self-evaluation in trials, self-approval of contributions/missions.
- Quarantined or banned members lose every capability immediately.
- Access denials are written to the audit log outside the failing transaction.
- IDOR: every read of a specific row checks that the actor may see that row
  (visibility rules for profiles, projects, tickets, applications).

### Least-privilege Discord configuration

- No Administrator permission. The exact permission set and its justification live
  in `apps/bot/src/discord/permissions.ts` and DEPLOYMENT.md.
- All bot messages use `allowedMentions: { parse: [] }`; user-provided text is
  markdown-escaped and mention-neutralized before rendering.
- Staff-only data is only ever sent ephemerally or to staff channels.

### Input handling

- Every service input is validated with zod (types, lengths, URL schemes — only
  `http(s)` URLs are accepted anywhere).
- All SQL goes through Drizzle's parameterized builder; raw `sql` fragments only
  interpolate parameters. LIKE patterns escape wildcards.
- HTML output (ticket transcripts, dashboard) is escaped; React escapes by default
  and no `dangerouslySetInnerHTML` is used for user content.

### Secrets

- Only in the environment, validated at startup, never echoed in errors.
- Logger-level redaction plus audit-context redaction (`kernel/redact.ts`) by key
  name and by value shape (Discord tokens, API keys, GitHub tokens, JWTs, PEM keys).
- Integration secrets at rest are AES-256-GCM encrypted with `JAVE_ENCRYPTION_KEY`.

### Webhooks

- GitHub: `X-Hub-Signature-256` HMAC over the raw body, constant-time comparison.
- Generic: HMAC over `timestamp.body`, ±5 minute replay window.
- Idempotency: `(provider, delivery_id)` unique; redeliveries are acknowledged
  without reprocessing. Body size capped.
- Outbound webhooks: HTTPS only, private/loopback/link-local addresses refused
  (SSRF), signed, retried with backoff, auto-disabled after repeated failures.

### AI

- AI may analyze, summarize, recommend, classify and draft. It can never ban,
  change permissions, modify ranks, delete data or expose private information.
- AI output can only create a pending proposal. A human holding the action's
  capability must confirm it (PREVIEW → CONFIRM → EXECUTE → REPORT); execution is
  audited with the confirming human as actor.
- User content sent to providers is redacted and wrapped as delimited data;
  prompt-injection heuristics flag suspicious inputs. Only a hash of each prompt
  is stored.
- Per-user daily and burst limits.

### Adversarial trials

- Only inside authorized JAVELIN trial environments, with fictional data and
  sandbox accounts. Global kill switch (off by default), per-trial opt-in,
  two-person authorization, sandbox attestation, a scenario validator that
  rejects real-looking secrets, external targets and real personal data, a stop
  word (`RED FLAG`), and mandatory reveal/debrief. Participants cannot read any
  adversarial record.

### Dashboard

- Server-side authorization on every page and server action.
- CSRF: server actions verify Origin; OAuth state is signed and short-lived.
- Security headers: CSP, frame-ancestors none, HSTS (production), strict referrer policy.
- Dev login (`JAVE_DEV_AUTH`) is refused by env validation and at runtime in production.

### Availability

- Per-user interaction rate limits in the bot; DB-backed limits shared across
  processes for login, AI and other expensive endpoints.
- Automod, raid detection and quarantine (see docs/modules/moderation.md).
- Jobs retry with backoff and dead-letter; stuck jobs are recovered.

## Audit log

Sensitive actions record ACTOR · ACTION · TARGET · TIMESTAMP · CONTEXT · RESULT in
`audit_logs` (append-only, redacted). Examples: `role.granted`,
`rank.verified_changed`, `application.decided`, `moderation.case_created`,
`settings.updated`, `ticket.transcript_accessed`, `ai.action_executed`,
`access.denied`, `webhook.signature_invalid`.

## Security gauntlet results

See the final section of GAUNTLET.md for the most recent audit: what was
tested, what was found, and what was fixed.
