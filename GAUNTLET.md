# GAUNTLET

Live state of the JAVE v0.1 build. A phase is marked `[✓]` only when its tests
pass. Every workstream runs the loop INSPECT → PLAN → IMPLEMENT → RUN → TEST →
BREAK → FIX → REFACTOR → SECURITY AUDIT → RE-TEST → POLISH, followed by an
independent adversarial review and a fix round.

Legend: `[ ]` not started · `[~]` in progress · `[✓]` passed · `[!]` blocked · `[×]` failed

## Environment notes

- `discord.com` is **blocked by this build environment's egress policy**. The bot
  cannot connect to the real gateway here. Discord behaviour is verified through
  the interaction harness (`createBotHarness`), `FakeDiscordGateway` and payload
  validation. A live connection is a deployment-time step (see DEPLOYMENT.md).
- PostgreSQL 16 runs locally. Migrations are verified against it, and the whole
  suite runs on it as well as on PGlite (see "Test backends").

## Test backends

| Backend  | How                                                             | Why                                                                    |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PGlite   | default `pnpm test`                                             | no server needed; one transaction at a time                            |
| Postgres | `JAVE_TEST_BACKEND=postgres JAVE_TEST_POSTGRES_URL=… pnpm test` | production driver (postgres-js), real pool, real row-lock interleaving |

The Postgres backend exposed a production-only bug class: drizzle's postgres-js
adapter disables the driver's Date serializers, so a `Date` bound in a raw `sql`
template failed on every call (for example every rate-limited action) while
passing on PGlite. `serializeRawDates` fixes it for every client, and the
Postgres run is now part of the release gate.

## Phases

| #   | Phase                                                  | Status | Evidence                                                                                                              |
| --- | ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository intelligence                                | [✓]    | Repo was empty (no commits, no assets). Greenfield.                                                                   |
| 1   | Architecture                                           | [✓]    | pnpm monorepo, ARCHITECTURE.md, ServiceContext pattern, capability permissions                                        |
| 2   | Data layer                                             | [✓]    | Drizzle schema per domain, one squashed migration, reference data, DATABASE.md generated                              |
| 3   | Core kernel                                            | [✓]    | audit, transactional outbox, job queue (dedupe, backoff, dead-letter, rerun), settings, notifications                 |
| 4   | Discord bot foundation                                 | [✓]    | router, adapter, gateway port, core commands, worker, health server                                                   |
| 5   | Domain modules (wave 1)                                | [✓]    | 13 workstreams built, reviewed adversarially, fixed; see table below                                                  |
| 6   | Dashboard foundation                                   | [~]    | OAuth + PKCE, sessions, CSP nonce, core pages; independent review pending                                             |
| 7   | Brand kit                                              | [✓]    | emblem, wordmark, server icon, avatar, role icons, render pipeline, visual gauntlet                                   |
| 8   | Surfaces per domain (wave 2)                           | [ ]    | bot commands, `discord.*` job handlers, dashboard pages, seed data                                                    |
| 9   | Discord Activity                                       | [ ]    | Mission Control + JVLN Arena                                                                                          |
| 10  | Gauntlets: security, failure, visual, performance, E2E | [~]    | real-Postgres suite added; remaining gauntlets follow wave 2                                                          |
| 11  | Docs and deployment                                    | [~]    | ARCHITECTURE, SECURITY (draft), ENVIRONMENT, CONTRIBUTING, DATABASE; README/DEPLOYMENT/RUNBOOK/COMMANDS follow wave 2 |

## Wave 1 workstreams

| Workstream              | Built | Review | Fixes merged | Notable review fixes                                                                        |
| ----------------------- | ----- | ------ | ------------ | ------------------------------------------------------------------------------------------- |
| verification            | [✓]   | [✓]    | [✓]          | stacked skill revocation, shared evidence, queue-card races                                 |
| tickets                 | [✓]   | [✓]    | [✓]          | SLA outcome independent of sweep timing, safe card updates, printable transcript            |
| calendar + games        | [✓]   | [✓]    | [✓]          | Discord mirror compare-and-set, reminders, wins, ticks                                      |
| achievements + missions | [✓]   | [✓]    | [✓]          | review findings fixed                                                                       |
| applications            | [✓]   | [✓]    | [✓]          | cooldowns, card render lease, reminders                                                     |
| brand                   | [✓]   | [✓]    | [✓]          | 16px legibility, splash crop, stale PNGs, palette audit                                     |
| moderation              | [✓]   | [✓]    | [✓]          | overturn rule for superseding, quarantine fallback, sync integrity, staff record visibility |
| AI + research           | [✓]   | [✓]    | [✓]          | verified content locked, versioned reviews, billed failures counted                         |
| projects + integrations | [✓]   | [✓]    | [✓]          | repo-link control, visibility on every read, private-repo redaction                         |
| invites + analytics     | [✓]   | [✓]    | [✓]          | referrals matched to a stay (clock skew), concurrent claims, non-enumerable codes           |
| trials                  | [✓]   | [✓]    | [✓]          | editors never compete, scheduled-start checks, rerun-safe Discord re-syncs, reshuffle lock  |
| adversarial             | [✓]   | [ ]    | —            | independent review pending                                                                  |
| dashboard foundation    | [✓]   | [ ]    | —            | independent review pending                                                                  |
