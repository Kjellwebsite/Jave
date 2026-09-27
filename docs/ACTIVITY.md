# JVLN Activity — Mission Control + JVLN Arena

`apps/activity` is JAVELIN's Discord Activity: a Vite + React app that runs in a
Discord iframe through the [Embedded App SDK](https://github.com/discord/embedded-app-sdk).
Its API lives in the dashboard (`apps/dashboard/app/api/activity/**`); every rule
stays in `@jave/core`.

| View                    | What the member sees                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MISSION CONTROL**     | Their own JVLN profile: peak rank per domain as VERIFIED / CLAIMED / UNKNOWN (never a total), facets, record; active missions with deadlines; their running trial with a live countdown; the next events. |
| **JVLN ARENA · TRIVIA** | One live trivia session per Activity instance: lobby, start, question with four options and a countdown ring, locked-in state, reveal with the correct answer and a fact, live standings, final podium.   |

Arena points are game points. They never change capability ranks, and the UI
says so wherever scoring is explained.

Screenshots (1280×720 and 390×844): [`docs/screenshots/activity-*.png`](./screenshots).

## Architecture

```
Discord client
  └─ iframe https://<application id>.discordsays.com/?instance_id=…&frame_id=…
       │  apps/activity (static build)               DiscordSDK · ready · authorize · authenticate
       │  fetch /.proxy/api/activity/*  (Bearer jave_token)
       ▼
Discord proxy ── URL mapping /api → <dashboard host>/api
       ▼
apps/dashboard  app/api/activity/*  (route handlers, Node runtime)
       │  authenticate: jave_token → resolveUserActor (current roles, standing)
       ▼
@jave/core  identity · missions · trials · calendar · games   ──►  PostgreSQL
       ▲
apps/bot worker: games.tick advances timers on schedule, games.sweep closes idle sessions
```

| Path                                               | Role                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/activity/src/platform/launch.ts`             | Discord vs standalone launch (`frame_id` query parameter), API base path, dev persona and instance.                                                                 |
| `apps/activity/src/platform/hosts.ts`              | The Discord host (real SDK) and the MOCK / DEVELOPMENT ONLY host (`DiscordSDKMock` + dev token).                                                                    |
| `apps/activity/src/api/`                           | `ApiClient` (same-origin JSON, bearer, 8 s timeout, no cookies) and `ActivitySession` (token refresh, 401 retry, server clock).                                     |
| `apps/activity/src/hooks/`                         | `useArena` (polling, timer nudges, actions, reconnects) and `useMissionControl`.                                                                                    |
| `apps/activity/src/views/`                         | `mission-control/*` and `arena/*`, built from `@jave/ui` primitives and tokens.                                                                                     |
| `apps/dashboard/app/api/activity/_lib/contract.ts` | The wire contract. Types only; the Activity imports it with `import type` through the `@jave/activity-contract` path alias, so no server code can reach the bundle. |
| `apps/dashboard/app/api/activity/_lib/`            | Token, authentication, HTTP envelope, rate limits, whitelist mappers, handlers (tested with constructed `Request`s).                                                |
| `apps/dashboard/app/api/activity/**/route.ts`      | One-line route files that bind a handler to the runtime (`activityDeps()`).                                                                                         |

The bundle contains no `@jave/core` code: the trivia bank (the answers) and the
engine state never leave the server (asserted by checking the production build).

## Sign-in

1. `new DiscordSDK(VITE_DISCORD_CLIENT_ID)`, then `await sdk.ready()`.
2. `sdk.commands.authorize({ client_id, response_type: 'code', state, prompt: 'none', scope: ['identify'] })` → `code`.
3. `POST /.proxy/api/activity/token` `{ code, instanceId: sdk.instanceId }`. The dashboard
   - exchanges the code at `https://discord.com/api/oauth2/token` with `DISCORD_CLIENT_SECRET`
     (Embedded App SDK flow: no redirect URI, no PKCE) and requires `identify` in the granted scope;
   - reads `GET /users/@me`, refuses bot accounts;
   - upserts the user and member through core (`upsertDiscordUser`, `ensureMember` — a launch never
     implies guild membership), audits `auth.login` `{ method: 'discord_activity' }`;
   - answers `{ access_token, jave_token, expiresAt, user: { discordId, displayName }, mode }`.
     The Discord access token is handed back for step 4 and never stored or logged.
4. `sdk.commands.authenticate({ access_token })`. The Activity checks that the user Discord
   authenticated is the user JAVE issued the token for; otherwise it stops (SIGN-IN REFUSED).
5. Every later call sends `Authorization: Bearer <jave_token>`.

**`jave_token`** — `base64url(claims).base64url(HMAC-SHA256)`, signed with `JAVE_SESSION_SECRET`
under its own purpose label (`jave.activity-token.v1`), so no other signed value (OAuth state,
cookies) ever verifies as one. Claims `{ v, sub: userId, iid: instanceId, iat, exp, mode }`.

- Lifetime 1 hour; a token claiming more than 2 hours is refused even when correctly signed;
  `iat` may lead the server clock by at most one minute; at most 1024 characters.
- It asserts identity only. Every request re-resolves roles and standing through core, so a ban,
  quarantine or role change applies on the next request.
- A `dev` token stops working the moment dev auth is switched off.
- Kept in memory only (never `localStorage`, never a cookie). The Activity signs in again silently
  five minutes before expiry (the full flow above, `prompt: 'none'`), and once more after a 401.
- **Instance scope**: a token acts only on game sessions whose `activity_instance_id` equals its
  `iid`. Sessions of another instance or a Discord channel answer 404, like sessions that do not exist.

## API

All routes: `Cache-Control: no-store`, JSON bodies only (415 otherwise), strict schemas (unknown
fields refused), body caps enforced on the declared length and on the bytes actually received
(413), budgets in the shared `rate_limit_buckets` table (429 with `Retry-After`). Errors are
`{ error: { code, message, reference?, retryAfterSeconds? } }`; unexpected failures return only an
`E-XXXXXXXX` reference that matches the server log line.

| Method | Path                                        | Who                                  | Budget (per minute)                           | Core call                                                                         |
| ------ | ------------------------------------------- | ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/api/activity/token`                       | anyone with a Discord code           | 60 per client IP, then 10 per Discord account | Discord exchange, `upsertDiscordUser`, `ensureMember`                             |
| GET    | `/api/activity/dev-token`                   | MOCK / DEV ONLY (404 unless enabled) | —                                             | persona list                                                                      |
| POST   | `/api/activity/dev-token`                   | MOCK / DEV ONLY (404 unless enabled) | 60 per client IP                              | `provisionDevPersona`, audited `auth.dev_login`                                   |
| GET    | `/api/activity/me`                          | signed in                            | 30                                            | `getProfile`, `missions.listMyMissions`, `trials.myTrials`, `calendar.listEvents` |
| GET    | `/api/activity/trivia/session[?sessionId=]` | signed in                            | 150 (polls and nudges)                        | `games.findLiveSession` / `games.getSessionView`                                  |
| POST   | `/api/activity/trivia/session`              | signed in                            | 20 (lobby actions)                            | `games.joinSession`, or `games.createSession` (surface `activity`)                |
| POST   | `/api/activity/trivia/start`                | host, or event staff                 | 20                                            | `games.startSession`                                                              |
| POST   | `/api/activity/trivia/leave`                | player                               | 20                                            | `games.leaveSession`                                                              |
| POST   | `/api/activity/trivia/close`                | host, or event staff                 | 20                                            | `games.abandonSession`                                                            |
| POST   | `/api/activity/trivia/move`                 | player                               | 40                                            | `games.submitMove`                                                                |
| POST   | `/api/activity/trivia/tick`                 | host or player                       | 150                                           | `games.tickSession`                                                               |

Body caps: token 2 KB, session requests 1 KB, moves 512 B.

**What the Activity never receives**: account or Discord ids of other members (players are seat
keys `p1`, `p2`, …), the session seed, raw game state, the correct answer or fact before the
reveal, other players' choices, anything adversarial, staff-only fields, event URLs beyond their
host name. Every response is built by an explicit whitelist mapper (`_lib/mappers/*`), so a field
core adds later cannot leak without a deliberate change; tests grep raw responses for forbidden
values.

### Mission Control

`GET /me` composes four core reads as the caller. A panel the caller may not see (for example a
restricted account) renders empty instead of failing the screen; anything unexpected still fails.
The trial is the member's own running (or teams-assigned) trial from `trials.myTrials` — a
member-safe summary; the adversarial module is never read. `canHostGames` mirrors core's
`createSession` requirement so the Arena shows the right entry point.

### JVLN Arena · Trivia

- **One session per instance.** `POST /trivia/session` joins the instance's open lobby or, when
  nothing is live, opens one (`canHostGames`, good standing; ranges enforced by the trivia engine:
  5–15 rounds, 10–30 s, difficulty). Two players opening at the same instant end up in one lobby:
  the loser of core's unique index joins the winner's lobby.
- **Polling, no websockets.** `GET /trivia/session` every second while a session is live, every
  three seconds otherwise; exponential backoff (1 → 8 s) after failures, honouring `Retry-After`.
  Responses can arrive out of order (a poll racing an answer): the higher `version` wins.
- **Timers are the server's.** The bot worker's `games.tick` job closes each round at its deadline.
  Players and the host `POST /trivia/tick` only once a transition is 2.25 s overdue; core accepts
  player ticks at ≥ 2 s, so a lagging worker never stalls a game and nobody sees a question before
  the worker would have shown it. Countdowns use server time (`serverNow` in every response).
- **Anti-cheat is core's**: the correct index, the fact and correctness stay hidden until the round
  closes; points join the standings at the reveal; a late answer is refused by server time
  whatever the client shows; one answer per player per round.
- **Reconnects.** A failed poll switches the bar to RECONNECTING and retries; the next answer
  re-syncs everything from server state. A followed session that disappears (404) falls back to
  the instance's live session. A failed answer releases the lock so the player can try again.
- **Lobby control.** The host starts or closes the lobby; players leave (the last one out closes
  it). Event staff (`canManageEvents`) can start or close any lobby of their instance — core audits
  it (`game.started_by_staff`, `game.abandoned`). A running game always finishes on its timers.
- Fewer than two players is practice: never ranked, never a win (core).

## Discord Developer Portal configuration

Use the same application as the bot and the dashboard login.

1. **General Information** → Application ID. It is `DISCORD_CLIENT_ID` (bot, dashboard) and
   `VITE_DISCORD_CLIENT_ID` (Activity build). Public, not a secret.
2. **OAuth2** → Client Secret → `DISCORD_CLIENT_SECRET` (dashboard, secret). Redirects:
   `${JAVE_PUBLIC_URL}/api/auth/discord/callback` (dashboard login). The Activity's code exchange
   sends no redirect URI, but Discord requires at least one registered redirect; the dashboard's
   satisfies it.
3. **Installation** → Installation Contexts: **Guild Install** only. JAVE is single-tenant; the
   Activity is meant for the JAVELIN server, not for DMs.
4. **Activities → Settings** → **Enable Activities**. Supported platforms: Web, Desktop, iOS,
   Android. Mobile orientation lock: unlocked (the layout adapts to landscape 16:9 and portrait).
5. **Activities → URL Mappings** (targets without `https://`; the longer prefix first):

   | PREFIX | TARGET                           |
   | ------ | -------------------------------- |
   | `/api` | `<dashboard host>/api`           |
   | `/`    | `<activity host>` (root mapping) |

   Discord replaces the matched prefix with the target, so `/.proxy/api/activity/me` reaches
   `https://<dashboard host>/api/activity/me`; that is why the `/api` target ends in `/api`.
   The Activity calls the `/.proxy/api` form by default; `VITE_JAVE_API_BASE=/api` switches to the
   unprefixed form where Discord's proxy accepts it.

6. **Entry Point command.** Enabling Activities creates the default entry point command
   (**Launch**, type `PRIMARY_ENTRY_POINT`, handler `DISCORD_LAUNCH_ACTIVITY`): members start JVLN
   from a voice channel's Activities shelf, the App Launcher or that command, and Discord launches
   the Activity itself. Keep it. JAVE registers its slash commands per guild
   (`pnpm commands:deploy` bulk-overwrites guild commands), which never touches the global entry
   point command. If JAVE's commands ever move to a global bulk overwrite, include the entry point
   command in that payload or Discord rejects the update.

No bot permission is needed for the Activity; the Arena is not mirrored into a channel.

## Local development

```bash
pnpm db:migrate                     # database with the current schema
# .env: JAVE_DEV_AUTH=true (MOCK / DEVELOPMENT ONLY), DISCORD_CLIENT_ID, DISCORD_GUILD_ID, JAVE_SESSION_SECRET
pnpm dev:dashboard                  # http://localhost:3000
pnpm dev:activity                   # http://localhost:5173 — proxies /api and /.proxy/api to the dashboard
```

Open `http://localhost:5173/?persona=verified&instance=table-1` in one window and
`?persona=member&instance=table-1` in another: both are in the pseudo-instance `dev-table-1`.
Personas are the dashboard's dev personas (founder, core, operations, moderator, verified, member).

**STANDALONE DEV MODE — MOCK / DEVELOPMENT ONLY.** Outside Discord (no `frame_id` query parameter)
the Activity uses the SDK's `DiscordSDKMock` and `POST /api/activity/dev-token` instead of the
OAuth exchange, under a dev bar that says so and picks the persona. The mode exists only in Vite
dev-server builds, or in a build made with `VITE_JAVE_STANDALONE_DEV=true` (a staging preview); a
production build opened outside Discord asks to be launched from Discord. The dashboard issues dev
tokens only when `JAVE_DEV_AUTH=true` and `NODE_ENV` is not `production` (the environment schema
refuses the combination at boot), audits each as `auth.dev_login` `{ mock: true, surface: 'activity' }`,
and stops accepting them as soon as dev auth is off.

| Variable (Activity)        | When        | Purpose                                                                                                                                                |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_DISCORD_CLIENT_ID`   | build       | Application ID. Required inside Discord.                                                                                                               |
| `VITE_JAVE_API_BASE`       | build       | Optional same-origin API base path (default `/.proxy/api` in Discord, `/api` standalone). Anything that is not a same-origin absolute path is ignored. |
| `VITE_JAVE_STANDALONE_DEV` | build       | `true` keeps the MOCK / DEVELOPMENT ONLY mode in a production build.                                                                                   |
| `JAVE_ACTIVITY_API_TARGET` | dev/preview | Where the Vite proxy sends `/api` (default `http://localhost:3000`).                                                                                   |
| `JAVE_ACTIVITY_PORT`       | dev/preview | Vite port (default 5173).                                                                                                                              |

`VITE_*` values are read from the monorepo root `.env`; only `VITE_*` variables ever reach the bundle.

**Inside real Discord from a laptop**: `cloudflared tunnel --url http://localhost:5173`, then map
`/` → `<tunnel host>` and `/api` → `<tunnel host>/api` (the Vite server proxies `/api` to the
dashboard, which needs `DISCORD_CLIENT_SECRET`). Vite accepts `*.trycloudflare.com` hosts.

## Tests

```bash
pnpm --filter @jave/activity test                                   # unit: client, session, launch, arena logic, format
cd apps/dashboard && npx vitest run app/api/activity --maxWorkers=2  # API handlers on PGlite
JAVE_TEST_BACKEND=postgres JAVE_TEST_POSTGRES_URL=postgres://… npx vitest run app/api/activity --maxWorkers=2
pnpm --filter @jave/activity test:e2e                               # Playwright, real Postgres
JAVE_SCREENSHOTS=1 pnpm --filter @jave/activity test:e2e            # also refreshes docs/screenshots/activity-*.png
```

The API tests drive every handler with constructed `Request`s against a TestKit database: token
sign/verify/expiry/tamper/purpose, the Discord exchange (stubbed `fetch`), dev tokens, Mission
Control (including what must never appear), a full two-player game, lobby races, staff control,
instance scope, spectators, restricted and banned members, malformed and oversized bodies, budgets.

The end-to-end suite resets, migrates and seeds `jave_e2e_activity` (it refuses any database
without `e2e` in its name), starts `next dev` with dev auth and the Vite dev server, and plays a
full five-round game with two browser contexts (1280×720 and 390×844), plus BREAK cases: a lost
connection shown and recovered, an unknown persona refused.

## Deployment

- **Build**: `VITE_DISCORD_CLIENT_ID=<application id> pnpm --filter @jave/activity build` →
  `apps/activity/dist/`. Serve it from any static host or CDN over HTTPS; that host is the root
  URL mapping target.
- **Headers on the Activity host**: Discord frames the Activity, so do not send
  `X-Frame-Options: DENY` or `frame-ancestors 'none'`. If you set `frame-ancestors`, allow
  `https://discord.com https://*.discord.com https://*.discordsays.com`. Cache `assets/*`
  (content-hashed) as immutable and `index.html` as `no-cache`. The build embeds its own CSP
  (`default-src 'self'`; scripts, styles, fonts and API calls from the Activity origin only).
- **Dashboard**: nothing extra — the routes ship with it. It needs `DISCORD_CLIENT_SECRET` and
  `JAVE_SESSION_SECRET` (both already required in production). Rotating `JAVE_SESSION_SECRET`
  signs every player out; the Activity signs in again on the next request.
- **Bot**: its worker runs `games.tick` and `games.sweep`. Without it, player nudges still finish
  games, but idle lobbies are only closed by the sweep.

### Verify after deployment

1. Launch JVLN from a voice channel in the JAVELIN server → the Discord authorization prompt →
   MISSION CONTROL shows your profile.
2. A second account launches in the same channel → JVLN ARENA shows the lobby → start → play.
3. The dashboard audit log shows `auth.login` with `method: discord_activity` for both.

## Limitations

- **Instance membership is not verified with Discord.** The instance id comes from the client and
  only decides which lobby players share; it grants nothing (every action is re-authorized as the
  user). EXTENSION POINT: `InstanceVerifier` in `_lib/instance.ts` — a stricter verifier can call
  `GET /applications/{application id}/activity-instances/{instance id}` with the bot token; the
  dashboard deliberately does not hold the bot token today.
- **Client IPs are Discord's.** Requests arrive through Discord's proxy, so the per-IP budget on
  `/token` is close to a global budget; the per-account budget does the fine-grained work.
- **Polling** costs one request (and one rate-limit row update) per player per second while a game
  is live. Fine at JAVELIN scale; a push channel keyed by session `version` can replace it without
  changing the contract.
- **An absent host** blocks the instance's lobby until event staff close it or the sweep closes it
  (30 idle minutes), because core lets only the host or event staff start and close a lobby.
- **Discord live launch was not exercised in this build environment** (`discord.com` is
  unreachable here). Everything up to the Discord boundary is tested: the code exchange with a
  stubbed Discord, the Activity with the SDK's own mock client, the API against real Postgres.
  Follow "Verify after deployment".
