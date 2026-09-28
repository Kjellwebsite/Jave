# JAVE Architecture

JAVE is the operating layer of JAVELIN: a Discord bot, an operations dashboard and a
Discord Activity sharing one relational data layer and one domain layer.

```
                    JAVE
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   apps/bot     apps/dashboard  apps/activity
  (discord.js)    (Next.js)     (Vite + Embedded App SDK)
       │             │             │
       └──────┬──────┴──────┬──────┘
              │             │
         @jave/core     @jave/ui
    (domain services,   (design system)
     permissions, audit,
     events, jobs)
              │
        @jave/database ── PostgreSQL
     (Drizzle schema + migrations)
```

## Repository layout

| Path                | Purpose                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/config`   | Environment schemas (zod). The only place `process.env` is interpreted.                                         |
| `packages/database` | Drizzle schema (one file per domain), SQL migrations, reference data, PGlite test harness.                      |
| `packages/core`     | Domain layer: every business rule, permission check, audit entry and state transition. No Discord or HTTP code. |
| `packages/ai`       | Provider-agnostic AI layer (`AIProvider`, `AIRequest`, `AIResponse`, `AIContext`, `AIUsage`).                   |
| `packages/ui`       | JAVELIN design system: tokens, fonts, React primitives, emblem.                                                 |
| `apps/bot`          | Discord gateway client, interaction router, Discord side-effect job handlers, job worker, health server.        |
| `apps/dashboard`    | Next.js operations dashboard, public profiles, OAuth, inbound webhooks, Activity token exchange.                |
| `apps/activity`     | Discord Activity (Embedded App SDK) front-end.                                                                  |

The monorepo uses pnpm workspaces. Internal packages export TypeScript source
(`"exports": { ".": "./src/index.ts" }`); apps compile them (Next.js via
`transpilePackages`, the bot via an esbuild bundle).

## Single-tenant by design

JAVE runs one organization (JAVELIN) bound to one Discord guild
(`DISCORD_GUILD_ID`). Entities are not partitioned by guild. This keeps every
query and authorization rule simple; a staging guild uses a separate database.

## The domain layer (`@jave/core`)

### ServiceContext

Every service function takes a `ServiceContext` as its first argument. There is
no global state.

```ts
interface ServiceContext {
  db: Database; // current executor (a transaction inside withTransaction)
  rootDb: Database; // never a transaction — for writes that must survive rollback
  actor: Actor; // user | system | integration | anonymous
  clock: Clock; // injectable time (ManualClock in tests)
  logger: Logger; // pino child logger carrying requestId
  requestId: string;
  effects: { jobIds: number[] }; // jobs enqueued during this unit of work
  cache: TtlCache; // per-process cache (settings, catalog)
  config: CoreConfig; // founder bootstrap ids, public URL, encryption key
}
```

The bot builds one per interaction, the dashboard one per request, the worker
one per job (system actor).

### Service function conventions

A service function:

1. validates input with a zod schema via `parseInput(schema, input)` → `ValidationError`
2. authorizes with `await authorize(ctx, 'canX', target)` (or a self-check via `isSelf`)
3. loads state and checks the state machine → `NotFoundError` / `InvalidStateError`
4. writes inside `withTransaction(ctx, async (tx) => …)` when more than one row changes
5. records `recordAudit(tx, …)` for sensitive actions
6. publishes `publishEvent(tx, …)` for meaningful state changes
7. enqueues side effects with `enqueueJob(tx, 'discord.…', payload, { dedupeKey })`
8. notifies with `notify(tx, …)` (dedupe keyed on the underlying fact)

Everything in steps 4–8 commits or rolls back together (transactional outbox).

Services never import discord.js, Next.js, or read `process.env`.

### Errors

`JaveError` subclasses carry a stable `code` and a user-safe message:
`ValidationError`, `NotFoundError`, `ForbiddenError`, `UnauthenticatedError`,
`ConflictError`, `InvalidStateError`, `RateLimitedError`, `ExternalServiceError`,
`DisabledError`. Anything else is unexpected: the surface (bot/dashboard) logs it
with an error ID (`E-XXXXXXXX`) and shows the user only the ID.

### Permissions

Code checks **capabilities**, never role names. `permissions/capabilities.ts`
is the single source of truth for role → capability grants.

- Roles: FOUNDER › CORE › OPERATIONS › MODERATOR › VERIFIED › TRIAL › APPLICANT › MEMBER › SUPPORTER.
- Staff capability sets are strictly nested (tested).
- Role assignment follows a hierarchy: you manage only roles strictly below your
  highest role (founders manage all); nobody changes their own roles.
- Progression roles (member/applicant/trial/verified) are mutually exclusive.
- Standing `quarantined`/`banned` removes all capabilities; `restricted` keeps
  only `canViewMembers`.
- Denials are audited durably (outside the transaction) as `access.denied`.
- JAVE is the source of truth for roles; Discord roles are synchronized from it
  (`discord.roles.sync` job). Founders are bootstrapped from
  `JAVE_FOUNDER_DISCORD_IDS`.

### Identity & ranking

- Capability catalog is data: `rank_tiers` (F…S, ordinal-based — S+/SS are
  future rows), `capability_domains` (Mind, Create, Body, Life, Bio) and
  `capability_facets` (Reasoning, Knowledge, Research, Technical, Creative,
  Projects, Physical, Business, Execution, Optimization).
- `member_capabilities` stores **claimed** and **verified** ranks separately.
  Status is VERIFIED / CLAIMED / UNKNOWN.
- A domain's displayed rank is its **peak** facet rank. There is deliberately
  no cross-domain aggregate score.
- Nobody can verify their own capability (enforced + audited).
- Every change is appended to `rank_history` with source, reason, evidence and actor.
- Discord activity never becomes capability.

### Domain events (outbox)

`publishEvent(ctx, { type, aggregateType, aggregateId, subjectMemberId, payload })`
inserts into `domain_events` and enqueues `events.dispatch` in the same
transaction. The worker fans out one `events.deliver` job per matching
subscriber (achievements, notifications, analytics, outbound webhooks), so a
failing subscriber retries in isolation. Subscribers must be idempotent.
Event types are declared in `events/catalog.ts`; `external: false` events never
leave JAVE.

### Job queue

Postgres-backed (`jobs` table, `FOR UPDATE SKIP LOCKED`) — no Redis.

- `enqueueJob(ctx, type, payload, { runAt, delayMs, dedupeKey, maxAttempts })`
- at most one live job per `dedupeKey`
- `rerunIfRunning` (with `dedupeKey`) for jobs that re-sync from current state:
  a same-key enqueue while the job runs makes it run once more when it ends,
  instead of being dropped; a pending job is row-locked until the caller
  commits, so it cannot run before the change is visible
- exponential backoff (10 s → 1 h cap), dead-letter after `maxAttempts`
- `PermanentJobError` and non-retryable `JaveError`s dead-letter immediately
- stale leases (worker crash) are recovered after 5 minutes
- `enqueueRecurring` schedules periodic work once per time bucket
- `Worker.runNow(ids)` lets the bot execute the Discord side effects of the
  interaction that just committed, immediately

Only the bot process runs a worker. The dashboard enqueues; the bot executes.
Job types prefixed `discord.` are Discord side effects handled in `apps/bot`.

`system.housekeeping` runs daily and prunes operational rows in bounded batches
(finished jobs, ended sessions, rate-limit buckets, webhook delivery logs; see
RUNBOOK.md). The organization's record (audit log, cases, ranks, results) is
never pruned. Queue statistics read only live and dead jobs, through the status
index, so they stay cheap however many finished jobs accumulate.

### Settings

`server_settings` holds one validated JSON document per section (branding,
roles, channels, moderation, security, tickets, applications, trials, ai,
integrations, notifications, analytics). Every field has a default, so an
empty database works. Updates are validated, audited with a field-level diff
and invalidate the per-process cache. Secrets never live in settings.

### Pagination and counts

List services take `limit`/`offset` and return `{ items, total }`. On tables that
grow without bound (audit log, jobs) the total is **capped**: `cappedCount`
counts at most 10,000 rows past the offset and the page reports
`totalCapped: true`, so a deep filter never scans the whole table; the UI shows
`10,000+`.

### Privacy

`privacy` exports a member's own data (founders: anyone's, with a reason),
erases a departed member's personal data while keeping the organization's
record pseudonymous, and controls dashboard sessions. Erasure is one
transaction that scrubs names from kept records, replaces what the member wrote,
deletes personal rows and pseudonymizes the identity; the Discord ID stays so a
ban holds. See docs/modules/privacy.md.

### Notifications

`notify(ctx, { recipientUserId, type, title, body, dedupeKey })` writes the
dashboard inbox row and one delivery per enabled push channel. Quiet hours
(per-user timezone) defer non-critical deliveries. Email/webhook channels are
extension points: recorded as `skipped` until a provider exists.

## Data layer (`@jave/database`)

- PostgreSQL 16, Drizzle ORM, SQL migrations in `packages/database/drizzle`.
- One schema file per domain in `src/schema/`.
- UUID primary keys; human-facing sequential numbers (APP-0042, #0042 tickets,
  case numbers) via identity columns.
- Discord IDs stored as `varchar(20)`.
- Timestamps are `timestamptz`; soft deletion (`deleted_at`) on members,
  projects, evidence, research items.
- Partial unique indexes encode invariants (one open application per user, one
  active role grant per member/role, one live job per dedupe key).
- `pnpm db:migrate` applies migrations and idempotent reference data.
- Tests run against **PGlite** (Postgres compiled to WASM) with the committed
  migrations applied — real SQL, no mocks, no server required — and, with
  `JAVE_TEST_BACKEND=postgres`, against a real PostgreSQL 16 through the
  production driver (postgres-js), one database per test cloned from a template
  per migration set. Both are release gates: PGlite runs one transaction at a
  time, so only the real server exercises row-lock races, and it accepts
  values postgres-js rejects.

## Testing

- `pnpm test` runs every package's Vitest project.
- `createTestKit()` (`@jave/core/testing`) gives an isolated database, a manual
  clock, a system context, member factories with roles, and `drain(handlers)`
  to run the job queue.
- Tests prefixed `BREAK:` are adversarial: they try privilege escalation,
  self-verification, injection-shaped input, and similar.
- **Gauntlet suites** (`packages/core/src/gauntlet`): one member's whole path
  through the organization with every job handler and subscriber running
  (seams between modules), and a real-Postgres performance gauntlet that seeds
  volume and checks the query plans and latency of the hot read paths.
- The privacy erasure test scans every text column of every table, built from
  the schema, so a new table that stores personal text is caught.
- Bot: `createBotHarness()` (below). Dashboard: Vitest for server code and
  Playwright end-to-end specs against a production build and a real, seeded
  PostgreSQL database (`pnpm test:e2e`), including a visual gauntlet at 1440 and
  390 px that fails on horizontal overflow.
- `COMMANDS.md` is generated from the command definitions; a test fails when it
  drifts.

## Security principles

- Least privilege everywhere: capabilities, Discord permissions, AI authority.
- AI can only propose; humans confirm (PREVIEW → CONFIRM → EXECUTE → REPORT).
- Secrets only from the environment; redacted from logs, audit context and AI prompts.
- Every sensitive action is audited with actor, action, target, time, context, result.
- Inbound webhooks: signature verification, replay window, idempotency keys.

See `SECURITY.md` for the full threat model.

## Discord bot (`apps/bot`)

```
discord.js client ──► adapter ──► InteractionRouter ──► feature handler ──► @jave/core services
       │                                  │                                     │
       │                                  └─ runJobsNow(ctx.effects.jobIds) ◄────┘ (jobs enqueued in the tx)
       │
       └─► gateway events ──► GatewayDispatcher ──► feature listeners (isolated)
