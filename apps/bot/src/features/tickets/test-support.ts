/**
 * TEST-ONLY helpers for the tickets feature. Never imported by production code.
 */
import { eq } from 'drizzle-orm';
import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord.js';
import { jobs, tickets as ticketsTable, users } from '@jave/database';
import { type OrgRole, updateSettings } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import type { IncomingMessage } from '../../gateway-events/types';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { type BotHarness, createBotHarness } from '../../testing/harness';
import { ACTION, FIELD, TICKETS_NS } from './constants';

export const TICKET_CHANNEL_ID = '300000000000000101';
export const ARCHIVE_CHANNEL_ID = '300000000000000102';
/** PGlite integration suites run several statements per step on a shared machine. */
export const SUITE = { timeout: 120_000 } as const;
export const HOOK_TIMEOUT = 180_000;

let messageCounter = 700_000_000_000_000_000n;
export function nextMessageId(): string {
  messageCounter += 1n;
  return messageCounter.toString();
}

/** Harness with the ticket and archive channels configured. */
export async function ticketBot(): Promise<BotHarness> {
  const bot = await createBotHarness();
  await updateSettings(bot.kit.system, 'channels', {
    tickets: TICKET_CHANNEL_ID,
    ticketArchive: ARCHIVE_CHANNEL_ID,
  });
  return bot;
}

export async function person(bot: BotHarness, roles: OrgRole[], username?: string) {
  return bot.member({ roles, username });
}

export interface OpenedTicket {
  id: string;
  number: number;
  threadId: string;
  cardMessageId: string;
}

/** The whole Discord path: /ticket open → category select → modal submit → thread job. */
export async function openViaDiscord(
  bot: BotHarness,
  user: InteractionUser,
  input: { category?: string; subject?: string; body?: string; priority?: string } = {},
): Promise<OpenedTicket> {
  const category = input.category ?? 'technical';
  await bot.run({ kind: 'slash', name: 'ticket', subcommand: 'open', user });
  await bot.run({
    kind: 'select',
    name: customId(TICKETS_NS, ACTION.category),
    user,
    values: [category],
  });
  const submitted = await bot.run({
    kind: 'modal',
    name: customId(TICKETS_NS, ACTION.open, category),
    user,
    modalText: {
      [FIELD.subject]: input.subject ?? 'Build pipeline fails on deploy',
      [FIELD.body]: input.body ?? 'The deploy step exits with code 137 since yesterday.',
    },
    modalSelect: { [FIELD.priority]: [input.priority ?? 'normal'] },
  });
  if (!submitted.interaction.lastText().includes('OPENED')) {
    throw new Error(`open failed: ${submitted.interaction.lastText()}`);
  }
  const [row] = await bot.kit.db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.openerUserId, (await userIdOf(bot, user.id))!));
  if (!row?.discordThreadId || !row.discordCardMessageId) throw new Error('thread not provisioned');
  return {
    id: row.id,
    number: row.number,
    threadId: row.discordThreadId,
    cardMessageId: row.discordCardMessageId,
  };
}

async function userIdOf(bot: BotHarness, discordId: string): Promise<string | null> {
  const [row] = await bot.kit.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, discordId));
  return row?.id ?? null;
}

export async function ticketRow(bot: BotHarness, ticketId: string) {
  const [row] = await bot.kit.db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId));
  if (!row) throw new Error('ticket not found');
  return row;
}

export async function jobsOfType(bot: BotHarness, type: string) {
  return bot.kit.db.select().from(jobs).where(eq(jobs.type, type));
}

/** Every custom id on a message or reply payload. */
export function customIdsOf(payload: {
  components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
}): string[] {
  return (payload.components ?? []).flatMap((r) =>
    r.components.flatMap((c) => ('custom_id' in c ? [c.custom_id] : [])),
  );
}

/** Title, description, fields and content of a message payload. */
export function textOf(payload: MessagePayload): string {
  const parts = [payload.content ?? ''];
  for (const embed of payload.embeds ?? []) {
    parts.push(embed.author?.name ?? '', embed.title ?? '', embed.description ?? '');
    for (const f of embed.fields ?? []) parts.push(f.name, f.value);
    parts.push(embed.footer?.text ?? '');
  }
  return parts.filter(Boolean).join('\n');
}

/** Messages the bot posted into a channel, oldest first. */
export function postedTo(bot: BotHarness, channelId: string): MessagePayload[] {
  return bot.gateway
    .callsTo('sendMessage')
    .filter((call) => call.args[0] === channelId)
    .map((call) => call.args[1] as MessagePayload);
}

/** Current state of a message the bot posted (after edits). */
export function messageState(bot: BotHarness, messageId: string): MessagePayload {
  const message = bot.gateway.messages.get(messageId);
  if (!message) throw new Error(`message ${messageId} not found`);
  return message.payload;
}

export function threadMessage(
  threadId: string,
  author: InteractionUser,
  content: string,
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    id: nextMessageId(),
    channelId: threadId,
    guildId: '100000000000000999',
    parentChannelId: TICKET_CHANNEL_ID,
    isThread: true,
    author: { ...author },
    authorRoleIds: [],
    content,
    mentionCount: 0,
    mentionsEveryone: false,
    attachments: [],
    createdAt: new Date('2026-03-01T12:05:00.000Z'),
    url: `https://discord.com/channels/100000000000000999/${threadId}`,
    ...overrides,
  };
}
