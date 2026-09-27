import {
  adversarial,
  isJaveError,
  type JobHandler,
  type JobHandlerMap,
  PermanentJobError,
} from '@jave/core';
import type { DiscordGateway, MessagePayload, SentMessage } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { isPermanentDiscordError, parsePayload } from '../trials/jobs/support';
import { briefingMessages, debriefMessages, stopMessage } from './render';

type DeliveryOutcome = 'sent' | 'undeliverable';

/**
 * A loader refusing with INVALID_STATE or NOT_FOUND means "this must not be
 * sent any more" (role aborted, revealed, gone): finish permanently, send nothing.
 */
async function loadOrStop<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isJaveError(error) && (error.code === 'INVALID_STATE' || error.code === 'NOT_FOUND'))
      throw new PermanentJobError(`not sent: ${error.userMessage}`);
    throw error;
  }
}

/**
 * DM every message in order. Closed DMs and permanent refusals are
 * 'undeliverable' (reported, escalated by core); transient failures throw.
 */
async function directMessages(
  gateway: DiscordGateway,
  userId: string,
  messages: readonly MessagePayload[],
): Promise<DeliveryOutcome> {
  try {
    for (const message of messages) {
      const sent = await gateway.sendDirectMessage(userId, message);
      if (!sent) return 'undeliverable';
    }
    return 'sent';
  } catch (error) {
    if (isPermanentDiscordError(error)) return 'undeliverable';
    throw error;
  }
}

/** discord.adversarial.brief — DM the operative's briefing (current revision only). */
export function briefHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const data = parsePayload(adversarial.adversarialBriefPayloadSchema, payload);
    const delivery = await loadOrStop(() => adversarial.loadBriefingDelivery(ctx, data));
    if (delivery.superseded) return { skipped: 'superseded by a newer revision' };
    if (delivery.alreadyDelivered) return { skipped: 'already delivered' };
    const outcome = await directMessages(
      services.gateway,
      delivery.operativeDiscordId,
      briefingMessages(delivery.briefing),
    );
    await adversarial.markBriefingDelivered(ctx, {
      roleId: delivery.roleId,
      revision: delivery.revision,
      outcome,
    });
    return { outcome, revision: delivery.revision };
  };
}

/**
 * discord.adversarial.abort — DM the fixed STOP notice. Transient failures
 * retry (high attempt budget); on the last attempt the STOP is reported
 * undeliverable first, so core raises a critical alert and a human steps in.
 */
export function abortHandler(services: BotServices): JobHandler {
  return async (ctx, payload, job) => {
    const data = parsePayload(adversarial.adversarialAbortPayloadSchema, payload);
    const notice = await loadOrStop(() => adversarial.loadStopNotice(ctx, data));
    if (notice.alreadyDelivered) return { skipped: 'already delivered' };
    let outcome: DeliveryOutcome;
    try {
      outcome = await directMessages(services.gateway, notice.operativeDiscordId, [
        stopMessage(notice),
      ]);
    } catch (error) {
      if (job.attempts >= job.maxAttempts)
        await adversarial.markStopNoticeDelivered(ctx, {
          roleId: notice.roleId,
          outcome: 'undeliverable',
        });
      throw error;
    }
    await adversarial.markStopNoticeDelivered(ctx, { roleId: notice.roleId, outcome });
    return { outcome };
  };
}

/** discord.adversarial.debrief — post the revealed debrief in the team channel. */
export function debriefHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const data = parsePayload(adversarial.adversarialDebriefPayloadSchema, payload);
    const debrief = await loadOrStop(() => adversarial.loadDebrief(ctx, data));
    if (debrief.alreadyPosted) return { skipped: 'already posted' };
    const channelId = debrief.channelId;
    if (!channelId) {
      await adversarial.markDebriefPosted(ctx, {
        roleId: debrief.roleId,
        outcome: 'undeliverable',
      });
      return { outcome: 'undeliverable' };
    }
    let first: SentMessage | null = null;
    try {
      for (const message of debriefMessages(debrief.debrief)) {
        const sent = await services.gateway.sendMessage(channelId, message);
        first ??= sent;
      }
    } catch (error) {
      if (!isPermanentDiscordError(error)) throw error;
      await adversarial.markDebriefPosted(ctx, {
        roleId: debrief.roleId,
        outcome: 'undeliverable',
      });
      return { outcome: 'undeliverable' };
    }
    if (!first) throw new PermanentJobError('the debrief rendered no message');
    await adversarial.markDebriefPosted(ctx, {
      roleId: debrief.roleId,
      outcome: 'sent',
      channelId: first.channelId,
      messageId: first.messageId,
    });
    return { outcome: 'sent', messageId: first.messageId };
  };
}

/** One handler per discord.adversarial.* contract (packages/core/src/adversarial/discord-jobs.ts). */
export function adversarialJobHandlers(services: BotServices): JobHandlerMap {
  return {
    [adversarial.ADVERSARIAL_BRIEF_JOB]: briefHandler(services),
    [adversarial.ADVERSARIAL_ABORT_JOB]: abortHandler(services),
    [adversarial.ADVERSARIAL_DEBRIEF_JOB]: debriefHandler(services),
  };
}
