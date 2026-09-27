import { MockProvider, type MockResponder } from '@jave/ai';
import type { TargetMessage } from '../../interactions/types';
import { createBotHarness, discordUser, type BotHarness } from '../../testing/harness';

/**
 * TEST-ONLY helpers for the ai and research features. The provider is the
 * MOCK / DEVELOPMENT ONLY MockProvider with a scriptable reply.
 */

/** PGlite boots a migrated database per harness; generous on a shared machine. */
export const HARNESS_TIMEOUT_MS = 180_000;
export const SUITE = { timeout: 90_000 } as const;

export interface AiHarness {
  bot: BotHarness;
  mock: MockProvider;
  /** Next replies; falls back to a fixed calm answer. */
  script(responder: MockResponder | string): void;
}

export async function createAiHarness(): Promise<AiHarness> {
  let responder: MockResponder | null = null;
  const mock = new MockProvider({
    respond: (request, options) => (responder ? responder(request, options) : 'Calm answer.'),
  });
  const bot = await createBotHarness({ ai: { provider: mock } });
  return {
    bot,
    mock,
    script(next) {
      responder = typeof next === 'string' ? () => next : next;
    },
  };
}

let messageCounter = 500_000_000_000_000_000n;

/** A right-clicked message as the adapter would deliver it. */
export function targetMessage(
  content: string,
  overrides: Partial<TargetMessage> = {},
): TargetMessage {
  messageCounter += 1n;
  const id = messageCounter.toString();
  return {
    id,
    channelId: '100000000000000555',
    guildId: '100000000000000999',
    content,
    url: `https://discord.com/channels/100000000000000999/100000000000000555/${id}`,
    author: discordUser('100000000000000777', 'writer'),
    createdAt: new Date('2026-03-01T11:00:00.000Z'),
    attachments: [],
    embedsText: [],
    ...overrides,
  };
}
