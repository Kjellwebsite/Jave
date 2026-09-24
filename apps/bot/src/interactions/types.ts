import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  APIModalInteractionResponseCallbackData,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';
import type { Capability, ServiceContext } from '@jave/core';
import type { BotServices } from '../runtime';

/**
 * JAVE's own interaction abstraction. Handlers never touch discord.js
 * interaction objects directly — the adapter translates, and tests drive
 * handlers through a fake implementation of the same interface.
 */

export interface InteractionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  bot: boolean;
}

export interface FileAttachment {
  name: string;
  data: Buffer;
  description?: string;
}

/** Everything a response can carry. Embeds/components are plain API JSON. */
export interface ReplyPayload {
  content?: string;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIComponentInMessageActionRow>[];
  files?: FileAttachment[];
  /** Ephemeral replies are only visible to the invoking user. */
  ephemeral?: boolean;
}

export type ModalPayload = APIModalInteractionResponseCallbackData;

export interface AutocompleteChoice {
  name: string;
  value: string;
}

export interface CommandOptions {
  subcommand(): string | null;
  subcommandGroup(): string | null;
  string(name: string): string | null;
  integer(name: string): number | null;
  number(name: string): number | null;
  boolean(name: string): boolean | null;
  user(name: string): InteractionUser | null;
  /** Channel id option. */
  channel(name: string): string | null;
  /** For autocomplete: the focused option. */
  focused(): { name: string; value: string } | null;
}

export interface TargetMessage {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  url: string;
  author: InteractionUser;
  createdAt: Date;
  attachments: { name: string; url: string; size: number; contentType: string | null }[];
  embedsText: string[];
}

export type InteractionKind =
  'slash' | 'user_context' | 'message_context' | 'button' | 'select' | 'modal' | 'autocomplete';

export interface InteractionContext {
  kind: InteractionKind;
  id: string;
  /** Command name (slash/context/autocomplete) or custom id (components/modals). */
  name: string;
  user: InteractionUser;
  guildId: string | null;
  channelId: string | null;
  /** Discord role ids the user holds in this guild (empty in DMs). */
  memberRoleIds: readonly string[];
  locale: string;
  options: CommandOptions;
  /** Selected values for select menus. */
  values: readonly string[];
  /** Modal fields by custom id. */
  modal: { text(customId: string): string; select(customId: string): readonly string[] };
  targetUser: InteractionUser | null;
  targetMessage: TargetMessage | null;

  readonly replied: boolean;
  readonly deferred: boolean;
  reply(payload: ReplyPayload): Promise<void>;
  defer(options: { ephemeral: boolean }): Promise<void>;
  editReply(payload: ReplyPayload): Promise<void>;
  followUp(payload: ReplyPayload): Promise<void>;
  /** Components only: replace the message the component is attached to. */
  update(payload: ReplyPayload): Promise<void>;
  deferUpdate(): Promise<void>;
  showModal(modal: ModalPayload): Promise<void>;
  autocomplete(choices: AutocompleteChoice[]): Promise<void>;
}

/** What every handler receives. */
export interface HandlerContext {
  interaction: InteractionContext;
  /** Service context acting as the invoking user. */
  ctx: ServiceContext;
  services: BotServices;
  /** Respond with the right primitive whether or not the interaction was deferred. */
  respond(payload: ReplyPayload): Promise<void>;
}

export interface CommandDefinition {
  /** Deployed JSON (built with discord.js builders). */
  data: RESTPostAPIApplicationCommandsJSONBody;
  kind: 'slash' | 'user_context' | 'message_context';
  /** Shown in /help. Omit to hide. */
  help?: { category: HelpCategory; summary: string; usage?: string };
  /** UI-level gate; services still enforce authorization. */
  requires?: Capability;
  /** Defer before executing (for slow handlers). */
  defer?: 'ephemeral' | 'public';
  execute(h: HandlerContext): Promise<void>;
  autocomplete?(h: HandlerContext): Promise<void>;
}

export type HelpCategory =
  'identity' | 'progression' | 'operations' | 'community' | 'intelligence' | 'staff' | 'system';

/**
 * Component and modal handlers are addressed by custom id namespace:
 * custom ids look like `ns:action:arg1:arg2` (see custom-id.ts).
 */
export interface ComponentHandler {
  namespace: string;
  handle(h: HandlerContext, action: string, args: readonly string[]): Promise<void>;
}

export interface ModalHandler {
  namespace: string;
  handle(h: HandlerContext, action: string, args: readonly string[]): Promise<void>;
}
