# GAUNTLET

How JAVE v0.1 was built and tested. A phase is marked `[✓]` only when its tests
pass. Every workstream ran the loop INSPECT → PLAN → IMPLEMENT → RUN → TEST →
BREAK → FIX → REFACTOR → SECURITY AUDIT → RE-TEST → POLISH, then an independent
adversarial review, then a fix round that verified each finding (reviewers can
be wrong) and fixed the real ones with a test that would have caught them.

Legend: `[ ]` not started · `[~]` in progress · `[✓]` passed · `[!]` blocked · `[×]` failed

## Environment notes

- `discord.com` is **blocked by this build environment's egress policy**. The bot
  cannot connect to the real gateway here. Discord behaviour is verified through
  the interaction harness (`createBotHarness`), `FakeDiscordGateway` and payload
  validation. A live connection is a deployment-time step (DEPLOYMENT.md §6).
- PostgreSQL 16 runs locally. The whole suite runs on it as well as on PGlite.

## Test backends

| Backend  | How                                                             | Why                                                                      |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| PGlite   | default `pnpm test`                                             | no server needed; one transaction at a time                              |
| Postgres | `JAVE_TEST_BACKEND=postgres JAVE_TEST_POSTGRES_URL=… pnpm test` | production driver (postgres-js), real pool, real row-lock interleaving   |
| E2E      | `pnpm test:e2e`, `pnpm test:e2e:activity`                       | production Next.js build (dashboard) against a seeded Postgres, Chromium |

The Postgres backend exposed a production-only bug class: drizzle's postgres-js
adapter disables the driver's Date serializers, so a `Date` bound in a raw `sql`
template failed on every call (for example every rate-limited action) while
passing on PGlite. `serializeRawDates` fixes it for every client, and the
Postgres run is part of the release gate.

## Phases

| #   | Phase                                                  | Status | Evidence                                                                                                                          |
| --- | ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Repository intelligence                                | [✓]    | The repository was empty (no commits, no assets): greenfield.                                                                     |
| 1   | Architecture                                           | [✓]    | pnpm monorepo, ARCHITECTURE.md, ServiceContext pattern, capability permissions                                                    |
| 2   | Data layer                                             | [✓]    | Drizzle schema per domain, one squashed migration, reference data, DATABASE.md generated                                          |
| 3   | Core kernel                                            | [✓]    | audit, transactional outbox, job queue (dedupe, backoff, dead-letter, rerun), settings, notifications                             |
| 4   | Discord bot foundation                                 | [✓]    | router, adapter, gateway port, core commands, worker, health server                                                               |
| 5   | Domain modules (wave 1)                                | [✓]    | 13 workstreams built, reviewed adversarially and fixed (table below)                                                              |
| 6   | Dashboard foundation                                   | [✓]    | OAuth + PKCE, hashed sessions, CSP nonce, core pages; reviewed and fixed                                                          |
| 7   | Brand kit                                              | [✓]    | emblem, wordmark, server icon, avatars, role icons, render pipeline, visual gauntlet                                              |
| 8   | Surfaces per domain (wave 2)                           | [✓]    | bot commands, `discord.*` job handlers, dashboard pages, dev seed; 11 workstreams reviewed and fixed (table below)                |
| 9   | Discord Activity                                       | [✓]    | Mission Control + JVLN Arena, token exchange, instance scope, two-player e2e                                                      |
| 10  | Privacy                                                | [✓]    | member data export, erasure with a whole-schema scan, session control                                                             |
| 11  | Gauntlets: security, failure, visual, performance, E2E | [~]    | see Gauntlets                                                                                                                     |
| 12  | Docs and deployment                                    | [✓]    | README, ARCHITECTURE, SECURITY, DEPLOYMENT, ENVIRONMENT, RUNBOOK, COMMANDS (generated), DATABASE (generated), CONTRIBUTING, docs/ |

## Wave 1: domain modules

| Workstream              | Built | Review | Fixed | Notable review fixes                                                                                         |
| ----------------------- | ----- | ------ | ----- | ------------------------------------------------------------------------------------------------------------ |
| verification            | [✓]   | [✓]    | [✓]   | stacked skill revocation, shared evidence, queue-card races                                                  |
| tickets                 | [✓]   | [✓]    | [✓]   | SLA outcome independent of sweep timing, safe card updates, printable transcript                             |
| calendar + games        | [✓]   | [✓]    | [✓]   | Discord mirror compare-and-set, reminders, wins, ticks                                                       |
| achievements + missions | [✓]   | [✓]    | [✓]   | review findings fixed                                                                                        |
| applications            | [✓]   | [✓]    | [✓]   | cooldowns, card render lease, reminders                                                                      |
| brand                   | [✓]   | [✓]    | [✓]   | 16 px legibility, splash crop, stale PNGs, palette audit                                                     |
| moderation              | [✓]   | [✓]    | [✓]   | overturn rule for superseding, quarantine fallback, sync integrity, staff record visibility                  |
| AI + research           | [✓]   | [✓]    | [✓]   | verified content locked, versioned reviews, billed failures counted                                          |
| projects + integrations | [✓]   | [✓]    | [✓]   | repo-link control, visibility on every read, private-repo redaction                                          |
| invites + analytics     | [✓]   | [✓]    | [✓]   | referrals matched to a stay (clock skew), concurrent claims, non-enumerable codes                            |
| trials                  | [✓]   | [✓]    | [✓]   | editors never compete, scheduled-start checks, rerun-safe Discord re-syncs, reshuffle lock                   |
| adversarial             | [✓]   | [✓]    | [✓]   | second approver for later triggers, authorization tied to the plan revision, audit never names it pre-reveal |
| dashboard foundation    | [✓]   | [✓]    | [✓]   | review findings fixed; sign-in atomicity tested on both backends                                             |

