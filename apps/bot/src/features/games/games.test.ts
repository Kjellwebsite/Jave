import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import type { APIButtonComponent } from 'discord.js';
import { auditLogs, gameSessions, jobs, members } from '@jave/database';
import { games, type UserActor } from '@jave/core';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { channelAccessKey } from '../../testing/fake-gateway';
import { createBotHarness, type BotHarness } from '../../testing/harness';

/** FakeInteraction's default channel. */
const CHANNEL = '100000000000000555';
const SECOND = 1000;

type Player = { user: InteractionUser; actor: UserActor };

describe('games feature', () => {
  let bot: BotHarness;
  let host: Player;
  let rival: Player;

  beforeEach(async () => {
    bot = await createBotHarness();
    host = await bot.member({ roles: ['verified'], username: 'nova' });
    rival = await bot.member({ roles: ['member'], username: 'orion' });
  });
  afterEach(async () => {
    await bot.close();
  });

  const sessionRow = async () =>
    (
      await bot.kit.db.select().from(gameSessions).orderBy(desc(gameSessions.createdAt)).limit(1)
    )[0]!;

  async function panel(): Promise<MessagePayload> {
    const row = await sessionRow();
    expect(row.discordMessageId, 'the session has a panel').not.toBeNull();
    return bot.gateway.messages.get(row.discordMessageId!)!.payload;
  }

  const buttons = (payload: MessagePayload): APIButtonComponent[] =>
    (payload.components ?? []).flatMap((r) => r.components as APIButtonComponent[]);
  const buttonIds = (payload: MessagePayload) =>
    buttons(payload).map((b) => ('custom_id' in b ? b.custom_id : ''));
  const text = (payload: MessagePayload) =>
    (payload.embeds ?? [])
      .flatMap((e) => [
        e.author?.name ?? '',
        e.title ?? '',
        e.description ?? '',
        ...(e.fields ?? []).flatMap((f) => [f.name, f.value]),
      ])
      .join('\n');

  const press = (user: InteractionUser, name: string) => bot.run({ kind: 'button', name, user });

  async function openTrivia(options: Record<string, number | string> = {}): Promise<string> {
    const open = await bot.run({
      kind: 'slash',
      name: 'challenge',
      subcommand: 'trivia',
      user: host.user,
      options: { rounds: 5, seconds: 10, ...options },
    });
    expect(open.interaction.lastPayload()!.ephemeral).toBe(true);
    expect(open.interaction.lastText()).toContain('LOBBY OPEN');
    return (await sessionRow()).id;
  }

  /** The correct option of the current round, read from the engine state (tests only). */
  async function correctIndex(round: number): Promise<number> {
    const state = (await sessionRow()).state as { rounds: { correctIndex: number }[] };
    return state.rounds[round - 1]!.correctIndex;
  }

  describe('trivia over Discord', () => {
    it('runs lobby → questions → reveals → final standings, all on one panel', async () => {
      const id = await openTrivia();
      const lobby = await panel();
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(1);
      expect(text(lobby)).toContain('PLAYERS 1 / 25');
      expect(buttonIds(lobby)).toEqual([
        customId('games', 'join', id),
        customId('games', 'leave', id),
        customId('games', 'start', id),
        customId('games', 'abandon', id),
      ]);

      const joined = await press(rival.user, customId('games', 'join', id));
      expect(joined.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(joined.interaction.lastText()).toContain('2 / 25 players');
      expect(text(await panel())).toContain('PLAYERS 2 / 25');

      const started = await press(host.user, customId('games', 'start', id));
      expect(started.interaction.lastText()).toContain('STARTED');
      for (let round = 1; round <= 5; round++) {
        const question = await panel();
        expect(question.embeds![0]!.title).toBe(`ROUND ${round} / 5`);
        expect(text(question)).toMatch(/Closes <t:\d+:R> · 0 \/ 2 answered/);
        expect(buttonIds(question)).toEqual(
          [0, 1, 2, 3].map((choice) => customId('games', 'move', id, round, choice)),
        );
        expect(buttons(question).map((b) => ('label' in b ? b.label : ''))).toEqual([
          'A',
          'B',
          'C',
          'D',
        ]);

        const right = await correctIndex(round);
        const wrong = (right + 1) % 4;
        const answer = await press(host.user, customId('games', 'move', id, round, right));
        expect(answer.interaction.lastPayload()!.ephemeral).toBe(true);
        expect(answer.interaction.lastText()).toContain('ANSWER LOCKED');
        // The reply never says whether the answer was right.
        expect(answer.interaction.lastText()).not.toMatch(/correct|wrong/i);
        expect(text(await panel())).toContain('1 / 2 answered');

        await press(rival.user, customId('games', 'move', id, round, wrong));
        // Everyone answered: the round closes at once and the panel reveals.
        const reveal = await panel();
        expect(reveal.embeds![0]!.title).toBe(`ROUND ${round} / 5 · ANSWER`);
        expect(reveal.components).toEqual([]);
        expect(text(reveal)).toContain('SCOREBOARD');
        expect(text(reveal)).toContain(`<@${host.actor.discordId}>`);

        bot.kit.clock.advance(games.trivia.TRIVIA_REVEAL_MS + SECOND);
        await bot.drain();
      }

      const final = await panel();
      expect(final.embeds![0]!.title).toBe('FINAL STANDINGS');
      expect(text(final)).toContain(`WINNER — <@${host.actor.discordId}>`);
      expect(final.components).toEqual([]);
      expect((await sessionRow()).status).toBe('completed');
      // One panel for the whole game: posted once, then edited.
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(1);

      const board = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'leaderboard',
        user: rival.user,
      });
      expect(board.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(board.interaction.lastText()).toMatch(/`01` \*\*nova\*\* · 1 win/);
      expect(board.interaction.lastText()).toMatch(/`02` \*\*orion\*\* · 0 wins/);

      const bySessions = await press(rival.user, customId('games', 'board', 'trivia', 'sessions'));
      expect(bySessions.interaction.responses[0]?.type).toBe('update');
      expect(bySessions.interaction.lastText()).toContain('LEADERBOARD · SESSIONS');
    });

    it('closes an unanswered question at its deadline through the tick job', async () => {
      const id = await openTrivia();
      await press(rival.user, customId('games', 'join', id));
      await press(host.user, customId('games', 'start', id));
      await press(host.user, customId('games', 'move', id, 1, 0));
      bot.kit.clock.advance(10 * SECOND + SECOND);
      await bot.drain();
      const reveal = await panel();
      expect(reveal.embeds![0]!.title).toBe('ROUND 1 / 5 · ANSWER');
      expect(text(reveal)).toMatch(/Next question <t:\d+:R>/);
      bot.kit.clock.advance(games.trivia.TRIVIA_REVEAL_MS + SECOND);
      await bot.drain();
      expect((await panel()).embeds![0]!.title).toBe('ROUND 2 / 5');

      const late = await press(rival.user, customId('games', 'move', id, 1, 2));
      expect(late.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
    });

    it('a solo game is practice: no winner, nothing on the leaderboard', async () => {
      const id = await openTrivia();
      const started = await press(host.user, customId('games', 'start', id));
      expect(started.interaction.lastText()).toContain('practice');
      for (let round = 1; round <= 5; round++) {
        await press(host.user, customId('games', 'move', id, round, await correctIndex(round)));
        bot.kit.clock.advance(games.trivia.TRIVIA_REVEAL_MS + SECOND);
        await bot.drain();
      }
      expect(text(await panel())).toContain('PRACTICE');
      const board = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'leaderboard',
        user: host.user,
        options: { share: true },
      });
      expect(board.interaction.lastPayload()!.ephemeral).toBe(false);
      expect(board.interaction.lastPayload()!.components).toEqual([]);
      expect(board.interaction.lastText()).toContain('No ranked results yet');
    });

    it('the host stops a running game from /challenge stop', async () => {
      const id = await openTrivia();
      await press(rival.user, customId('games', 'join', id));
      await press(host.user, customId('games', 'start', id));
      const denied = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'stop',
        user: rival.user,
      });
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const prompt = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'stop',
        user: host.user,
      });
      expect(prompt.interaction.lastText()).toContain('STOP TRIVIA?');
      const confirm = await press(host.user, customId('games', 'abandon', id, 'confirm'));
      expect(confirm.interaction.responses[0]?.type).toBe('update');
      expect(confirm.interaction.lastText()).toContain('GAME STOPPED');
      const ended = await panel();
      expect(ended.embeds![0]!.title).toBe('GAME ENDED');
      expect(text(ended)).toContain('Stopped by the host.');
      expect(ended.components).toEqual([]);
      const nothing = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'stop',
        user: host.user,
      });
      expect(nothing.interaction.lastText()).toContain('NO GAME HERE');
    });

    it('re-posts a deleted panel of a live game, and only of a live game', async () => {
      const id = await openTrivia();
      const first = (await sessionRow()).discordMessageId!;
      bot.gateway.messages.delete(first);
      await bot.app.events.messageDelete({
        id: first,
        channelId: CHANNEL,
        guildId: bot.gateway.guildId,
      });
      await bot.settle();
      const second = (await sessionRow()).discordMessageId!;
      expect(second).not.toBe(first);
      expect(bot.gateway.messages.has(second)).toBe(true);
      expect(text(await panel())).toContain('LOBBY');

      // Deleting some other message in the channel changes nothing.
      await bot.app.events.messageDelete({
        id: '999',
        channelId: CHANNEL,
        guildId: bot.gateway.guildId,
      });
      await bot.settle();
      expect((await sessionRow()).discordMessageId).toBe(second);

      await press(host.user, customId('games', 'abandon', id, 'confirm'));
      bot.gateway.messages.delete(second);
      await bot.app.events.messageDelete({
        id: second,
        channelId: CHANNEL,
        guildId: bot.gateway.guildId,
      });
      await bot.settle();
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(2);
    });
    it('re-posts a live panel removed by a purge; purges without it change nothing', async () => {
      await openTrivia();
      const first = (await sessionRow()).discordMessageId!;
      await bot.app.events.messageDeleteBulk({
        ids: ['901', '902'],
        channelId: CHANNEL,
        guildId: bot.gateway.guildId,
      });
      await bot.settle();
      expect((await sessionRow()).discordMessageId).toBe(first);

      bot.gateway.messages.delete(first);
      await bot.app.events.messageDeleteBulk({
        ids: ['901', first],
        channelId: CHANNEL,
        guildId: bot.gateway.guildId,
      });
      await bot.settle();
      const second = (await sessionRow()).discordMessageId!;
      expect(second).not.toBe(first);
      expect(text(await panel())).toContain('LOBBY');

      // Another guild's purge is never ours to act on.
      bot.gateway.messages.delete(second);
      await bot.app.events.messageDeleteBulk({
        ids: [second],
        channelId: CHANNEL,
        guildId: '100000000000000111',
      });
      await bot.settle();
      expect((await sessionRow()).discordMessageId).toBe(second);
    });
  });

  describe('reaction over Discord', () => {
    it('wait → GO → results; an early tap is a false start', async () => {
      const open = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'reaction',
        user: host.user,
        options: { rounds: 3 },
      });
      expect(open.interaction.lastText()).toContain('REACTION');
      const id = (await sessionRow()).id;
      await press(rival.user, customId('games', 'join', id));
      await press(host.user, customId('games', 'start', id));
      const wait = await panel();
      expect(wait.embeds![0]!.title).toBe('WAIT FOR GO');
      expect(buttonIds(wait)).toEqual([customId('games', 'move', id, 1, 'tap')]);

      const early = await press(rival.user, customId('games', 'move', id, 1, 'tap'));
      expect(early.interaction.lastText()).toContain('FALSE START');

      bot.kit.clock.advance(5 * SECOND + SECOND);
      await bot.drain();
      const go = await panel();
      expect(go.embeds![0]!.title).toBe('GO');
      const tap = await press(host.user, customId('games', 'move', id, 1, 'tap'));
      expect(tap.interaction.lastText()).toContain('TAP RECORDED');
      // Both players have acted: the round resolves.
      const results = await panel();
      expect(results.embeds![0]!.title).toBe('ROUND 1 / 3 · RESULTS');
      expect(text(results)).toContain('FALSE START');
      expect(results.components).toEqual([]);
    });
  });

  describe('channel permission contract', () => {
    it('BREAK: a host who cannot post there gets no panel; the session ends, audited', async () => {
      bot.gateway.channelAccessOverrides.set(
        channelAccessKey(CHANNEL, { kind: 'member', userId: host.actor.discordId }),
        { textBased: true, view: true, send: false, embedLinks: true, readHistory: true },
      );
      const open = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
      });
      expect(open.interaction.lastText()).toContain('CHANNEL UNAVAILABLE');
      expect(open.interaction.lastText()).toContain('The host cannot post in that channel.');
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
      const row = await sessionRow();
      expect(row).toMatchObject({ status: 'abandoned', discordMessageId: null });
      const [audit] = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'game.channel_rejected'));
      expect(audit).toMatchObject({ result: 'denied' });
      expect(audit!.context).toMatchObject({ channelId: CHANNEL, reason: 'host_cannot_post' });
    });

    it('BREAK: the render job refuses a channel where JAVE cannot embed, whoever opened the session', async () => {
      bot.gateway.channelAccessOverrides.set(channelAccessKey(CHANNEL, { kind: 'bot' }), {
        textBased: true,
        view: true,
        send: true,
        embedLinks: false,
        readHistory: true,
      });
      // Straight through core, as any other surface could: the job is the enforcement point.
      const created = await games.createSession(bot.kit.as(host.actor), {
        gameKey: games.trivia.TRIVIA_KEY,
        surface: 'discord',
        discordChannelId: CHANNEL,
      });
      await bot.drain();
      const row = await sessionRow();
      expect(row).toMatchObject({ id: created.id, status: 'abandoned', discordMessageId: null });
      expect(row.endReason).toBe('JAVE cannot post in that channel.');
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
      const [audit] = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'game.channel_rejected'));
      expect(audit!.context).toMatchObject({ reason: 'bot_cannot_post' });

      const open = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
      });
      expect(open.interaction.lastText()).toContain('JAVE cannot post here');
    });

    it('BREAK: a channel JAVE cannot see is refused before any session exists', async () => {
      bot.gateway.channelAccessOverrides.set(channelAccessKey(CHANNEL, { kind: 'bot' }), null);
      const open = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
      });
      expect(open.interaction.lastText()).toContain('CHANNEL UNAVAILABLE');
      expect(open.interaction.lastText()).toContain('JAVE cannot post here');
      expect(await bot.kit.db.select().from(gameSessions)).toEqual([]);
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    });

    it('BREAK: Discord refusing the post (Missing Access) is treated like a refused channel', async () => {
      bot.gateway.failures.set(
        'sendMessage',
        new DiscordActionError('Missing Access', 50001, true),
      );
      await bot.run({ kind: 'slash', name: 'challenge', subcommand: 'trivia', user: host.user });
      expect((await sessionRow()).status).toBe('abandoned');
    });

    it('BREAK: losing permissions mid-game ends the game; other failures retry', async () => {
      const id = await openTrivia();
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('Missing Access', 50001, true),
      );
      await press(rival.user, customId('games', 'join', id));
      expect((await sessionRow()).status).toBe('abandoned');

      // A second lobby in the same channel, created later (the panel order is by creation).
      bot.kit.clock.advance(SECOND);
      const next = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
      });
      expect(next.interaction.lastText()).toContain('LOBBY OPEN');
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('Service Unavailable', 503, false),
      );
      await press(rival.user, customId('games', 'join', (await sessionRow()).id));
      expect((await sessionRow()).status).toBe('lobby');
      const [retrying] = await bot.kit.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.type, games.DISCORD_GAMES_RENDER_JOB), eq(jobs.status, 'pending')));
      expect(retrying?.lastError).toContain('Service Unavailable');
    });

    it('renders only the newest version; older render jobs skip as superseded', async () => {
      const id = await openTrivia();
      const third = await bot.member({ roles: ['verified'] });
      await games.joinSession(bot.kit.as(rival.actor), { sessionId: id });
      await games.joinSession(bot.kit.as(third.actor), { sessionId: id });
      await bot.drain();
      const results = await bot.kit.db
        .select({ result: jobs.result })
        .from(jobs)
        .where(eq(jobs.type, games.DISCORD_GAMES_RENDER_JOB));
      expect(results.map((r) => r.result)).toContainEqual({ skipped: 'superseded' });
      expect(text(await panel())).toContain('PLAYERS 3 / 25');
    });
  });

  describe('BREAK: custom ids route, they never authorize', () => {
    it('only the host (or event staff) starts or stops; staff overrides are audited', async () => {
      const id = await openTrivia();
      await press(rival.user, customId('games', 'join', id));
      const start = await press(rival.user, customId('games', 'start', id));
      expect(start.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const cancel = await press(rival.user, customId('games', 'abandon', id));
      expect(cancel.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await press(rival.user, customId('games', 'abandon', id, 'confirm'));
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect((await sessionRow()).status).toBe('lobby');

      const staff = await bot.member({ roles: ['operations'] });
      const staffStart = await press(staff.user, customId('games', 'start', id));
      expect(staffStart.interaction.lastText()).toContain('STARTED');
      const [override] = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'game.started_by_staff'));
      expect(override).toBeDefined();
    });

    it('spectators cannot answer; answers are one per round; forged moves are refused', async () => {
      const id = await openTrivia();
      await press(rival.user, customId('games', 'join', id));
      await press(host.user, customId('games', 'start', id));
      const spectator = await bot.member({ roles: ['verified'] });
      const refused = await press(spectator.user, customId('games', 'move', id, 1, 0));
      expect(refused.interaction.lastText()).toContain('ACCESS RESTRICTED');

      await press(host.user, customId('games', 'move', id, 1, 0));
      const twice = await press(host.user, customId('games', 'move', id, 1, 1));
      expect(twice.interaction.lastText()).toContain('CONFLICT');

      const outOfRange = await press(rival.user, customId('games', 'move', id, 1, 7));
      expect(outOfRange.interaction.lastText()).toContain('INVALID INPUT');
      const future = await press(rival.user, customId('games', 'move', id, 2, 0));
      expect(future.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
      const tapInTrivia = await press(rival.user, customId('games', 'move', id, 1, 'tap'));
      expect(tapInTrivia.interaction.lastText()).toContain('INVALID INPUT');

      const expired = [
        customId('games', 'move', id, 'x', 0),
        customId('games', 'move', id, 1, 'nuke'),
        customId('games', 'move', id, '1e2', 0),
        customId('games', 'join', 'not-a-uuid'),
        customId('games', 'selfdestruct', id),
        customId('games', 'board', 'chess', 'wins'),
        customId('games', 'board', 'trivia', 'elo'),
        'games',
      ];
      for (const name of expired) {
        // Stay under the router's per-user interaction limit.
        bot.kit.clock.advance(2 * SECOND);
        const { interaction } = await press(rival.user, name);
        expect(interaction.lastText(), name).toContain('EXPIRED');
      }
      const unknown = await press(
        rival.user,
        customId('games', 'join', '11111111-1111-4111-8111-111111111111'),
      );
      expect(unknown.interaction.lastText()).toContain('NOT FOUND');
    });

    it('stale lobby buttons after the start are refused; forged board selects expire', async () => {
      const id = await openTrivia();
      await press(rival.user, customId('games', 'join', id));
      await press(host.user, customId('games', 'start', id));
      const late = await bot.member({ roles: ['verified'] });
      const join = await press(late.user, customId('games', 'join', id));
      expect(join.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
      const leave = await press(rival.user, customId('games', 'leave', id));
      expect(leave.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
      expect((await sessionRow()).playerCount).toBe(2);

      const forgedGame = await bot.run({
        kind: 'select',
        name: customId('games', 'board-game', 'wins'),
        values: ['chess'],
        user: late.user,
      });
      expect(forgedGame.interaction.lastText()).toContain('EXPIRED');
      const forgedMetric = await bot.run({
        kind: 'select',
        name: customId('games', 'board-game', 'elo'),
        values: ['trivia'],
        user: late.user,
      });
      expect(forgedMetric.interaction.lastText()).toContain('EXPIRED');
      const switched = await bot.run({
        kind: 'select',
        name: customId('games', 'board-game', 'best_score'),
        values: ['reaction'],
        user: late.user,
      });
      expect(switched.interaction.responses[0]?.type).toBe('update');
      expect(switched.interaction.lastText()).toContain('LEADERBOARD · BEST SCORE');
      expect(switched.interaction.lastText()).toContain('REACTION');
    });

    it('restricted members cannot join; DMs and duplicate lobbies are refused', async () => {
      const id = await openTrivia();
      await bot.kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.userId, rival.actor.userId));
      const refused = await press(rival.user, customId('games', 'join', id));
      expect(refused.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const second = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
      });
      expect(second.interaction.lastText()).toContain('A game is already running here.');

      const dm = await bot.run({
        kind: 'slash',
        name: 'challenge',
        subcommand: 'trivia',
        user: host.user,
        guildId: null,
      });
      expect(dm.interaction.lastText()).toContain('not in direct messages');
    });
  });
});
