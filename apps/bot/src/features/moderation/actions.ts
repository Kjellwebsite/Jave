import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { findUserByDiscordId, moderation, type ServiceContext, ValidationError } from '@jave/core';
import type { HandlerContext, ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { systemContext, pending } from './context';
import {
  BAN_DELETE_PRESETS,
  describeDuration,
  type DurationPreset,
  durationKey,
  INDEFINITE,
  QUARANTINE_BOUNDS,
  QUARANTINE_PRESETS,
  resolveDuration,
  TIMEOUT_BOUNDS,
  TIMEOUT_PRESETS,
} from './durations';
import { MOD_ACTIONS, modId } from './ids';
import type { CaseActionKey } from './pending';
import { mayStart } from './replies';
import { ACTION_LABEL, caseResultReply, confirmationReply } from './render';

/** Modal field ids. */
export const FIELD = {
  reason: 'reason',
  duration: 'duration',
  deleteMessages: 'deleteMessages',
} as const;

export interface CaseTarget {
  discordId: string;
  name: string;
}

export interface CaseRequest {
  action: CaseActionKey;
  target: CaseTarget;
  reason: string;
  /** timeout: required. quarantine: null = indefinite. */
  durationSeconds?: number | null;
  deleteMessageDays?: number;
  securityEventId?: string;
}

/** Every case action, in menu order. */
export const CASE_ACTIONS: readonly CaseActionKey[] = [
  'warn',
  'timeout',
  'untimeout',
  'kick',
  'ban',
  'unban',
  'quarantine',
  'release',
  'note',
];

/** Actions that ask for a duration in the modal. */
const DURATION_ACTIONS: ReadonlySet<CaseActionKey> = new Set(['timeout', 'quarantine']);
/** Actions that need an explicit CONFIRM click. */
export const CONFIRMED_ACTIONS: ReadonlySet<CaseActionKey> = new Set(['kick', 'ban']);

const ACTION_HINTS: Record<CaseActionKey, string> = {
  warn: 'The member receives the warning and your reason by DM.',
  timeout: 'The member can read but not post until the timeout ends.',
  untimeout: 'The member can post again immediately.',
  kick: 'You confirm on the next step. The member is told why by DM first.',
  ban: 'You confirm on the next step. The member is told why by DM first.',
  unban: 'The user may rejoin the server.',
  quarantine: 'Access is restricted to the review channel until released.',
  release: 'Full access is restored and roles are re-applied.',
  note: 'Private to staff. Never shown to the member.',
};

/** Call the core case service for one action, as the acting user. */
export async function executeCaseAction(
  ctx: ServiceContext,
  request: CaseRequest,
): Promise<moderation.ModCaseView> {
  const base = {
    targetDiscordId: request.target.discordId,
    reason: request.reason,
    ...(request.securityEventId && { securityEventId: request.securityEventId }),
  };
  switch (request.action) {
    case 'warn':
      return moderation.warnMember(ctx, base);
    case 'timeout':
      if (!request.durationSeconds) throw new ValidationError('Choose how long the timeout lasts.');
      return moderation.timeoutMember(ctx, { ...base, durationSeconds: request.durationSeconds });
    case 'untimeout':
      return moderation.untimeoutMember(ctx, base);
    case 'kick':
      return moderation.kickMember(ctx, base);
    case 'ban':
      return moderation.banMember(ctx, {
        ...base,
        deleteMessageDays: request.deleteMessageDays ?? 0,
      });
    case 'unban':
      return moderation.unbanMember(ctx, base);
    case 'quarantine':
      return moderation.quarantineMember(ctx, {
        ...base,
        ...(request.durationSeconds ? { durationSeconds: request.durationSeconds } : {}),
      });
    case 'release':
      return moderation.releaseMember(ctx, base);
    case 'note':
      return moderation.addModNote(ctx, base);
  }
}

function presetOptions(presets: readonly DurationPreset[], selectedSeconds: number | null) {
  const options = presets.map((p) => ({
    label: p.label,
    value: p.key,
    default: p.seconds === selectedSeconds,
  }));
  if (selectedSeconds !== null && !presets.some((p) => p.seconds === selectedSeconds)) {
    options.unshift({
      label: describeDuration(selectedSeconds),
      value: durationKey(selectedSeconds),
      default: true,
    });
  }
  return options;
}

export interface ModalPrefill {
  reason?: string | null;
  durationSeconds?: number | null;
  deleteMessageDays?: number;
}

/** Reason (+ duration / message history) modal for one action. */
export function actionModal(
  customIdValue: string,
  action: CaseActionKey,
  targetName: string,
  prefill: ModalPrefill = {},
): ModalPayload {
  const reasonInput = new TextInputBuilder()
    .setCustomId(FIELD.reason)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(moderation.MIN_REASON_LENGTH)
    .setMaxLength(moderation.MAX_REASON_LENGTH)
    .setRequired(true);
  if (prefill.reason) reasonInput.setValue(clip(prefill.reason, moderation.MAX_REASON_LENGTH));
  const reasonLabel = new LabelBuilder()
    .setLabel(action === 'note' ? 'Note' : 'Reason')
    .setDescription(
      action === 'note' ? 'Staff only.' : 'Recorded on the case and shown to the member.',
    )
    .setTextInputComponent(reasonInput);

  const modal = new ModalBuilder()
    .setCustomId(customIdValue)
    .setTitle(clip(`${ACTION_LABEL[action]} — ${targetName}`, LIMITS.modalTitle))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(ACTION_HINTS[action]))
    .addLabelComponents(reasonLabel);

  if (DURATION_ACTIONS.has(action)) {
    const timeout = action === 'timeout';
    const selected = timeout
      ? (prefill.durationSeconds ?? TIMEOUT_PRESETS[1]!.seconds)
      : (prefill.durationSeconds ?? null);
    modal.addLabelComponents(
      new LabelBuilder().setLabel('Duration').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(FIELD.duration)
          .setRequired(true)
          .addOptions(presetOptions(timeout ? TIMEOUT_PRESETS : QUARANTINE_PRESETS, selected)),
      ),
    );
  }
  if (action === 'ban') {
    const days = prefill.deleteMessageDays ?? 0;
    modal.addLabelComponents(
      new LabelBuilder().setLabel('Message history').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(FIELD.deleteMessages)
          .setRequired(true)
          .addOptions(
            BAN_DELETE_PRESETS.map((p) => ({
              label: p.label,
              value: p.key,
              default: p.days === days,
            })),
          ),
      ),
    );
  }
  return modal.toJSON();
}

