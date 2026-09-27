# Deployment

JAVE runs as three processes on one PostgreSQL database:

| Process   | What it is                                          | Scales                          | Image / artifact                    |
| --------- | --------------------------------------------------- | ------------------------------- | ----------------------------------- |
| Bot       | Discord gateway, interactions, **job worker**       | exactly one per guild (gateway) | `apps/bot/Dockerfile`               |
| Dashboard | Next.js operations console, OAuth, webhooks, API    | horizontally (stateless)        | `apps/dashboard/Dockerfile`         |
| Activity  | Static Discord Activity (Vite build) behind Discord | static hosting / CDN            | `apps/activity` build (ACTIVITY.md) |

All business rules live in `@jave/core`; the processes are thin surfaces. Side
effects in Discord are queued as `discord.*` jobs and executed by the bot's
worker, so the dashboard never needs a Discord gateway connection.

> Build environment note: this repository was built in a sandbox where
> `discord.com` is unreachable. Everything up to the Discord boundary is tested
> (interaction harness, fake gateway, payload validation); the first live
> connection happens during your deployment. Follow "Verify" below.

## 1. Database

- PostgreSQL **16** (managed is fine: Supabase, Neon, RDS, Cloud SQL). Use the
  pooled connection string for the dashboard when the host offers one.
- One database for everything. Migrations live in
  `packages/database/drizzle` and are applied by the release step, never by
  application start-up.
- Backups: enable point-in-time recovery. The audit log, rank history and
  moderation cases are the organization's record; treat them as such.

```bash
DATABASE_URL=postgres://… pnpm db:migrate        # from a checkout
docker run --rm -e DATABASE_URL=… jave-bot node dist/migrate.mjs   # from the bot image
```

The migration runner is idempotent and also applies reference data (rank
tiers, capability facets, starter catalogs). Run it before every rollout.

## 2. Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **General Information** → copy the Application ID → `DISCORD_CLIENT_ID`.
2. **Bot** → Reset Token → `DISCORD_TOKEN` (secret). Enable the privileged
   intents **Server Members** and **Message Content** (automod, ticket
   transcripts, join screening). Disable "Public Bot".
3. **OAuth2** → Client Secret → `DISCORD_CLIENT_SECRET` (secret). Add the
   redirect `${JAVE_PUBLIC_URL}/api/auth/callback`.
4. Invite the bot with the URL printed by
   `DISCORD_CLIENT_ID=… pnpm --filter @jave/bot exec tsx src/scripts/print-commands.ts`
   (no network needed). It requests exactly the permissions below — **never
   Administrator**.
5. Drag the bot's role **above** every role JAVE manages (mapped JAVE roles,
   the quarantine role). Discord only lets a bot manage roles below its own.
6. Register slash commands: `DISCORD_TOKEN=… DISCORD_CLIENT_ID=… DISCORD_GUILD_ID=… pnpm commands:deploy`.
   Re-run after every release that changes commands (guild-scoped, instant).

### Least-privilege permissions

| Permission               | Why JAVE needs it                                   |
| ------------------------ | --------------------------------------------------- |
| View Channels            | Read channels JAVE operates in.                     |
| Send Messages            | Post cards, announcements and alerts.               |
| Send Messages in Threads | Reply inside ticket threads.                        |
| Embed Links              | Render embeds.                                      |
| Attach Files             | Upload ticket transcripts.                          |
| Read Message History     | Edit its own cards; ticket transcripts.             |
| Manage Roles             | Sync JAVE roles to Discord and apply quarantine.    |
| Manage Channels          | Create private trial team channels.                 |
| Create Private Threads   | Open private ticket threads.                        |
| Manage Threads           | Lock and archive ticket threads.                    |
| Manage Messages          | Delete automod-flagged messages.                    |
| Moderate Members         | Time out members (moderation cases, automod).       |
| Kick Members             | Kick members (moderation cases).                    |
| Ban Members              | Ban and unban members (moderation cases).           |
| Manage Server            | List invites for referral attribution.              |
| Manage Events            | Create Discord scheduled events for JAVELIN events. |
| Add Reactions            | Grant reactions in private trial team channels.     |

The source of truth is `REQUIRED_PERMISSIONS` in
`apps/bot/src/discord/permissions.ts`; the bot's readiness check compares the
guild against it.

## 3. Configuration

Every variable is documented in [ENVIRONMENT.md](ENVIRONMENT.md). Production
minimum:

- both: `NODE_ENV=production`, `DATABASE_URL`, `DISCORD_CLIENT_ID`,
  `DISCORD_GUILD_ID`, `JAVE_PUBLIC_URL`, `JAVE_ENCRYPTION_KEY` (if integrations
  or webhooks are used), `JAVE_FOUNDER_DISCORD_IDS` for the first founder;
- bot: `DISCORD_TOKEN`;
- dashboard: `DISCORD_CLIENT_SECRET`, `JAVE_SESSION_SECRET`.

Never set `JAVE_DEV_AUTH` in production; configuration validation refuses it.
AI is off unless `AI_PROVIDER` and `AI_API_KEY` are set.

## 4. Build and run

```bash
docker build -f apps/bot/Dockerfile -t jave-bot .
docker build -f apps/dashboard/Dockerfile -t jave-dashboard .
```

- **Bot**: one replica. Health server on `BOT_HEALTH_PORT` (8080):
  `/healthz` (process alive) and `/readyz` (Discord gateway, database, job
  queue). Point your orchestrator's liveness probe at `/healthz` and
  readiness at `/readyz`. On SIGTERM the bot stops polling, finishes the jobs in flight (bounded by a
  shutdown timeout) and closes the gateway and database cleanly.
- **Dashboard**: any number of replicas behind HTTPS on port 3000. Health at
  `/api/health`. Terminate TLS in front of it; `NODE_ENV=production` enables
  secure cookies and HSTS.
- **Activity**: see [docs/ACTIVITY.md](docs/ACTIVITY.md) for the build and the
  URL mappings Discord needs.

## 5. Release order

1. `migrate` (release step, one-off container).
2. Roll the dashboard.
3. Restart the bot (single replica: stop, then start; jobs left mid-run are
   recovered after their lease expires).
4. `commands:deploy` when commands changed.

Migrations are additive within a release, so the previous dashboard version
keeps working against the new schema during a rolling update.

## 6. Verify

- `curl https://<dashboard>/api/health` → `status: ok`.
- `curl http://<bot>:8080/readyz` → Discord, database and queue `ok`.
- In Discord, `/jave status` (staff) shows the same checks plus queue depth and
  dead letters.
- Sign in to the dashboard with Discord; the founder listed in
  `JAVE_FOUNDER_DISCORD_IDS` is bootstrapped on first contact (audited).

## 7. Rollback

Roll the dashboard and bot images back; the schema stays (additive
migrations). Never run a down-migration against production data. If a release
queued bad jobs, inspect them with `listJobs` (dead letters) before retrying.
