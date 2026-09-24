import {
  AttachmentBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
  type User,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import type {
  CommandOptions,
  InteractionContext,
  InteractionKind,
  InteractionUser,
  ReplyPayload,
  TargetMessage,
} from './types';

function toUser(user: User): InteractionUser {
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    bot: user.bot,
  };
}

function toReplyOptions(payload: ReplyPayload): InteractionReplyOptions {
  return {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components,
    files: payload.files?.map(
      (f) => new AttachmentBuilder(f.data, { name: f.name, description: f.description }),
    ),
    flags: payload.ephemeral ? MessageFlags.Ephemeral : undefined,
    // Replies never ping anyone. Features that must mention do so explicitly in content.
    allowedMentions: { parse: [] },
  };
}

const EMPTY_OPTIONS: CommandOptions = {
  subcommand: () => null,
  subcommandGroup: () => null,
  string: () => null,
  integer: () => null,
  number: () => null,
  boolean: () => null,
  user: () => null,
  channel: () => null,
  focused: () => null,
};

function commandOptions(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
): CommandOptions {
  const o = interaction.options;
  return {
    subcommand: () => o.getSubcommand(false),
    subcommandGroup: () => o.getSubcommandGroup(false),
    string: (name) => o.getString(name),
    integer: (name) => o.getInteger(name),
    number: (name) => o.getNumber(name),
    boolean: (name) => o.getBoolean(name),
    user: (name) => {
      if (interaction.isAutocomplete()) return null;
      const user = (o as ChatInputCommandInteraction['options']).getUser(name);
      return user ? toUser(user) : null;
    },
    channel: (name) => {
      if (interaction.isAutocomplete()) return null;
      return (o as ChatInputCommandInteraction['options']).getChannel(name)?.id ?? null;
    },
    focused: () => {
      if (!interaction.isAutocomplete()) return null;
      const focused = interaction.options.getFocused(true);
      return { name: focused.name, value: String(focused.value) };
    },
  };
}

function targetMessage(interaction: MessageContextMenuCommandInteraction): TargetMessage {
  const m = interaction.targetMessage;
  return {
    id: m.id,
    channelId: m.channelId,
    guildId: m.guildId,
    content: m.content,
    url: m.url,
    author: toUser(m.author),
    createdAt: m.createdAt,
    attachments: m.attachments.map((a) => ({
      name: a.name,
      url: a.url,
      size: a.size,
      contentType: a.contentType,
    })),
    embedsText: m.embeds
      .map((e) => [e.title, e.description].filter(Boolean).join('\n'))
      .filter(Boolean),
  };
}

function kindOf(interaction: Interaction): InteractionKind | null {
  if (interaction.isChatInputCommand()) return 'slash';
  if (interaction.isUserContextMenuCommand()) return 'user_context';
  if (interaction.isMessageContextMenuCommand()) return 'message_context';
  if (interaction.isAutocomplete()) return 'autocomplete';
  if (interaction.isButton()) return 'button';
  if (interaction.isStringSelectMenu()) return 'select';
  if (interaction.isModalSubmit()) return 'modal';
  return null;
}

/** Wrap a discord.js interaction in JAVE's InteractionContext. Returns null for unsupported kinds. */
export function adaptInteraction(interaction: Interaction): InteractionContext | null {
  const kind = kindOf(interaction);
  if (!kind) return null;

  const repliable = interaction.isRepliable() ? (interaction as RepliableInteraction) : null;
  const component =
    interaction.isButton() || interaction.isStringSelectMenu()
      ? (interaction as ButtonInteraction | StringSelectMenuInteraction)
      : null;
  const modal = interaction.isModalSubmit() ? (interaction as ModalSubmitInteraction) : null;
  const memberRoles = interaction.inCachedGuild()
    ? interaction.member.roles.cache.map((r) => r.id)
    : [];

  let name = '';
  if (interaction.isCommand() || interaction.isAutocomplete()) name = interaction.commandName;
  else if (component) name = component.customId;
  else if (modal) name = modal.customId;

  const requireRepliable = (): RepliableInteraction => {
    if (!repliable) throw new Error(`${kind} interactions cannot reply`);
    return repliable;
  };

  return {
    kind,
    id: interaction.id,
    name,
    user: toUser(interaction.user),
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    memberRoleIds: memberRoles,
    locale: interaction.locale,
    options:
      interaction.isChatInputCommand() || interaction.isAutocomplete()
        ? commandOptions(interaction)
        : EMPTY_OPTIONS,
    values: interaction.isStringSelectMenu() ? interaction.values : [],
    modal: {
      text: (id) => modal?.fields.getTextInputValue(id) ?? '',
      select: (id) => {
        try {
          return modal?.fields.getStringSelectValues(id) ?? [];
        } catch {
          return [];
        }
      },
    },
    targetUser: interaction.isUserContextMenuCommand()
      ? toUser((interaction as UserContextMenuCommandInteraction).targetUser)
      : null,
    targetMessage: interaction.isMessageContextMenuCommand() ? targetMessage(interaction) : null,
    get replied() {
      return repliable?.replied ?? false;
    },
    get deferred() {
      return repliable?.deferred ?? false;
    },
    reply: async (payload) => void (await requireRepliable().reply(toReplyOptions(payload))),
    defer: async ({ ephemeral }) =>
      void (await requireRepliable().deferReply({
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      })),
    editReply: async (payload) => {
      const { flags: _flags, ...options } = toReplyOptions(payload);
      await requireRepliable().editReply(options);
    },
    followUp: async (payload) => void (await requireRepliable().followUp(toReplyOptions(payload))),
    update: async (payload) => {
      if (!component) throw new Error('update() is only valid for component interactions');
      const { flags: _flags, ...options } = toReplyOptions(payload);
      await component.update(options);
    },
    deferUpdate: async () => {
      if (!component) throw new Error('deferUpdate() is only valid for component interactions');
      await component.deferUpdate();
    },
    showModal: async (payload) => {
      if (!interaction.isChatInputCommand() && !interaction.isContextMenuCommand() && !component) {
        throw new Error('showModal() is not valid for this interaction');
      }
      await (interaction as ChatInputCommandInteraction).showModal(payload);
    },
    autocomplete: async (choices) => {
      if (!interaction.isAutocomplete())
        throw new Error('autocomplete() is only valid for autocomplete interactions');
      await interaction.respond(choices.slice(0, 25));
    },
  };
}