/** Parse the duration a user picked or typed for an action (null = none / indefinite). */
export function durationFor(
  action: CaseActionKey,
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  if (action === 'quarantine') {
    if (value === INDEFINITE) return null;
    const seconds = resolveDuration(value, QUARANTINE_BOUNDS);
    if (seconds === null) {
      throw new ValidationError('Quarantine lasts from 1 minute to 90 days, or until released.');
    }
    return seconds;
  }
  if (action === 'timeout') {
    const seconds = resolveDuration(value, TIMEOUT_BOUNDS);
    if (seconds === null) {
      throw new ValidationError('Timeouts last from 1 minute to 28 days, e.g. 10m, 2h, 7d.');
    }
    return seconds;
  }
  return null;
}

export function deleteDaysFor(value: string | null | undefined): number {
  const preset = BAN_DELETE_PRESETS.find((p) => p.key === value);
  if (value && !preset) throw new ValidationError('Choose how much message history to delete.');
  return preset?.days ?? 0;
}

/** The name JAVE knows for a Discord user (for confirmations and titles). */
export async function knownName(h: HandlerContext, discordId: string): Promise<string> {
  const user = await findUserByDiscordId(systemContext(h.services, 'moderation:lookup'), discordId);
  return user?.displayName ?? user?.username ?? discordId;
}

/**
 * Last step of every case flow: kick and ban wait for CONFIRM; everything
 * else is recorded immediately as the acting user.
 */
export async function proceed(h: HandlerContext, request: CaseRequest): Promise<void> {
  if (request.action === 'kick' || request.action === 'ban') {
    const token = pending(h).put({
      kind: 'case',
      issuerDiscordId: h.interaction.user.id,
      action: request.action,
      targetDiscordId: request.target.discordId,
      targetName: request.target.name,
      reason: request.reason,
      ...(request.deleteMessageDays !== undefined && {
        deleteMessageDays: request.deleteMessageDays,
      }),
    });
    await h.respond(
      confirmationReply({
        action: request.action,
        targetName: request.target.name,
        targetDiscordId: request.target.discordId,
        reason: request.reason,
        deleteMessageDays: request.deleteMessageDays,
        token,
      }),
    );
    return;
  }
  const view = await executeCaseAction(h.ctx, request);
  await h.respond(caseResultReply(view, request.action));
}

/**
 * Start a case flow. With a reason (and a duration where one is needed) it
 * proceeds straight away; otherwise it opens the reason modal.
 */
export async function beginAction(
  h: HandlerContext,
  action: CaseActionKey,
  target: CaseTarget,
  prefill: ModalPrefill,
): Promise<void> {
  if (!(await mayStart(h, action))) return;
  const reason = prefill.reason?.trim();
  const needsDuration = action === 'timeout' && !prefill.durationSeconds;
  if (!reason || needsDuration) {
    await h.interaction.showModal(
      actionModal(
        modId(MOD_ACTIONS.actionSubmit, action, target.discordId),
        action,
        target.name,
        prefill,
      ),
    );
    return;
  }
  if (!h.interaction.deferred && !h.interaction.replied) {
    await h.interaction.defer({ ephemeral: true });
  }
  await proceed(h, {
    action,
    target,
    reason,
    durationSeconds: prefill.durationSeconds ?? null,
    deleteMessageDays: prefill.deleteMessageDays,
  });
}
