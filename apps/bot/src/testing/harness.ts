import { createTestKit, type MemberOptions, type TestKit } from '@jave/core/testing';
import { type CoreConfig, silentLogger, type UserActor } from '@jave/core';
import { createBotApp, type BotApp } from '../app';
import { allFeatures } from '../features';
import type { BotFeature } from '../features/types';
import type { InteractionUser } from '../interactions/types';
import type { RouteOutcome } from '../interactions/router';
import { FakeDiscordGateway } from './fake-gateway';
import { FakeInteraction, type FakeInteractionInit } from './fake-interaction';

export const TEST_GUILD_ID = '100000000000000999';
export const TEST_CLIENT_ID = '100000000000000888';

export interface BotHarness {
  kit: TestKit;
  app: BotApp;
  gateway: FakeDiscordGateway;
  /** Create a member with roles; returns the actor and a matching Discord user. */
  member(options?: MemberOptions): Promise<{ actor: UserActor; user: InteractionUser }>;
  /** Run an interaction through the router and wait for its immediate side effects. */
  run(
    init: Omit<FakeInteractionInit, 'user'> & { user: InteractionUser },
  ): Promise<{ interaction: FakeInteraction; outcome: RouteOutcome }>;
  /** Run every due job. */
  drain(): Promise<void>;
  /** Await side effects scheduled by the router. */
  settle(): Promise<void>;
  close(): Promise<void>;
}

export function discordUser(id: string, username = `user${id.slice(-4)}`): InteractionUser {
  return { id, username, globalName: username, avatar: null, bot: false };
}

export async function createBotHarness(
  options: { features?: BotFeature[]; config?: Partial<CoreConfig> } = {},
): Promise<BotHarness> {
  const kit = await createTestKit(options.config);
  const gateway = new FakeDiscordGateway(TEST_GUILD_ID);
  const app = createBotApp({
    db: kit.db,
    clock: kit.clock,
    logger: silentLogger,
    cache: kit.cache,
    config: {
      founderDiscordIds: [],
      guildId: TEST_GUILD_ID,
      publicUrl: 'https://jave.test',
      ...options.config,
    },
    discord: { clientId: TEST_CLIENT_ID, guildId: TEST_GUILD_ID },
    gateway,
    features: options.features ?? allFeatures(),
    worker: { concurrency: 4, pollMs: 50 },
  });

  const pending: Promise<unknown>[] = [];
  const originalRunNow = app.services.runJobsNow;
  app.services.runJobsNow = (ids) => {
    const promise = originalRunNow(ids);
    pending.push(promise);
    return promise;
  };
  const settle = async () => {
    while (pending.length) await pending.shift();
  };

  return {
    kit,
    app,
    gateway,
    async member(memberOptions = {}) {
      const actor = await kit.member(memberOptions);
      const user = discordUser(actor.discordId, memberOptions.username ?? actor.displayName);
      gateway.addMember(actor.discordId, user.username);
      return { actor, user };
    },
    async run(init) {
      const interaction = new FakeInteraction(init);
      const outcome = await app.router.handle(interaction);
      await settle();
      return { interaction, outcome };
    },
    async drain() {
      await settle();
      await app.worker.drain();
    },
    settle,
    close: () => kit.close(),
  };
}
