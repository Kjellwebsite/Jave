# Module: games (game framework, TRIVIA, REACTION)

`packages/core/src/games` — `import { games } from '@jave/core'`.
Schema: `packages/database/src/schema/games.ts`.

An extensible, deterministic game framework. Engines are pure; the platform owns
persistence, authorization, timers, anti-cheat, placements, leaderboards and the
Discord mirror. Built-in: **TRIVIA** (the first game) and **REACTION** (a small
second game that proves pluggability: hidden timers, a different move shape,
false-start anti-cheat). Game stats are game stats — they never become capability.

## Engine contract — `GameDefinition<Config, State, Move, PublicState>`

```ts
{ key, name, description, minPlayers, maxPlayers,
  configSchema, moveSchema,                       // zod; configs and moves are .strict()
  init(config, players, rng): State,              // players = user ids in seat order
  validateMove(state, player, move, now): { ok } | { ok: false, code, reason },
  applyMove(state, player, move, now): { state, round, correct, points },
  advance(state, now): State,                     // same object when nothing is due
  nextDeadline(state): number | null,             // drives the games.tick job
  isFinished(state), scores(state), publicView(state, viewerId | null) }
```

Rules: no I/O, clock reads or `Math.random` — time arrives as `now` (epoch ms) and
randomness only through the seeded `Rng` (cyrb128 → sfc32, `createRng(seed)`).
State is plain JSON (stored as jsonb; never depend on key order). `publicView` is the
only window into a game: it must not leak answers, future rounds, other players'
choices or secret timers. Register with `registerGame(definition)` at startup.
The session tests plug in a third, test-only game with zero platform changes.

## Session state machine

```
lobby ──startSession──► active ──(engine finished)──► completed
  │ └─(last player leaves / sweep 30 min idle / abandon)─► abandoned
active ──abandon / sweep (2 h without progress) / channel rejected──► abandoned
```

- `game_sessions.version` is the optimistic concurrency guard: every write is
  `UPDATE … WHERE version = :read` (`compareAndSetSession`). Lobby changes run under the
  row lock; moves and ticks are lock-free and retry up to 3 times on a lost race.
- `seat` (join order, assigned under the lock) is the engine's player order.
- `playerCount < 2` ⇒ practice: recorded, `ranked: false`, never a win, never on leaderboards.

## Services

| Function                             | Access                                                       | Notes                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `availableGames`                     | member                                                       | Registered games.                                                                                                                                                                                                                                                                                         |
| `createSession`                      | `canHostGames`, good standing                                | Surface `discord` (needs `discordChannelId`), `activity` (needs `activityInstanceId`) or `dashboard`. Config validated by the game (≤ 4 KB). One live session per channel / Activity instance (partial unique indexes); ≤ 3 live sessions per host (host row lock). Seed: 24 random bytes, never exposed. |
| `joinSession` / `leaveSession`       | member in good standing / user                               | Lobby only; idempotent; capacity = `maxPlayers`.                                                                                                                                                                                                                                                          |
| `startSession`                       | host, or `canManageEvents` (audited `game.started_by_staff`) | Player count within the game's range; `init` from the seed, then `advance(now)`.                                                                                                                                                                                                                          |
| `submitMove`                         | player in good standing                                      | Move ≤ 1 KB, validated by the game schema; timers advanced to server `now` first; optional `expectedVersion` (stale ⇒ `ConflictError`); one move per player per round (unique index); persisted to `game_moves` with correctness and points.                                                              |
| `tickSession`                        | host, player, system                                         | Advance timers now (idempotent). The system advances everything due; hosts and players only transitions overdue by ≥ 2 s, so nobody can race the worker to see a new question or GO first.                                                                                                                |
| `abandonSession`                     | host, or `canManageEvents`                                   | Audited `game.abandoned`.                                                                                                                                                                                                                                                                                 |
| `getSessionView` / `findLiveSession` | member, system                                               | `SessionView` = metadata + players + `publicView` for the viewer (spectator view for non-players). Never the raw state or the seed.                                                                                                                                                                       |
| `getLeaderboard`                     | member                                                       | Per game: `wins` / `best_score` / `sessions`; ranked sessions only; members with `showOnLeaderboards`, good standing, not deleted; competition ranking.                                                                                                                                                   |

Error mapping for refused moves: not a player → `ForbiddenError`; round closed or wrong
round → `InvalidStateError`; duplicate → `ConflictError`; invalid → `ValidationError`.

## TRIVIA

