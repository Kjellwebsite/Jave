import {
  createContext,
  newRequestId,
  resolveUserActor,
  type ServiceContext,
  SlidingWindowCounter,
  syncDiscordUser,
  can,
} from '@jave/core';
import type { BotFeature } from '../features/types';
import type { BotServices } from '../runtime';
import { failure } from '../ui/components';
import { parseCustomId } from './custom-id';
import { renderError } from './errors';
import type {
  CommandDefinition,
  ComponentHandler,
  HandlerContext,
  InteractionContext,
  ModalHandler,
  ReplyPayload,
} from './types';

/** Per-user interaction budget (excluding autocomplete). */
export const INTERACTION_LIMIT = { max: 12, windowMs: 10_000 } as const;

export interface RouteOutcome {
  outcome: 'ok' | 'error' | 'rejected' | 'unknown';
  errorId?: string | null;
  durationMs: number;
}

/**
 * Routes every interaction to its handler with a consistent envelope:
 * guild guard → rate limit → identity sync → capability gate → handler →
 * error rendering → immediate execution of queued Discord side effects.
 */
export class InteractionRouter {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly components = new Map<string, ComponentHandler>();
  private readonly modals = new Map<string, ModalHandler>();
  private readonly limiter = new SlidingWindowCounter(INTERACTION_LIMIT.windowMs);

  constructor(
    features: readonly BotFeature[],
    private readonly services: BotServices,
  ) {
    for (const feature of features) {
      for (const command of feature.commands ?? []) {
        const key = `${command.kind}:${command.data.name}`;
        if (this.commands.has(key)) throw new Error(`duplicate command ${key}`);
        this.commands.set(key, command);
      }
      for (const handler of feature.components ?? []) {
        if (this.components.has(handler.namespace))
          throw new Error(`duplicate component namespace ${handler.namespace}`);
        this.components.set(handler.namespace, handler);
      }
      for (const handler of feature.modals ?? []) {
        if (this.modals.has(handler.namespace))
          throw new Error(`duplicate modal namespace ${handler.namespace}`);
        this.modals.set(handler.namespace, handler);
      }
    }
  }

  listCommands(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  private async buildContext(
    interaction: InteractionContext,
    requestId: string,
  ): Promise<ServiceContext> {
    const { db, clock, logger, cache, config } = this.services;
    const base = createContext({
      db,
      clock,
      cache,
      config,
      requestId,
      logger,
      actor: { kind: 'system', reason: 'interaction:identity-sync' },
    });
    const { user } = await syncDiscordUser(
      base,
      {
        discordId: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.user.globalName,
        avatarHash: interaction.user.avatar,
        isBot: interaction.user.bot,
      },
      { inGuild: interaction.guildId === this.services.discord.guildId },
    );
    const actor = await resolveUserActor(base, user.id);
    return { ...base, actor, effects: { jobIds: [] } };
  }

  private handlerContext(interaction: InteractionContext, ctx: ServiceContext): HandlerContext {
    return {
      interaction,
      ctx,
      services: this.services,
      respond: async (payload: ReplyPayload) => {
        if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
        if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
        return interaction.reply(payload);
      },
    };
  }

  async handle(interaction: InteractionContext): Promise<RouteOutcome> {
    const started = performance.now();
    const requestId = newRequestId();
    const log = this.services.logger.child({
      requestId,
      interactionId: interaction.id,
      kind: interaction.kind,
      name: interaction.name,
      userId: interaction.user.id,
    });
    const done = (
      outcome: RouteOutcome['outcome'],
      errorId: string | null = null,
    ): RouteOutcome => {
      const durationMs = Math.round(performance.now() - started);
      log.info({ outcome, durationMs, errorId }, 'interaction');
      return { outcome, errorId, durationMs };
    };

    if (interaction.guildId && interaction.guildId !== this.services.discord.guildId) {
      await interaction.reply({
        embeds: [failure('UNAVAILABLE', 'JAVE operates only inside JAVELIN.')],
        ephemeral: true,
      });
      return done('rejected');
    }
    if (interaction.user.bot) return done('rejected');

    if (interaction.kind !== 'autocomplete') {
      const hits = this.limiter.hit(interaction.user.id, this.services.clock.now().getTime());
      if (hits > INTERACTION_LIMIT.max) {
        await interaction.reply({
          embeds: [failure('RATE LIMITED', 'Too many actions. Wait a few seconds.')],
          ephemeral: true,
        });
        return done('rejected');
      }
    }

    let ctx: ServiceContext | null = null;
    try {
      ctx = await this.buildContext(interaction, requestId);
      const h = this.handlerContext(interaction, { ...ctx, logger: log });
      const routed = await this.dispatch(h);
      return done(routed ? 'ok' : 'unknown');
    } catch (error) {
      const { payload, errorId } = renderError(error, log);
      if (interaction.kind === 'autocomplete') {
        await interaction.autocomplete([]).catch(() => undefined);
      } else {
        const respond =
          interaction.deferred && !interaction.replied
            ? interaction.editReply(payload)
            : interaction.replied
              ? interaction.followUp(payload)
              : interaction.reply(payload);
        await respond.catch((replyError: unknown) =>
          log.warn({ err: replyError }, 'failed to deliver error reply'),
        );
      }
      return done('error', errorId);
    } finally {
      const jobIds = ctx?.effects.jobIds ?? [];
      if (jobIds.length > 0) {
        this.services
          .runJobsNow(jobIds)
          .catch((error: unknown) => log.error({ err: error }, 'immediate job execution failed'));
      }
    }
  }

  private async dispatch(h: HandlerContext): Promise<boolean> {
    const { interaction } = h;
    switch (interaction.kind) {
      case 'slash':
      case 'user_context':
      case 'message_context':
      case 'autocomplete': {
        const kind = interaction.kind === 'autocomplete' ? 'slash' : interaction.kind;
        const command = this.commands.get(`${kind}:${interaction.name}`);
        if (!command) {
          if (interaction.kind !== 'autocomplete')
            await h.respond({
              embeds: [
                failure(
                  'UNKNOWN COMMAND',
                  'This command is not available. It may have been retired.',
                ),
              ],
              ephemeral: true,
            });
          return false;
        }
        if (interaction.kind === 'autocomplete') {
          if (command.autocomplete) await command.autocomplete(h);
          else await interaction.autocomplete([]);
          return true;
        }
        if (command.requires && !can(h.ctx, command.requires)) {
          await h.respond({
            embeds: [failure('ACCESS RESTRICTED', 'Your role does not include this capability.')],
            ephemeral: true,
          });
          return true;
        }
        if (command.defer) await interaction.defer({ ephemeral: command.defer === 'ephemeral' });
        await command.execute(h);
        return true;
      }
      case 'button':
      case 'select':
      case 'modal': {
        const parsed = parseCustomId(interaction.name);
        const handler =
          parsed &&
          (interaction.kind === 'modal'
            ? this.modals.get(parsed.namespace)
            : this.components.get(parsed.namespace));
        if (!parsed || !handler) {
          await h.respond({
            embeds: [failure('EXPIRED', 'This control is no longer active.')],
            ephemeral: true,
          });
          return false;
        }
        await handler.handle(h, parsed.action, parsed.args);
        return true;
      }
    }
  }
}
