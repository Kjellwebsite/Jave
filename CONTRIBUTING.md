# Contributing to JAVE

## Setup

```bash
pnpm install
docker compose up -d          # or any PostgreSQL 16
cp .env.example .env          # fill in the required values (see ENVIRONMENT.md)
pnpm db:migrate
pnpm dev:dashboard            # http://localhost:3000
pnpm dev:bot                  # needs a Discord bot token
```

## Before you push

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Tests need no database server: they run against PGlite (PostgreSQL compiled
to WebAssembly) with the real migrations applied.

Before a release, and in CI, run the same suite against a real Postgres through
the production driver. PGlite accepts things postgres-js rejects, and it runs
one transaction at a time, so only a real server exercises row-lock races:

```bash
JAVE_TEST_BACKEND=postgres \
JAVE_TEST_POSTGRES_URL=postgres://jave_test:jave_test@localhost:5432/postgres \
pnpm test
```

The URL's role needs `CREATEDB`. Each test gets its own database, cloned from a
template that is built once per migration set and dropped when the test ends.
The same variable also enables the `*.pg.test.ts` lock suites on the default
backend.

## How the code is organized

Read `ARCHITECTURE.md` first. The rules that matter most:

1. **Business rules live in `@jave/core`.** The bot and the dashboard are thin
   surfaces over the same service functions. Never duplicate a rule in a surface.
2. **Every service function** validates input (zod), authorizes by capability,
   checks the state machine, writes in a transaction, audits sensitive actions,
   publishes domain events, enqueues side effects and notifies — in that order.
3. **Capabilities, not roles.** Check `canX`, never `role === 'core'`.
4. **Discord side effects are jobs** (`discord.*`), executed by the bot worker
   through the `DiscordGateway` port.
5. **No `process.env` outside `@jave/config`** (and standalone scripts).
6. **No fake completeness.** Mocks are labeled `MOCK / DEVELOPMENT ONLY`;
   unimplemented integrations are recorded as skipped, never reported as done.

## Schema changes

1. Edit the domain's file in `packages/database/src/schema/`.
2. `pnpm db:generate --name <change>` — review the SQL.
3. `pnpm db:check`; commit schema and migration together.

## Tests

- Pure logic: plain unit tests.
- Services: `createTestKit()` from `@jave/core/testing`.
- Bot: `createBotHarness()` from `apps/bot/src/testing/harness.ts`.
- Name adversarial tests `BREAK: …` — privilege escalation, IDOR, self-approval,
  malformed input, replay, concurrency.

## Copy

JAVE speaks concisely, precisely, calmly, slightly futuristic. Uppercase titles,
no emoji spam, no exclamation marks.

> ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.

## Commits

Small, focused commits with a descriptive subject. Never commit secrets.
