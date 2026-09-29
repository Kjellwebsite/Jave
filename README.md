<p align="center">
  <img src="packages/brand/assets/svg/lockup.svg" alt="JAVELIN" width="360">
</p>

# JAVE

**The operating layer of JAVELIN.** _You think you're elite? Prove it._

JAVE runs a Discord-native organization for ambitious builders, researchers,
founders and athletes: who is in it, what each person can demonstrably do, how
they get in, how they prove themselves, and how the organization keeps itself
safe. It is three surfaces over one data layer:

| Surface                                | What it is for                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Discord bot** (`apps/bot`)           | Where members live: applications, trials, missions, projects, events, tickets, moderation, AI, games. |
| **Dashboard** (`apps/dashboard`)       | The operations console: queues, reviews, evaluation, moderation, analytics, settings, the audit log.  |
| **Discord Activity** (`apps/activity`) | Mission Control (your profile, missions, trial countdown, events) and JVLN Arena (live trivia).       |

<p align="center">
  <img src="docs/screenshots/overview-1440.png" alt="Dashboard overview" width="860">
</p>

## What it does

- **Identity and capability.** Every member has a JVLN profile with ranks per
  capability facet (F → S) in five domains (Mind, Create, Body, Life, Bio).
  Ranks are **CLAIMED**, **VERIFIED** or **UNKNOWN**, never blended into one
  score, and nobody verifies themselves. Discord activity never becomes
  capability.
- **Getting in.** Applications with drafts, reviews, interviews and decisions;
  verification requests with evidence; referrals and invite attribution.
- **Proving it.** Trials (teams, private channels, sealed submissions, rubric
  evaluation, published results, explicit rank consequences), missions,
  projects with verified contributions, achievements that mean something.
- **Keeping it safe.** Moderation cases with a hierarchy (nobody acts on their
  equals), automod, join screening and raid mode, quarantine, and an
  append-only audit log of every sensitive action.
- **Security-culture exercises.** Optional, two-person-authorized adversarial
  roles inside trials: fictional data, sandbox accounts, a stop word, a
  mandatory reveal. Off by default; never aimed at real people or systems.
- **AI that proposes, never acts.** JAVE AI answers, summarizes and drafts; any
  action it suggests is a preview a human with the right capability confirms.
- **Operations.** Tickets with SLAs and transcripts, events and tournaments,
  analytics of organizational health (not engagement), webhooks in and out,
  a research library, member data export and erasure.

## Quick start

**Just want to run it on your own computer?** One line installs everything (its own Node.js and
a built-in PostgreSQL, no Docker) and asks for the four Discord values once:

```bash
# Windows (PowerShell)
irm https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.ps1 | iex
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.sh | bash
```

In a clone, `node start.mjs` does the same. Step by step, in German: [START-HIER.md](START-HIER.md).

For development:

Requirements: Node.js 22.12+, pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
docker compose up -d                 # PostgreSQL 16 on localhost:5432
cp .env.example .env                 # set DISCORD_CLIENT_ID, DISCORD_GUILD_ID, JAVE_SESSION_SECRET;
                                     # JAVE_DEV_AUTH=true for local sign-in
pnpm db:migrate
pnpm db:seed                         # a populated JAVELIN to explore (development only)
pnpm dev:dashboard                   # http://localhost:3000 → sign in as a dev persona
```

Every script reads the root `.env` in development (see [ENVIRONMENT.md](ENVIRONMENT.md)).
`JAVE_DEV_AUTH=true` enables **MOCK / DEVELOPMENT ONLY** persona sign-in (founder, core,
operations, moderator, verified, member), so the dashboard works without a Discord application:
any 17–20 digit IDs will do for `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`. It is refused in
production.

The bot needs a real Discord application: see [DEPLOYMENT.md](DEPLOYMENT.md)
(permissions, intents, commands) and run `pnpm dev:bot`. The Activity runs
standalone against the dashboard with `pnpm dev:activity`
([docs/ACTIVITY.md](docs/ACTIVITY.md#local-development)).

## Checks

```bash
pnpm check                           # typecheck, lint, unit and integration tests (PGlite)
JAVE_TEST_BACKEND=postgres \
JAVE_TEST_POSTGRES_URL=postgres://jave_test:jave_test@localhost:5432/postgres \
pnpm test                            # the same suite on a real PostgreSQL (release gate)
pnpm test:e2e                        # dashboard end-to-end (Playwright, seeded Postgres)
pnpm test:e2e:activity               # Discord Activity end-to-end (two players, standalone dev mode)
pnpm format:check
```

## Repository

```
apps/
  bot/          Discord gateway, interactions, Discord side-effect jobs, worker, health server
  dashboard/    Next.js console, public profiles, OAuth, webhooks, Activity API
  activity/     Discord Activity (Vite + React + Embedded App SDK)
packages/
  core/         every business rule, permission check, audit entry and state transition
  database/     Drizzle schema, migrations, reference data, test databases
  ai/           provider-agnostic AI layer (Anthropic, OpenAI, OpenAI-compatible, mock)
  ui/           JAVELIN design system (tokens, fonts, React primitives)
  brand/        emblem, wordmark, role icons, avatars and their render pipeline
  config/       environment schemas: the only place process.env is read
docs/           per-module rules, per-feature command pages, design system, screenshots
```

## Documentation

| Document                             | For                                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)   | How the system is built and why                                 |
| [COMMANDS.md](COMMANDS.md)           | Every Discord command and context menu (generated)              |
| [DEPLOYMENT.md](DEPLOYMENT.md)       | Discord application, permissions, containers, release order     |
| [ENVIRONMENT.md](ENVIRONMENT.md)     | Every environment variable                                      |
| [RUNBOOK.md](RUNBOOK.md)             | Operating it: health, dead letters, incidents, secret rotation  |
| [SECURITY.md](SECURITY.md)           | Threat model, controls, privacy, reporting                      |
| [DATABASE.md](DATABASE.md)           | Every table and column (generated)                              |
| [CONTRIBUTING.md](CONTRIBUTING.md)   | Setup, conventions, schema changes                              |
| [GAUNTLET.md](GAUNTLET.md)           | How it was built and tested, phase by phase                     |
| [docs/DESIGN.md](docs/DESIGN.md)     | The design system                                               |
| [docs/ACTIVITY.md](docs/ACTIVITY.md) | The Discord Activity: portal configuration, development, limits |
| `docs/modules/*.md`                  | Rules of each domain module                                     |
| `docs/commands/*.md`                 | Each feature's Discord and dashboard flows                      |

## Status

Version 0.1. Everything up to the Discord boundary is tested: an interaction
harness drives the real router, a fake gateway stands in for Discord, and every
payload is validated. The build environment could not reach `discord.com`, so the
first live gateway connection happens at deployment; DEPLOYMENT.md §6 lists how
to verify it.
