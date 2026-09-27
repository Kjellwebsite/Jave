import { eq } from 'drizzle-orm';
import { jobs, modCases, securityEvents } from '@jave/database';
import { updateSettings } from '@jave/core';
import type { IncomingMessage } from '../../gateway-events/types';
import type { InteractionUser, TargetMessage } from '../../interactions/types';
import type { RecordedResponse } from '../../testing/fake-interaction';
import type { BotHarness } from '../../testing/harness';
import { TEST_GUILD_ID } from '../../testing/harness';

/** Test fixtures for the moderation feature (not imported by production code). */

export const QUARANTINE_ROLE_ID = '410000000000000001';
export const VERIFIED_ROLE_ID = '410000000000000002';
export const MEMBER_ROLE_ID = '410000000000000003';
export const ALERT_CHANNEL_ID = '510000000000000001';
export const CHAT_CHANNEL_ID = '510000000000000002';

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const TIMESTAMP_SHIFT = 22n;
let sequence = 0n;

/** A Discord ID whose embedded creation time is `date`. */
export function snowflakeAt(date: Date): string {
  sequence += 1n;
  return (((BigInt(date.getTime()) - DISCORD_EPOCH_MS) << TIMESTAMP_SHIFT) + sequence).toString();
}

export async function configureModeration(
  bot: BotHarness,
  options: { quarantineRole?: boolean; alertChannel?: boolean } = {},
): Promise<void> {
  await updateSettings(bot.kit.system, 'roles', {
    ...(options.quarantineRole !== false && { quarantineRoleId: QUARANTINE_ROLE_ID }),
    discordRoleIds: { verified: VERIFIED_ROLE_ID, member: MEMBER_ROLE_ID },
  });
  if (options.alertChannel !== false) {
    await updateSettings(bot.kit.system, 'channels', { securityAlerts: ALERT_CHANNEL_ID });
  }
}

export function incomingMessage(
  author: InteractionUser,
  content: string,
  overrides: Partial<IncomingMessage> = {},
  at: Date = new Date('2026-03-01T12:00:00.000Z'),
): IncomingMessage {
  const id = snowflakeAt(at);
  return {
    id,
    channelId: CHAT_CHANNEL_ID,
    guildId: TEST_GUILD_ID,
    parentChannelId: null,
    isThread: false,
    author: { ...author },
    authorRoleIds: [],
    content,
    mentionCount: 0,
    mentionsEveryone: false,
    attachments: [],
    createdAt: at,
    url: `https://discord.com/channels/${TEST_GUILD_ID}/${CHAT_CHANNEL_ID}/${id}`,
    ...overrides,
  };
}

export function targetMessage(
  author: InteractionUser,
  content: string,
  at: Date = new Date('2026-03-01T11:59:00.000Z'),
): TargetMessage {
  const id = snowflakeAt(at);
  return {
    id,
    channelId: CHAT_CHANNEL_ID,
    guildId: TEST_GUILD_ID,
    content,
    url: `https://discord.com/channels/${TEST_GUILD_ID}/${CHAT_CHANNEL_ID}/${id}`,
    author: { ...author },
    createdAt: at,
    attachments: [],
    embedsText: [],
  };
}

/** The modal a response opened, if any. */
export function modalOf(responses: readonly RecordedResponse[]) {
  const found = responses.find((r) => r.type === 'modal');
  return found && found.type === 'modal' ? found.modal : null;
}

/** Every custom id on the components of the last payload. */
export function customIdsOf(payload: { components?: unknown[] } | null): string[] {
  const ids: string[] = [];
  for (const rowValue of payload?.components ?? []) {
    const components = (rowValue as { components?: { custom_id?: string }[] }).components ?? [];
    for (const component of components) if (component.custom_id) ids.push(component.custom_id);
  }
  return ids;
}

/** Options of the select with this custom-id prefix on the last payload. */
export function selectOptions(
  payload: { components?: unknown[] } | null,
  prefix: string,
): { label: string; value: string }[] {
  for (const rowValue of payload?.components ?? []) {
    const components =
      (
        rowValue as {
          components?: { custom_id?: string; options?: { label: string; value: string }[] }[];
        }
      ).components ?? [];
    const select = components.find((c) => c.custom_id?.startsWith(prefix));
    if (select?.options) return select.options;
  }
  return [];
}

export async function casesFor(bot: BotHarness, targetUserId: string) {
  return bot.kit.db.select().from(modCases).where(eq(modCases.targetUserId, targetUserId));
}

export async function allSecurityEvents(bot: BotHarness) {
  return bot.kit.db.select().from(securityEvents);
}

export async function jobsOfType(bot: BotHarness, type: string) {
  return bot.kit.db.select().from(jobs).where(eq(jobs.type, type));
}
