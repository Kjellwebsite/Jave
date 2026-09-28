# Runbook

What to do when something is wrong with JAVE in production. For the first
install see [DEPLOYMENT.md](DEPLOYMENT.md); for every variable see
[ENVIRONMENT.md](ENVIRONMENT.md); for the threat model see
[SECURITY.md](SECURITY.md).

## Where to look

| Signal                            | Where                                                             | Healthy                                      |
| --------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| Bot liveness                      | `GET :8080/healthz`                                               | `200`                                        |
| Bot readiness                     | `GET :8080/readyz`                                                | `200`; Discord and database `ok`             |
| Dashboard                         | `GET /api/health`                                                 | `status: ok`                                 |
| Everything at once, in Discord    | `/jave status` (details need `canViewSystemStatus`)               | "System nominal"; no **Dead letters** button |
| Discord permissions and hierarchy | `/jave setup` (`canManageSettings`)                               | every line `✓`                               |
| Who did what                      | Dashboard → **Audit Log** (filters: actor, action, target, date)  | —                                            |
| Process logs                      | stdout, JSON (pino); secrets are redacted before they are written | no `error` lines                             |

`/readyz` fails only on the **critical** checks (Discord gateway, database).
The queue and AI checks are non-critical: they degrade `/jave status` but never
take the bot out of rotation.

A dashboard error page shows an 8-character **reference** (for example
`K7Q2M9XH`). The same reference is logged next to the stack trace, so search
the dashboard logs for it.

## Routine

| When            | What                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Every release   | `migrate`, roll the dashboard, restart the bot, `commands:deploy` if commands changed (DEPLOYMENT.md §5).                |
| After a release | `/jave status` and `/jave setup` in Discord.                                                                             |
| Weekly          | Clear **Dead letters** (below). Glance at the Audit Log for `denied` results you do not expect.                          |
| Monthly         | Restore a backup into a scratch database and run `pnpm db:migrate` against it; a backup you have not restored is a hope. |
| Automatic       | `system.housekeeping` runs daily and prunes operational rows (table below). Records of decisions are never pruned.       |

### What housekeeping prunes

| Rows                                          | Kept for |
| --------------------------------------------- | -------- |
| Completed or cancelled jobs                   | 14 days  |
| Dead-lettered jobs                            | 30 days  |
| Ended dashboard sessions (expired or revoked) | 30 days  |
| Rate-limit buckets                            | 8 days   |
| Webhook delivery logs                         | 90 days  |

Audit logs, moderation cases, rank history, applications, trials and
notifications are the organization's record and are not pruned. Each run
deletes in batches of 5,000 (at most 20 batches per table), so a large backlog
clears over a few days instead of in one long transaction.

## The job queue

Everything JAVE does in Discord (roles, cards, threads, moderation actions,
announcements) is a `discord.*` job run by the bot's worker. Core work
(achievements, notifications, reminders, sweeps) runs in the same worker.

- A failing job retries with backoff (10 s, 20 s, 40 s … at most 1 h), 5 attempts
  by default, then **dead-letters**. Permanent Discord errors (missing
  permission, unknown channel, role hierarchy) dead-letter at once.
- A job whose worker died mid-run is returned to the queue after its 5-minute
  lease expires, so a bot restart never loses work.
- Deduplicated jobs (role sync, card renders) never pile up: a second request
  while one is running asks for one more run afterwards (`rerunIfRunning`).

### Queue is backing up

Symptom: `/jave status` shows the queue as degraded, or the oldest pending job
is older than 5 minutes.

1. Is the bot up? `/readyz`. If the worker is not ticking, restart the bot.
2. Is Discord rate limiting? Logs show `429` with a retry-after. It drains by
   itself; do not restart repeatedly (a restart re-sends the gateway identify).
3. A burst (mass join, raid, a role remap re-syncing every member) is expected
   to drain. `JAVE_WORKER_CONCURRENCY` (default 4) raises throughput; keep it
   modest because Discord limits per route.

### Dead letters

`/jave status` → **Dead letters · N** lists the ten newest with their type,
attempts and error (payloads are never shown). The error names the cause:

