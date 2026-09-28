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
- **Discord Activity users** sign in through the Embedded App SDK: the dashboard exchanges
  Discord's code and answers a short-lived bearer token (below). The Activity holds no secret and
  no cookie.
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

### Discord Activity

- `jave_token`: HMAC-SHA256 over the claims with `JAVE_SESSION_SECRET` under its own purpose
  label, so no other signed value verifies as one. It lives one hour (a token claiming more than
  two is refused), is kept in memory only, and asserts identity only: every request re-resolves
  roles and standing through core, so a ban, quarantine or role change applies on the next
  request.
- Instance scope: a token acts only on game sessions of the Activity instance it was issued for;
  other sessions answer 404 like ones that do not exist. Game moves are re-authorized as the
  player; spectators and non-players cannot move.
- `/api/activity/*` answers `no-store`, accepts JSON only with strict schemas and small body caps,
  and spends shared rate-limit budgets (per Discord account, and a per-IP circuit breaker).
  Responses go through whitelist mappers field by field, so nothing core adds to a view reaches
  the Activity by accident; the Arena board leaves out players whose profile the viewer could not
  open.
- The dev token (`/api/activity/dev-token`) is **MOCK / DEVELOPMENT ONLY**: it answers 404 unless
  dev auth is on outside production, and a dev token stops verifying the moment dev auth is off.
- Accepted limitation: tokens are stateless, so ending dashboard sessions does not end an Activity
  session; it expires within an hour (its authority is already gone on the next request after a
  ban or quarantine). Rotating `JAVE_SESSION_SECRET` ends every Activity session at once. See
  [docs/ACTIVITY.md](docs/ACTIVITY.md#limitations).

### Privacy

- **Export.** Every member can download their own data (dashboard → My profile → Privacy): a JSON
  file of what JAVE shows them about themselves, with staff-only records listed by count.
  Founders (`canManagePrivacy`) can export a member's data for a data-subject request, with a
  reason. Rate-limited and audited (`privacy.exported`). Adversarial records are never included,
  listed or counted.
- **Erasure.** Founders can erase a departed, non-staff member's personal data (reason plus the
  handle typed as confirmation, audited `privacy.erased`): what they wrote is replaced, personal
  rows are deleted, the identity is pseudonymized, and their names are scrubbed from records other
  people received. The Discord ID is kept so a ban stays enforceable; moderation cases, ranks,
  results and the audit log are kept without the name. A test scans every text column of every
  table after erasure. Details: [docs/modules/privacy.md](docs/modules/privacy.md).
- **Sessions.** Members can see and end their dashboard sessions, or sign out everywhere.
  Moderators can end the sessions of accounts ranked below them (reason required, audited); a ban
  ends them automatically. Authority is re-resolved on every request, so a quarantined or banned
  account holds no capability even before its sessions end. Discord Activity tokens are not
  sessions and expire on their own within an hour (see Discord Activity above).

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
