# Games: Discord and dashboard

Feature `apps/bot/src/features/games` · custom-id namespace `games` ·
dashboard `apps/dashboard/app/(console)/games` · domain `@jave/core` `games`
(see [docs/modules/games.md](../modules/games.md)).

A game runs on **one public panel** in the channel where it was opened. The
`discord.games.render` job posts it and edits it after every state change
(join, leave, start, answer, timer, finish, stop); core's `games.tick` job
advances the timers, so a round closes on time even when nobody clicks.
Everything else is **ephemeral**: lobby confirmations, answer receipts,
refusals, the stop confirmation and private leaderboards.

Custom ids route; they never authorize. Every button calls core as the
clicking user (`joinSession`, `leaveSession`, `startSession`, `submitMove`,
`abandonSession`), so a spectator's answer, a forged round, a second answer or
a stale lobby button is refused by core with its own message (**ACCESS
RESTRICTED**, **NOT AVAILABLE RIGHT NOW**, **CONFLICT**, **INVALID INPUT**). An
id that does not parse (unknown action, a round or choice no panel renders, an
unknown game or metric) answers **EXPIRED — This control is no longer active.**
Game results are game results: they never become capability.

## Slash command `/challenge`

| Subcommand    | Who                                         | Flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trivia`      | `canHostGames`, good standing, in a channel | Opens a TRIVIA lobby here. Options: `rounds` (5–15, default 10), `seconds` per question (10–30, default 20), `difficulty` (mixed/easy/medium/hard), `category` (one of the bank's categories). The reply confirms **LOBBY OPEN** once the panel is posted, or **CHANNEL UNAVAILABLE**: when JAVE cannot post here (View Channel, Send Messages, Embed Links in a text channel) before any session exists; when the host cannot, the render job ends the session (audited `game.channel_rejected`). |
| `reaction`    | `canHostGames`, good standing, in a channel | Opens a REACTION lobby (`rounds` 3–10, default 5): wait for GO, then tap. Best on the Activity; Discord adds message latency.                                                                                                                                                                                                                                                                                                                                                                      |
| `leaderboard` | any member                                  | Options `game` (default trivia), `metric` (wins · best score · sessions), `share`. Private by default, with metric buttons and a game select that re-render it in place; `share:true` posts a static public card. Ranked sessions only (two or more players); members hidden from leaderboards or not in good standing are not listed, nor anyone whose profile the viewer could not open. A shared card never lists a staff-only profile, even when staff post it.                                |
| `stop`        | the host, or `canManageEvents`              | The live game in this channel, behind a **STOP <GAME>?** confirmation. Stopping records no results and is audited (`game.abandoned`).                                                                                                                                                                                                                                                                                                                                                              |

Only one live game per channel (core refuses a second: "A game is already
running here."), at most three live games per host, and never in direct
messages.

## The panel

| State            | Shows                                                                                                                             | Buttons                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Lobby            | Game, settings, players `n / max` (non-pinging mentions), who hosts                                                               | **JOIN** (disabled when full) · **LEAVE** · **START** · **CANCEL** |
| Trivia question  | `ROUND n / total`, category, difficulty, the prompt and options A–D, **Closes** as a live Discord countdown, `answered / players` | **A B C D**                                                        |
| Trivia reveal    | The correct option ✓, the fact, the scoreboard with ✓ / ✕ / — per player, "Next question" or "Final standings" countdown          | none                                                               |
| Reaction wait/GO | `WAIT FOR GO` (an early tap is a false start and scores nothing) or `GO` with the window countdown, `tapped / players`            | **TAP**                                                            |
| Reaction results | Per player: reaction time and points, FALSE START or no tap; scoreboard                                                           | none                                                               |
| Final standings  | WINNER / SHARED WIN / NO WINNER (nobody scored) / PRACTICE (solo), placements and scores                                          | none                                                               |
| Ended            | The end reason (stopped by the host, idle, channel refused)                                                                       | none                                                               |

Answers are receipts only — **ANSWER LOCKED · B**, **TAP RECORDED** — and never
say whether they were right; correctness appears for everyone at the reveal,
when the round's points reach the scoreboard. Other players' choices are never
shown, only that they answered.

## Buttons and selects

| Custom id                              | Where                               | Handler                                                    |
| -------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `games:join:<sessionId>`               | lobby **JOIN**                      | `joinSession` (member in good standing, lobby only).       |
| `games:leave:<sessionId>`              | lobby **LEAVE**                     | `leaveSession` (the last player leaving closes the lobby). |
| `games:start:<sessionId>`              | lobby **START**                     | `startSession` (host, or event staff — audited).           |
| `games:abandon:<sessionId>`            | lobby **CANCEL**, `/challenge stop` | Offers the confirmation to the host and event staff only.  |
| `games:abandon:<sessionId>:confirm`    | **STOP GAME** (confirmation)        | `abandonSession`.                                          |
| `games:move:<sessionId>:<round>:<0-3>` | trivia **A–D**                      | `submitMove` `{ round, choice }`.                          |
| `games:move:<sessionId>:<round>:tap`   | reaction **TAP**                    | `submitMove` `{ round, action: 'tap' }`.                   |
| `games:board:<gameKey>:<metric>`       | private leaderboard metric buttons  | `getLeaderboard`, updated in place.                        |
| `games:board-game:<metric>` (select)   | private leaderboard game select     | `getLeaderboard` for the chosen game, updated in place.    |

Player names on the panel are non-pinging mentions (or escaped display names);
every message is sent with `allowedMentions: { parse: [] }`.

## Job handler `discord.games.render`

Serialized per session in the worker process (core's compare-and-set is the
backstop across processes). Skips superseded versions. With a stored panel it
edits it; after Unknown Message it re-posts. Before any post — never for an
ended session — it checks that the **host** can View Channel and Send Messages
in the session channel (other surfaces let a member name any channel id) and
that the bot can View Channel, Send Messages and Embed Links in a text
channel; otherwise it calls `markGameChannelUnavailable` (the session ends,
audited `game.channel_rejected`). A Discord refusal (Missing Access, Missing
Permissions, Unknown Channel) while posting or editing a live game is treated
the same way; other failures retry. The posted panel is reported with
`markGameMessagePosted`; a duplicate from an overlapping run is deleted and the
stored panel edited instead.

**Gateway listeners**: a live game's panel deleted by hand (`onMessageDelete`)
or in a purge (`onMessageDeleteBulk`) is re-posted at once; ended games and
other messages are left alone.

## Discord permissions

| Who      | In the session channel                                         |
| -------- | -------------------------------------------------------------- |
| The bot  | View Channel, Send Messages, Embed Links, Read Message History |
| The host | View Channel, Send Messages (checked before the first post)    |
| Players  | View Channel (buttons and ephemeral replies need nothing more) |

## Dashboard `/games`

Any member. One tab per registered game (TRIVIA, REACTION) and a metric switch
(wins · best score · sessions); the chosen metric is the highlighted column, the
others fold away on phones. Competition ranking (ties share a place), your own
row marked **YOU**, member names linked for viewers with `canViewMembers`. The
side panel lists the `/challenge` commands and the win rule. The same
leaderboard service as Discord: ranked sessions only, never solo practice, and
never a profile the viewer could not open (staff-only profiles are listed for
staff only).