| Error says                           | Fix, then retry                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Missing Permissions / Missing Access | `/jave setup` shows which permission or channel overwrite is missing.              |
| role hierarchy / above the bot       | Drag the bot's role above the role it manages; **Re-sync roles** in `/jave setup`. |
| Unknown Channel                      | The configured channel was deleted: `/settings channel` to set a new one.          |
| Unknown Member                       | The member left. Nothing to do; the entry ages out after 30 days.                  |

Retry with the **Retry a job** select (`canManageSettings`; audited
`job.retried`). A retried job re-reads current state, so it never replays a
stale decision.

## Incidents

### The bot is offline

1. `/healthz` fails → the process is down: check the container logs for the
   startup error. Configuration errors name the variable and never print its
   value.
2. `/healthz` ok, `/readyz` fails on `discord` → gateway not connected. Common
   causes: the token was reset (see "Bot token leaked"), a privileged intent was
   switched off in the Developer Portal (Server Members and Message Content are
   required), or Discord is having an outage (check status.discord.com).
3. `/readyz` fails on `database` → see "Database".

Nothing is lost while the bot is down: the dashboard keeps working, and every
Discord side effect it queues runs when the bot reconnects.

### A raid

1. `/raidmode on reason:<why>`: every new join is quarantined until you switch
   it off; staff are alerted and a notice is posted.
2. Moderate with `/mod quarantine`, `/mod ban` (with message deletion) or the
   **Security alert** card's buttons.
3. `/raidmode off` when it is over. Members already held stay quarantined:
   review them (`/mod history`, or **Moderation → Member lookup** on the
   dashboard) and `/mod release` the real ones.

`security.autoRaidMode` switches raid mode on by itself when joins burst past
the threshold (Settings → Security). It never switches it off.

### A staff account is compromised

Authority is resolved from roles and standing **on every request and every
interaction**, never cached in a session. So:

1. `/mod quarantine member:<them>` (or ban). A quarantined or banned member has
   no capabilities from the next request on, on the dashboard and in Discord,
   and role sync strips their mapped Discord roles.
2. Revoke the staff role they held (dashboard **Members → the member → Roles**),
   so a later release does not restore it.
3. Read the Audit Log filtered by that actor for the window of the compromise.
   Every privileged action is there, including refused ones.
4. Undo what needs undoing: moderation cases can be revoked (`/mod case` →
   **REVOKE**), a verified rank can be set again (the member's rank history keeps
   every previous value), and roles granted by the attacker can be revoked.

Their dashboard sessions authorize nothing while they are quarantined. To end them at once,
open **Members → the member → Account → End all sessions** (moderators and up, for accounts
ranked below them; audited). A ban ends them automatically.

To sign **everyone** out (for example after a leaked session secret), run against the database:

```sql
update sessions set revoked_at = now() where revoked_at is null;
```

This bypasses the audit log; note it in your incident record. Everyone signs in again with
Discord.

### A member asks for their data, or to be erased

- **Their data:** they download it themselves from **My profile → Privacy** (three a day). If
  they cannot sign in, a founder exports it from **Members → the member → Account → Export member
  data**, with the request as the reason, and sends the file through a channel the member
  controls.
- **Erasure:** verify the request comes from the account holder. The member must have left the
  server and hold no staff role. A founder opens **Members → the member → Account → Erase
  personal data**, gives the request as the reason and types the handle. It cannot be undone.
  Then delete what JAVE cannot reach: their ticket threads and transcript files in Discord, and
  any posts the request covers. What is erased and what is kept is listed in
  [docs/modules/privacy.md](docs/modules/privacy.md).

### A secret leaked

Rotate the secret, update it in your secret store, then restart the process
that uses it. None of these secrets is ever stored in the database or logged.