- 67 original questions (logic, mathematics, physics, computer science, engineering
  history, space, biology/self-optimization), 4 options each, difficulty tags, a one-line
  fact shown at the reveal. Options fit Discord button labels (≤ 80 chars; tested).
- Config: `rounds` 5–15 (default 10), `secondsPerQuestion` 10–30 (default 20), optional
  `categories`, `difficulty` (`mixed`/`easy`/`medium`/`hard`); a filter too narrow for the
  requested rounds is rejected.
- Seeded shuffle of questions and of each question's options.
- Scoring: correct = 100 + speed bonus up to 50 (linear in time left); wrong/no answer = 0.
- Flow: question (closes at the deadline or as soon as everyone answered) → reveal (5 s)
  → next question → finished. Transitions happen at the observed `now`, so a late tick
  delays a round but never skips one.
- Anti-cheat: the correct index, the fact and correctness are hidden until the round
  closes; a round's points are committed to the scoreboard only at the reveal (a score
  jump cannot leak correctness); others' choices are never shown, only "answered".
  The bank and engine state types are not exported from the module namespace — the bank
  holds the answers and must never reach a client bundle.

## REACTION

Rounds 3–10. Each round arms with a seeded 1.5–5 s secret delay. Reaction times are
measured from the scheduled GO instant (a blind tap that happens to trigger the
transition earns no zero-time bonus); the 3 s tap window opens when GO is observed, so a
late tick never shortens it. Taps score `max(10, 100 − ⌊ms/20⌋)`; a tap before GO is a
false start (0, the round is lost). The GO instant never appears in the view before it
happens. Best on the Activity surface (Discord message edits add latency).

## Domain events

`game.completed` — one per player (`subjectMemberId` set), payload
`{ gameKey, score, placement, players, ranked, won }`.

## Jobs

| Type          | Schedule                                               | Behaviour                                                                                                   |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `games.tick`  | at each `nextDeadline` (dedupe per session + deadline) | Advances timers; finishes the game when the engine says so. System actor.                                   |
| `games.sweep` | recurring, every 5 min                                 | Abandons lobbies idle 30 min; advances, then abandons, active games without progress for 2 h. System actor. |

## Discord job contract — `discord.games.render`

Enqueued in the same transaction after every change to a `discord`-surface session
(create, join/leave, start, move, timer transition, finish, abandon); payload
`{ sessionId, version }`, one job per version (`discord.games.render:<id>:v<version>`).

The bot must:

1. `getGameRender(ctx, sessionId)` (system only). If `session.version` > payload version,
   skip (`superseded`).
2. Render one panel from the spectator view: lobby (players n/max, buttons
   `games:join|leave|start:<id>`), trivia question (options as buttons
   `games:move:<id>:<round>:<choice>`, answered count, closing time), trivia reveal (correct
   option, fact, scoreboard, no buttons), reaction (`games:move:<id>:<round>:tap`), final
   standings or end reason. User text through `userText()`; `allowedMentions: { parse: [] }`.
3. If `discordMessageId` is null: never post for an ended session; verify the **host** can
   View Channel + Send Messages in `discordChannelId` (non-Discord surfaces let a member name
   any channel id) and that the bot can post; if not, call
   `markGameChannelUnavailable(ctx, { sessionId, reason: 'host_cannot_post' | 'bot_cannot_post' })`
   (ends the session without another render). Otherwise post and call
   `markGameMessagePosted(ctx, { sessionId, channelId, messageId })` (channel must match).
   With a message id, edit it; re-post (same checks) if it was deleted.
4. Button clicks call `joinSession` / `leaveSession` / `startSession` / `submitMove` as the
   clicking user. The custom id routes, it never authorizes.

**Permissions** in the session channel: View Channel, Send Messages, Embed Links,
Read Message History.

## Extension points

- New games: implement `GameDefinition`, `registerGame` at startup. Export only a
  `public.ts` surface (constants, schemas, public view types) from the module.
- Activity surface: poll `getSessionView`/`tickSession`, or subscribe via a future
  push channel keyed by `version` (not built here).
- Leaderboards are computed on read; a materialized stats table can replace the query
  without changing the service signature.

## Known limitations

- No per-game rate limit on moves beyond one move per round; surfaces add request limits.
- Leaderboards aggregate on read (fine at JAVELIN scale; index `game_players_user_idx`).
- REACTION over Discord is latency-bound; fairness is best on the Activity surface.
- A game unregistered while sessions are live ends those sessions on their next tick.
