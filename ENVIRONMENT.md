# Environment

Every variable is declared and validated once, in `packages/config/src/env.ts`.
A process refuses to start with a list of the invalid variables — names only,
never values. Empty values are treated as unset. Copy `.env.example` to `.env`
for local development; production values live in your host's secret store.

## Who needs what

| Variable                          |   Bot   | Dashboard | Required                     | Notes                                                                                                                                      |
| --------------------------------- | :-----: | :-------: | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                        |    ✓    |     ✓     | no (`development`)           | `production` enables secure cookies, HSTS, forbids dev auth.                                                                               |
| `LOG_LEVEL`                       |    ✓    |     ✓     | no (`info`)                  | `fatal`…`trace`, `silent`.                                                                                                                 |
| `DATABASE_URL`                    |    ✓    |     ✓     | **yes**                      | `postgres://user:pass@host:5432/db`. Supabase: use the pooled connection string.                                                           |
| `DATABASE_POOL_MAX`               |    ✓    |     ✓     | no (`10`)                    | Keep dashboard (serverless) low, e.g. `3`.                                                                                                 |
| `DISCORD_CLIENT_ID`               |    ✓    |     ✓     | **yes**                      | Developer portal → General Information → Application ID.                                                                                   |
| `DISCORD_GUILD_ID`                |    ✓    |     ✓     | **yes**                      | The JAVELIN server ID (Developer Mode → right-click server → Copy ID).                                                                     |
| `DISCORD_TOKEN`                   |    ✓    |           | **yes (bot)**                | Developer portal → Bot → Reset Token. Secret.                                                                                              |
| `DISCORD_CLIENT_SECRET`           |         |     ✓     | prod                         | OAuth2 → Client Secret. Secret. Required for Discord login in production.                                                                  |
| `JAVE_FOUNDER_DISCORD_IDS`        |    ✓    |     ✓     | no                           | Comma-separated Discord user IDs bootstrapped to FOUNDER on first contact (audited).                                                       |
| `JAVE_PUBLIC_URL`                 |    ✓    |     ✓     | no (`http://localhost:3000`) | Dashboard base URL. OAuth redirect is `${JAVE_PUBLIC_URL}/api/auth/callback`. Bot uses it for profile links.                               |
| `JAVE_SESSION_SECRET`             |         |     ✓     | **yes**                      | ≥ 32 chars. Signs OAuth state cookies. `openssl rand -base64 48`. Secret.                                                                  |
| `JAVE_DEV_AUTH`                   |         |     ✓     | no (`false`)                 | **MOCK / DEVELOPMENT ONLY.** Persona login without Discord. Rejected when `NODE_ENV=production`.                                           |
| `BOT_HEALTH_PORT`                 |    ✓    |           | no (`8080`)                  | `/healthz` and `/readyz`.                                                                                                                  |
| `JAVE_WORKER_CONCURRENCY`         |    ✓    |           | no (`4`)                     | Parallel jobs per bot process.                                                                                                             |
| `JAVE_WORKER_POLL_MS`             |    ✓    |           | no (`1000`)                  | Queue poll interval.                                                                                                                       |
| `JAVE_ENCRYPTION_KEY`             |    ✓    |     ✓     | for integrations             | 32 bytes base64 (`openssl rand -base64 32`). Encrypts integration/webhook secrets at rest. Rotating it invalidates stored secrets. Secret. |
| `AI_PROVIDER`                     |    ✓    |     ✓     | no (`disabled`)              | `anthropic`, `openai`, `openai-compatible`, `disabled`.                                                                                    |
| `AI_MODEL`                        |    ✓    |     ✓     | no                           | Overrides the provider's default model.                                                                                                    |
| `AI_API_KEY`                      |    ✓    |     ✓     | with a provider              | Secret.                                                                                                                                    |
| `AI_BASE_URL`                     |    ✓    |     ✓     | openai-compatible            | e.g. `https://api.deepseek.com/v1`, `http://localhost:11434/v1` (Ollama).                                                                  |
| `AI_DAILY_REQUEST_LIMIT`          |    ✓    |     ✓     | no (`50`)                    | Hard ceiling; per-user limits live in settings (`ai.dailyRequestsPerUser`).                                                                |
| `GITHUB_WEBHOOK_SECRET`           |         |     ✓     | for GitHub                   | ≥ 16 chars; the same value goes into the GitHub webhook configuration. Secret.                                                             |
| `SIDUS_API_URL` / `SIDUS_API_KEY` |    ✓    |     ✓     | for Sidus sync               | Without them research items are stored locally and marked not synced.                                                                      |
| `JAVE_MIGRATIONS_DIR`             | migrate |           | no                           | Only for the bundled migration runner in the bot container (`/app/drizzle`).                                                               |

## Secrets policy

- Secrets exist only in the environment — never in `server_settings`, never in the repo.
- Loggers redact secret-looking keys and values; the audit log redacts context.
- `.env` and `.env.*` (except `.env.example`) are git-ignored.
