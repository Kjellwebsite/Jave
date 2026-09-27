import type { APIEmbedField } from 'discord.js';
import type { moderation } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { button, field, panel, row } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { MOD_ACTIONS, modId } from './ids';

type SecurityAlertCard = moderation.SecurityAlertCard;

const SEVERITY_COLOR: Record<SecurityAlertCard['severity'], number> = {
  critical: COLORS.danger,
  elevated: COLORS.warning,
  low: COLORS.steel,
  // Not assessed is not low: a distinct, neutral tone that still reads as "needs a human".
  unscored: COLORS.info,
};

const SEVERITY_LABEL: Record<SecurityAlertCard['severity'], string> = {
  critical: 'CRITICAL',
  elevated: 'ELEVATED',
  low: 'LOW',
  unscored: 'NOT SCORED',
};

const RISK_SEGMENTS = 10;
const MAX_RISK = 100;
const RISK_VALUE = /^(\d{1,3})\/100$/;
const FIELD_TEXT_MAX = 1000;

/** "▰▰▰▰▱▱▱▱▱▱ 45/100" — a quiet, fixed-width risk readout. */
export function riskBar(score: number): string {
  const clamped = Math.max(0, Math.min(MAX_RISK, Math.round(score)));
  const filled = Math.round((clamped / MAX_RISK) * RISK_SEGMENTS);
  return `${'▰'.repeat(filled)}${'▱'.repeat(RISK_SEGMENTS - filled)} ${clamped}/${MAX_RISK}`;
}

function renderField(card: SecurityAlertCard, label: string, value: string): APIEmbedField {
  switch (label) {
    case 'USER': {
      const who = userText(value, FIELD_TEXT_MAX);
      return field(
        label,
        card.subjectDiscordId ? `<@${card.subjectDiscordId}>\n${who}` : who,
        true,
      );
    }
    case 'RISK SCORE': {
      const score = RISK_VALUE.exec(value)?.[1];
      return field(label, score ? `\`${riskBar(Number(score))}\`` : userText(value), true);
    }
    case 'TRIGGER':
      return field(label, userText(value), true);
    case 'TIMESTAMP':
      return field(label, discordTime(card.timestamp, 'f'), true);
    case 'EVIDENCE':
      return field(label, userText(value, FIELD_TEXT_MAX));
    default:
      return field(label, userText(value, FIELD_TEXT_MAX), true);
  }
}

/**
 * The staff-only security alert card. Buttons appear only while the event is
 * actionable; custom ids carry the event id and route to handlers that
 * re-authorize the clicking user.
 */
export function alertCardPayload(card: SecurityAlertCard): MessagePayload {
  const embed = panel({
    kicker: `JAVE SECURITY ${GLYPH.dot} ${SEVERITY_LABEL[card.severity]}`,
    title: card.title,
    color: card.actionable ? SEVERITY_COLOR[card.severity] : COLORS.steel,
    fields: card.fields.map((f) => renderField(card, f.label, f.value)),
    footer: card.actionable
      ? `${card.reference} ${GLYPH.dot} awaiting review`
      : `${card.reference} ${GLYPH.dot} ${card.status.toUpperCase()}`,
    timestamp: card.timestamp,
  });
  if (!card.actionable) return { embeds: [embed], components: [] };
  const buttons = [];
  if (card.status === 'open') {
    buttons.push(
      button('Acknowledge', modId(MOD_ACTIONS.securityAcknowledge, card.securityEventId)),
    );
  }
  buttons.push(button('Dismiss', modId(MOD_ACTIONS.securityDismiss, card.securityEventId)));
  if (card.quarantineOffered) {
    buttons.push(
      button('Quarantine', modId(MOD_ACTIONS.securityQuarantine, card.securityEventId), 'danger'),
    );
  }
  return { embeds: [embed], components: [row(...buttons)] };
}
