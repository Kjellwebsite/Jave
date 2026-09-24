import type {
  AutocompleteChoice,
  CommandOptions,
  InteractionContext,
  InteractionKind,
  InteractionUser,
  ModalPayload,
  ReplyPayload,
  TargetMessage,
} from '../interactions/types';

export interface FakeInteractionInit {
  kind: InteractionKind;
  name: string;
  user: InteractionUser;
  guildId?: string | null;
  channelId?: string | null;
  memberRoleIds?: string[];
  subcommand?: string;
  subcommandGroup?: string;
  options?: Record<string, string | number | boolean | InteractionUser | null>;
  focused?: { name: string; value: string };
  values?: string[];
  modalText?: Record<string, string>;
  modalSelect?: Record<string, string[]>;
  targetUser?: InteractionUser;
  targetMessage?: TargetMessage;
}

export type RecordedResponse =
  | { type: 'reply' | 'editReply' | 'followUp' | 'update'; payload: ReplyPayload }
  | { type: 'defer'; ephemeral: boolean }
  | { type: 'deferUpdate' }
  | { type: 'modal'; modal: ModalPayload }
  | { type: 'autocomplete'; choices: AutocompleteChoice[] };

let interactionCounter = 0;

/**
 * Fake interaction that behaves like Discord's response rules (one initial
 * response; editReply only after defer/reply) and records everything.
 */
export class FakeInteraction implements InteractionContext {
  readonly kind: InteractionKind;
  readonly id = `fake-${++interactionCounter}`;
  readonly name: string;
  readonly user: InteractionUser;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly memberRoleIds: string[];
  readonly locale = 'en-US';
  readonly values: string[];
  readonly targetUser: InteractionUser | null;
  readonly targetMessage: TargetMessage | null;
  readonly responses: RecordedResponse[] = [];
  readonly options: CommandOptions;
  readonly modal: InteractionContext['modal'];
  private _replied = false;
  private _deferred = false;

  constructor(init: FakeInteractionInit) {
    this.kind = init.kind;
    this.name = init.name;
    this.user = init.user;
    this.guildId = init.guildId === undefined ? '100000000000000999' : init.guildId;
    this.channelId = init.channelId ?? '100000000000000555';
    this.memberRoleIds = init.memberRoleIds ?? [];
    this.values = init.values ?? [];
    this.targetUser = init.targetUser ?? null;
    this.targetMessage = init.targetMessage ?? null;
    const opts = init.options ?? {};
    const get = <T>(name: string, check: (v: unknown) => boolean): T | null => {
      const value = opts[name];
      return value !== undefined && value !== null && check(value) ? (value as T) : null;
    };
    this.options = {
      subcommand: () => init.subcommand ?? null,
      subcommandGroup: () => init.subcommandGroup ?? null,
      string: (n) => get<string>(n, (v) => typeof v === 'string'),
      integer: (n) => get<number>(n, (v) => typeof v === 'number'),
      number: (n) => get<number>(n, (v) => typeof v === 'number'),
      boolean: (n) => get<boolean>(n, (v) => typeof v === 'boolean'),
      user: (n) => get<InteractionUser>(n, (v) => typeof v === 'object'),
      channel: (n) => get<string>(n, (v) => typeof v === 'string'),
      focused: () => init.focused ?? null,
    };
    this.modal = {
      text: (id) => init.modalText?.[id] ?? '',
      select: (id) => init.modalSelect?.[id] ?? [],
    };
  }

  get replied() {
    return this._replied;
  }
  get deferred() {
    return this._deferred;
  }

  private assertFresh(action: string) {
    if (this._replied || this._deferred)
      throw new Error(`Interaction already acknowledged (${action})`);
  }

  async reply(payload: ReplyPayload) {
    this.assertFresh('reply');
    this._replied = true;
    this.responses.push({ type: 'reply', payload });
  }
  async defer({ ephemeral }: { ephemeral: boolean }) {
    this.assertFresh('defer');
    this._deferred = true;
    this.responses.push({ type: 'defer', ephemeral });
  }
  async editReply(payload: ReplyPayload) {
    if (!this._replied && !this._deferred) throw new Error('editReply before reply/defer');
    this._replied = true;
    this.responses.push({ type: 'editReply', payload });
  }
  async followUp(payload: ReplyPayload) {
    if (!this._replied && !this._deferred) throw new Error('followUp before reply/defer');
    this.responses.push({ type: 'followUp', payload });
  }
  async update(payload: ReplyPayload) {
    if (this.kind !== 'button' && this.kind !== 'select')
      throw new Error('update on non-component');
    this.assertFresh('update');
    this._replied = true;
    this.responses.push({ type: 'update', payload });
  }
  async deferUpdate() {
    this.assertFresh('deferUpdate');
    this._deferred = true;
    this.responses.push({ type: 'deferUpdate' });
  }
  async showModal(modal: ModalPayload) {
    if (this.kind === 'modal' || this.kind === 'autocomplete')
      throw new Error('cannot show a modal from this interaction');
    this.assertFresh('showModal');
    this._replied = true;
    this.responses.push({ type: 'modal', modal });
  }
  async autocomplete(choices: AutocompleteChoice[]) {
    if (this.kind !== 'autocomplete') throw new Error('autocomplete on non-autocomplete');
    this.responses.push({ type: 'autocomplete', choices });
  }

  /** The last message-like payload (reply/editReply/followUp/update). */
  lastPayload(): ReplyPayload | null {
    for (let i = this.responses.length - 1; i >= 0; i--) {
      const r = this.responses[i]!;
      if ('payload' in r) return r.payload;
    }
    return null;
  }

  /** Title + description + field text of the last payload, for assertions. */
  lastText(): string {
    const payload = this.lastPayload();
    if (!payload) return '';
    const parts = [payload.content ?? ''];
    for (const embed of payload.embeds ?? []) {
      parts.push(embed.author?.name ?? '', embed.title ?? '', embed.description ?? '');
      for (const f of embed.fields ?? []) parts.push(f.name, f.value);
    }
    return parts.filter(Boolean).join('\n');
  }
}
