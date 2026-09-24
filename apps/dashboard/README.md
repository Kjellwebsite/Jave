# @jave/dashboard

The JAVELIN operations console and public JVLN profiles. Next.js 16 (App Router), React 19,
Tailwind v4, the `@jave/ui` design system (see [`docs/DESIGN.md`](../../docs/DESIGN.md)).

## Run

```bash
cp .env.example .env.local            # fill in the values
pnpm --filter @jave/database migrate  # with DATABASE_URL set
pnpm --filter @jave/dashboard dev     # http://localhost:3000
```

| Script                    |                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `dev` / `build` / `start` | Next.js. `build` emits `output: 'standalone'`.                                                  |
| `typecheck`               | `next typegen` + `tsc`                                                                          |
| `test`                    | Vitest: auth helpers, sessions, rate limits, settings forms, metrics (PGlite, no server needed) |
| `test:e2e`                | `next build`, then Playwright against `next start` and a real Postgres (see below)              |

## Architecture

- `app/` — routes. `(console)/` is the signed-in shell; `p/[handle]` and `login` are public.
- `server/` — server-only: runtime singletons (env parsed once, db pool, logger, cache), the per-request
  `ServiceContext`, sessions, OAuth, Server Action envelope, and the dashboard's own read models
  (`server/data/*`, each guarded by `can()`).
- `lib/` — pure, client-safe helpers (navigation, time, CSP, settings form spec, URL safety).
- `components/` — dashboard compositions of `@jave/ui` primitives.

Authorization always happens in `@jave/core` services. Pages hide what the actor cannot use and render
ACCESS RESTRICTED when a service refuses; every Server Action re-checks the session and origin.

## Authentication

- **Discord OAuth2** — authorization code + PKCE (S256). `state` and the verifier live in a 10-minute,
  HMAC-SHA256-signed, httpOnly cookie. The callback verifies state in constant time, exchanges the code,
  reads `/users/@me` (scope `identify` only), upserts the user and member, and creates a session.
  Discord tokens are used once and never stored or logged.
- **Sessions** — 32 random bytes in the `jave_session` cookie (httpOnly, SameSite=Lax, Secure in
  production). Only the SHA-256 hash is stored. 30-day expiry; `last_seen_at` refreshed at most every
  5 minutes; sign-out revokes server-side. `auth.login` / `auth.logout` are audited.
- **Rate limits** — sign-in start, callback and dev login are limited per client (keyed IP hash).
- **DEV LOGIN — MOCK / DEVELOPMENT ONLY** — with `JAVE_DEV_AUTH=true` and a non-production
  `NODE_ENV`, `/login` offers six fixed personas (fake Discord IDs `100000000000000001…6`).
  Audited as `auth.dev_login`. The environment schema refuses to boot production with it enabled.

## Security

Per-request CSP nonce with `strict-dynamic` (no `unsafe-eval` outside `next dev`), `frame-ancestors
'none'`, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, a locked-down Permissions-Policy,
HSTS. Server Actions verify the request origin in addition to Next's own check. Unexpected errors are
logged with their stack under an `E-XXXXXXXX` reference that the error screen shows the user.
`/api/health` reports states and latencies only (503 when the database is down).

Client IPs are read from the right-most `X-Forwarded-For` entry: deploy behind exactly one reverse
proxy that appends it.

## End-to-end tests

```bash
service postgresql start
PGPASSWORD=jave createdb -h localhost -U jave jave_e2e_dash   # once
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @jave/dashboard test:e2e
# refresh docs/screenshots:
JAVE_SCREENSHOTS=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @jave/dashboard test:e2e
```

The web server step resets, migrates and seeds the database named by `E2E_DATABASE_URL`
(default `jave_e2e_dash`); it refuses any database whose name does not contain `e2e`.