| Secret                  | Rotate in                            | Effect of rotating                                                                                                                                                         |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`         | Developer Portal → Bot → Reset Token | The old token stops working at once. Restart the bot.                                                                                                                      |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 → Reset    | Sign-ins in progress fail and must be retried. Restart the dashboard.                                                                                                      |
| `JAVE_SESSION_SECRET`   | your secret store                    | It signs OAuth state cookies only, so sign-ins in progress fail. Existing sessions are separate (hashed tokens in the database); revoke them as above if you suspect them. |
| `JAVE_ENCRYPTION_KEY`   | your secret store                    | Stored integration and webhook secrets can no longer be decrypted. Re-enter each integration's secret on the **Integrations** page.                                        |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook settings, then env    | Deliveries fail signature checks until both sides match. Failed deliveries show on **Integrations → Deliveries**.                                                          |
| `AI_API_KEY`            | your provider's console              | AI requests fail until restarted with the new key. Everything else keeps working.                                                                                          |
| Database password       | your database host                   | Update `DATABASE_URL` for the bot, the dashboard and the release step.                                                                                                     |

If a secret was committed to git, rotating it is the fix. Rewriting history
does not un-leak it.

### AI is misbehaving or costing too much

- `/settings toggle` → **JAVE AI → OFF** (`ai.enabled`) stops new AI requests,
  on the dashboard and in Discord.
- Per-member limits live in Settings → AI (`ai.dailyRequestsPerUser`);
  `AI_DAILY_REQUEST_LIMIT` is the hard ceiling for the whole organization.
- `/jave ai-usage` shows today's usage; staff with `canViewAuditLogs` see the
  heaviest members.

AI never acts on its own: anything it proposes (announcements, rank or role
changes) is a preview a staff member must confirm, and the confirmation is
audited under that staff member's name.

### Adversarial trials must stop now

`/settings toggle` → **Adversarial roles → OFF** (`trials.adversarialEnabled`,
asks for confirmation). The switch is read from the database on every check,
never from a cache: new plans and briefings are refused at once, and the
adversarial sweep aborts the roles already running (on the settings change, and
every 15 minutes as a backstop). Adversarial roles are covert social roles
inside a trial team, briefed by DM; nothing in the framework touches real
credentials, private data, real people outside the trial or outside systems
(see SECURITY.md).

### Role sync is doing the wrong thing

1. `/settings toggle` → **Role sync → OFF** (`roles.syncToDiscord`) stops JAVE
   from adding or removing any Discord role.
2. `/jave setup` → **Roles** shows every mapping and flags dangerous ones
   (Administrator, elevated permissions behind member roles, a quarantine role
   that is also mapped).
3. Fix the mapping (`/settings role`), switch sync back on, then **Re-sync
   roles**.

JAVE never hands out a role that grants Administrator, whatever the mapping
says, and only touches roles it maps.

### Database

- **Unreachable**: the bot's `/readyz` fails and the dashboard shows an error
  page. Both reconnect by themselves when the database returns; no restart is
  needed.
- **A migration failed during a release**: the release step stops before the
  dashboard and bot roll, so the old version keeps running. Migrations run in a
  transaction; fix the cause and re-run `migrate`.
- **Restore**: restore point-in-time into a **new** database, point
  `DATABASE_URL` at it, run `migrate`, restart both processes. Jobs that were
  running at the restore point are recovered after their lease expires.
- **Growing too fast**: check that housekeeping runs:
  `select status, completed_at, last_error from jobs where type = 'system.housekeeping' order by run_at desc limit 5;`

### A webhook integration stopped delivering

**Integrations → Deliveries** lists every inbound and outbound delivery with its
status and error. Inbound deliveries with a bad signature are refused and
logged without their body. An outbound endpoint that keeps failing is retried
with backoff and then dead-letters like any job.

## Development and CI

- `pnpm check` runs typecheck, lint and tests (PGlite).
- The Postgres backend (`JAVE_TEST_BACKEND=postgres`) creates `jave_t_*`
  databases from a template per migration hash. If a crashed run leaves them
  behind: `pnpm --filter @jave/database test:db:clean` (add `--templates` to
  drop templates too).
- `pnpm db:seed` fills a **local** database with a realistic organization. It
  refuses production, non-local hosts for `--reset`, and unmigrated databases.