Worker (same process) ──► core job handlers + feature 'discord.*' handlers ──► DiscordGateway
```

- **InteractionContext** (`interactions/types.ts`) is JAVE's own interaction
  abstraction. Handlers never touch discord.js objects; `adapter.ts` translates,
  and tests use `FakeInteraction` which enforces Discord's response rules.
- **InteractionRouter** applies a uniform envelope to every interaction: home-guild
  guard → per-user rate limit (12/10 s) → identity sync (`syncDiscordUser` +
  `resolveUserActor`) → optional `requires` capability gate → optional defer →
  handler → error rendering (JaveError → safe message; anything else → error ID
  only) → immediate execution of the Discord jobs the handler enqueued.
- **Features** (`features/<domain>/index.ts`) are the unit of composition:
  `{ commands, components, modals, jobHandlers(services), onMessage, onMemberJoin, … }`.
  `features/index.ts` composes them; `/help` is generated from the live catalog.
- **Custom IDs** are `namespace:action:args` (≤ 100 chars). They route; they never
  authorize. Every component handler re-checks the clicking user through core services.
- **DiscordGateway** (`discord/gateway.ts`) is the only way handlers act on Discord.
  `DiscordJsGateway` implements it; `FakeDiscordGateway` records calls for tests.
  Discord failures are normalized to `DiscordActionError` with a `permanent`
  flag so jobs dead-letter instead of retrying hopeless calls.
- **Discord side effects are jobs.** Core services enqueue `discord.*` jobs; the
  bot's worker runs them (immediately after an interaction via `runNow`, otherwise
  on its poll loop). Handlers are idempotent and report back through core callbacks.
- **UI kit** (`ui/`): `panel()` embeds (uppercase titles, kicker line, JAVELIN
  footer), `button/linkButton/row/stringSelect`, `rankMark()` (`S ✓` verified,
  `A ◇` claimed, `—` unknown), `userText()` which escapes markdown and neutralizes
  mentions in any user-provided text. All automated messages use
  `allowedMentions: { parse: [] }`.
- **Replies** are ephemeral unless the content is meant for the channel; staff-only
  data is never posted publicly.
- **Health**: `/healthz` (liveness) and `/readyz` (Discord and database are
  critical; queue and AI degrade the report without failing readiness) on
  `BOT_HEALTH_PORT`; `/jave status` renders the same report.
- **Build**: esbuild bundles the bot and all dependencies into `dist/main.mjs`;
  the container needs only Node.js.
- **Testing**: `createBotHarness()` = TestKit + FakeDiscordGateway + the real app
  composition. `bot.run({ kind, name, user, options })` drives the router exactly
  as Discord would.

## Dashboard (`apps/dashboard`)

- **Reads** are React Server Components calling core services with the
  request's `ServiceContext` (session cookie → hashed session row → actor with
  current roles and standing, resolved on every request).
- **Writes** are Server Actions wrapped in `runAction`: same-origin check, a live
  session, then core. Authorization happens in core, never in the UI; controls
  are hidden by capability only as a convenience.
- **Downloads** (ticket transcripts, data exports) are `POST` route handlers:
  same-origin check, small-body limit, then core authorizes and audits; the
  response is an attachment with `no-store`, `nosniff` and a sandboxing CSP.
- **Inbound webhooks** (`/api/webhooks/*`) read the raw body, cap its size, and
  hand it to core, which verifies the signature before parsing anything.
- **Sign-in** is Discord OAuth2 with state and PKCE; sessions are random 256-bit
  tokens of which only a SHA-256 hash is stored. `JAVE_DEV_AUTH` persona login
  exists for development and tests only and is refused in production.
- **Security headers**: per-request CSP nonce with `strict-dynamic`,
  `frame-ancestors 'none'`, HSTS in production, strict referrer policy.
- **Errors**: domain errors show their user-safe message; anything else shows an
  8-character reference that is also logged next to the stack trace.
