import { type JobHandler, trials } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { briefMessages, warningMessage } from '../render/cards';
import { parsePayload, toJobError } from './support';

/** Thrown while a team channel is still being provisioned: the worker retries with backoff. */
export class ChannelNotReadyError extends Error {
  constructor(reason: string) {
    super(`brief waits: ${reason}`);
    this.name = 'ChannelNotReadyError';
  }
}

/**
 * discord.trials.brief — post the mission brief in the team channel once
 * the trial is active, then mark the team briefed (which makes re-runs skip).
 */
export function briefHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const { teamId } = parsePayload(trials.briefJobSchema, payload);
    const spec = await trials.getTeamBriefSpec(ctx, { teamId });
    if (spec.action === 'skip') return { skipped: spec.reason };
    if (spec.action === 'wait') throw new ChannelNotReadyError(spec.reason);
    try {
      const messages = briefMessages(spec);
      for (const message of messages) await services.gateway.sendMessage(spec.channelId, message);
      await trials.markTeamBriefed(ctx, { teamId: spec.teamId });
      return { briefed: spec.teamId, messages: messages.length };
    } catch (error) {
      throw toJobError(error);
    }
  };
}

/** discord.trials.warning — time-remaining notice in one team channel. No callback. */
export function warningHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const data = parsePayload(trials.warningJobSchema, payload);
    const spec = await trials.getTeamWarningSpec(ctx, {
      teamId: data.teamId,
      minutesRemaining: data.minutesRemaining,
      deadlineAt: data.deadlineAt,
    });
    if (spec.action === 'skip') return { skipped: spec.reason };
    try {
      const sent = await services.gateway.sendMessage(
        spec.channelId,
        warningMessage(data.trialId, spec),
      );
      return { warned: sent.messageId };
    } catch (error) {
      throw toJobError(error);
    }
  };
}