## Wave 2: surfaces

Each workstream built the Discord flows, the `discord.*` job handlers and the
dashboard pages over the wave 1 core, with e2e specs and screenshots, and ran
both test backends before an independent review.

| Workstream              | Built | Review | Fixed | Notable review fixes                                                                                                                              |
| ----------------------- | ----- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| applications            | [✓]   | [✓]    | [✓]   | stale withdrawals refused by compare-and-set, unsaved drafts never lost on submit, evidence always round-trips a modal, lost queue cards reposted |
| moderation              | [✓]   | [✓]    | [✓]   | bot targets, report cards, edit screening, Discord state, settings links, mobile triage                                                           |
| tickets                 | [✓]   | [✓]    | [✓]   | idle threads, resumable closes, own-ticket SLA, history and MANAGE                                                                                |
| trials + adversarial    | [✓]   | [✓]    | [✓]   | who typed the stop word decides what it does, in-place views only for private messages, granted rank shown, observation subjects                  |
| AI + research           | [✓]   | [✓]    | [✓]   | link limits, untrusted task source, store fairness, ledger scale, queue paging, DOI hardening                                                     |
| platform                | [✓]   | [✓]    | [✓]   | stored settings survive schema changes, elevated role mapping needs authority, fresh role sync, retired roles, staff-only channels                |
| events + games          | [✓]   | [✓]    | [✓]   | edit times, board visibility, Discord start                                                                                                       |
| projects + integrations | [✓]   | [✓]    | [✓]   | GitHub form deliveries, picker, add by handle, phone toolbar                                                                                      |
| invites + analytics     | [✓]   | [✓]    | [✓]   | a re-sync between join and member add no longer absorbs the use, campaign deletion and detach decided by core, paged campaign cards               |
| achievements + missions | [✓]   | [✓]    | [✓]   | hidden achievements masked in shared panels, Discord's 512-character button link limit, scoped review queues, deadlines in the viewer's zone      |
| Discord Activity        | [✓]   | [✓]    | [✓]   | lobby choices, token refresh budget, poll ordering, UI accuracy                                                                                   |

## Gauntlets

### Security

[~] The final audit (five attack surfaces, each finding verified by a skeptic) is
running; results and fixes follow here.

### Failure

| Scenario                                     | Where                                                           | Result                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord outage, then recovery                | `apps/bot/src/gauntlet/discord-outage.test.ts`                  | Work continues in JAVE; side effects back off and converge exactly once; an outage past the retry budget dead-letters and a retry completes it. |
| Database connections killed                  | `packages/core/src/gauntlet/database-outage.test.ts` (Postgres) | Services keep working on fresh connections; a job whose connection dies mid-run retries and takes effect once.                                  |
| Worker crash mid-job                         | `packages/core/src/jobs/jobs.test.ts`                           | The lease expires after 5 minutes; the job runs again.                                                                                          |
| Permanent Discord errors                     | per-feature job tests                                           | Dead-letter at once; nothing half-applied; staff notified where it matters.                                                                     |
| AI provider down, slow, refusing, overloaded | `packages/core/src/ai/features.test.ts`                         | Calm message, request recorded, nothing else affected.                                                                                          |
| Settings stored before a schema change       | `packages/core/src/settings`                                    | Recovered field by field; invalid field names logged, never values.                                                                             |

### Performance

`packages/core/src/gauntlet/performance.test.ts` (Postgres) seeds 20,000
members, 300,000 notifications, audit entries, domain events and AI requests,
200,000 finished jobs and a join (and for one in ten, a leave) per member, captures the SQL
the services really run on the hot read paths (19 of them, analytics overview
and JAVELIN progress included), EXPLAINs each statement and fails on a
sequential scan over a table that grows without bound or a read slower than
250 ms. It found the job-queue statistics scanning every finished job and
unbounded counts on the audit log; both were fixed (status-filtered stats,
capped counts, audit indexes) and housekeeping now prunes operational rows
daily.

### Member lifecycle

`packages/core/src/gauntlet/member-lifecycle.test.ts` follows one member
across the modules with the real core job handlers: arrival, application
(draft, submit, review, accept), a trial (team, submission, evaluation,
results, verified rank), a mission, a project contribution that ships, a
support ticket and a moderation warning; then a week passes so reminders,
sweeps and retention jobs run. It checks the member's record, their
notifications, that every job succeeded and that the audit trail names each
decision.

### End to end

[~] The final run over the merged tree follows the security fixes. The dashboard
suite (20 specs) and the Activity suite (two players in one instance) run
against a seeded Postgres.

### Visual

Every dashboard page was captured at 1440 and 390 px (375 px for some), viewed
and critiqued for at least two rounds; the specs fail on horizontal overflow.
The Activity was captured at 1280 × 720 and 390 × 844. Finals are in
`docs/screenshots/`. The brand kit had its own contact-sheet rounds (16 px
legibility, splash crop, palette audit).

### Privacy

Erasure is tested by scanning every text, varchar, JSON and array column of
every table (built from the schema) for what a member wrote and their names;
only completed job payloads (pruned in 14 days) may still match. See
docs/modules/privacy.md.
