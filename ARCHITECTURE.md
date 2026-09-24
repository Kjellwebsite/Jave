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

| Path | Purpose |
| --- | --- |
| `packages/config` | Environment schemas (zod). The only place `process.env` is interpreted. |
| `packages/database` | Drizzle schema (one file per domain), SQL migrations, reference data, PGlite test harness. |
| `packages/core` | Domain layer: every business rule, permission check, audit entry and state transition. No Discord or HTTP code. |
| `packages/ai` | Provider-agnostic AI layer (`AIProvider`, `AIRequest`, `AIResponse`, `AIContext`, `AIUsage`). |
| `packages/ui` | JAVELIN design system: tokens, fonts, React primitives, emblem. |
| `apps/bot` | Discord gateway client, interaction router, Discord side-effect job handlers, job worker, health server. |
| `apps/dashboard` | Next.js operations dashboard, public profiles, OAuth, inbound webhooks, Activity token exchange. |
| `apps/activity` | Discord Activity (Embedded App SDK) front-end. |

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
  db: Database;        // current executor (a transaction inside withTransaction)
  rootDb: Database;    // never a transaction — for writes that must survive rollback
  actor: Actor;        // user | system | integration | anonymous
  clock: Clock;        // injectable time (ManualClock in tests)
  logger: Logger;      // pino child logger carrying requestId
  requestId: string;
  effects: { jobIds: number[] }; // jobs enqueued during this unit of work
  cache: TtlCache;     // per-process cache (settings, catalog)
  config: CoreConfig;  // founder bootstrap ids, public URL, encryption key
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
- exponential backoff (10 s → 1 h cap), dead-letter after `maxAttempts`
- `PermanentJobError` and non-retryable `JaveError`s dead-letter immediately
- stale leases (worker crash) are recovered after 5 minutes
- `enqueueRecurring` schedules periodic work once per time bucket
- `Worker.runNow(ids)` lets the bot execute the Discord side effects of the
  interaction that just committed, immediately

Only the bot process runs a worker. The dashboard enqueues; the bot executes.
Job types prefixed `discord.` are Discord side effects handled in `apps/bot`.

### Settings

`server_settings` holds one validated JSON document per section (branding,
roles, channels, moderation, security, tickets, applications, trials, ai,
integrations, notifications, analytics). Every field has a default, so an
empty database works. Updates are validated, audited with a field-level diff
and invalidate the per-process cache. Secrets never live in settings.

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
  migrations applied — real SQL, no mocks, no server required.

## Testing

- `pnpm test` runs every package's Vitest project.
- `createTestKit()` (`@jave/core/testing`) gives an isolated database, a manual
  clock, a system context, member factories with roles, and `drain(handlers)`
  to run the job queue.
- Tests prefixed `BREAK:` are adversarial: they try privilege escalation,
  self-verification, injection-shaped input, and similar.

## Security principles

- Least privilege everywhere: capabilities, Discord permissions, AI authority.
- AI can only propose; humans confirm (PREVIEW → CONFIRM → EXECUTE → REPORT).
- Secrets only from the environment; redacted from logs, audit context and AI prompts.
- Every sensitive action is audited with actor, action, target, time, context, result.
- Inbound webhooks: signature verification, replay window, idempotency keys.

See `SECURITY.md` for the full threat model.
