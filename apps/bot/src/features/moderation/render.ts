import type { APIEmbedField, APISelectMenuOption } from 'discord.js';
import { can, type Capability, moderation, type ServiceContext } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, panel, row, stringSelect, success } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { describeDuration } from './durations';
import { MOD_ACTIONS, modId } from './ids';
import type { CaseActionKey } from './pending';

type ModCaseView = moderation.ModCaseView;
type CaseHistory = moderation.CaseHistory;

export const MOD_KICKER = 'JAVE MODERATION';
const HISTORY_LINES = 10;
const REASON_LINE_MAX = 80;
const REASON_FIELD_MAX = 1000;
const NAME_MAX = 80;
const SELECT_DESCRIPTION_MAX = 100;

export const ACTION_LABEL: Record<CaseActionKey, string> = {
  warn: 'WARNING',
  timeout: 'TIMEOUT',
  untimeout: 'TIMEOUT LIFTED',
  kick: 'KICK',
  ban: 'BAN',
  unban: 'UNBAN',
  quarantine: 'QUARANTINE',
  release: 'RELEASE',
  note: 'NOTE',
};

/** Past-tense result headline shown to the acting moderator. */
export const ACTION_DONE: Record<CaseActionKey, string> = {
  warn: 'WARNING ISSUED',
  timeout: 'TIMED OUT',
  untimeout: 'TIMEOUT LIFTED',
  kick: 'KICKED',
  ban: 'BANNED',
  unban: 'BAN LIFTED',
  quarantine: 'QUARANTINED',
  release: 'RELEASED',
  note: 'NOTE ADDED',
};

/** Capability each action needs — used only to hide options the viewer cannot use. */
export const ACTION_CAPABILITY: Record<CaseActionKey, Capability> = moderation.CASE_CAPABILITY;

const SOURCE_LABEL: Record<ModCaseView['source'], string> = {
  manual: 'MANUAL',
  automod: 'AUTOMOD',
  ai_suggested: 'AI SUGGESTED · CONFIRMED',
  security_event: 'SECURITY EVENT',
  system: 'SYSTEM',
};

const SYNC_LABEL: Record<ModCaseView['discordState'], string> = {
  pending: 'PENDING',
  applied: `APPLIED ${GLYPH.verified}`,
  failed: `FAILED ${GLYPH.cross}`,
  not_required: 'NOT REQUIRED',
  not_applied: 'NOT APPLIED · ended first',
};

const END_LABEL: Record<NonNullable<ModCaseView['endedReason']>, string> = {
  expired: 'EXPIRED',
  lifted: 'LIFTED',
  superseded: 'SUPERSEDED',
  revoked: 'REVOKED',
};

function mention(discordId: string): string {
  return discordId ? `<@${discordId}>` : GLYPH.unknown;
}

function personLine(person: { name: string; discordId: string } | null, fallback: string): string {
  if (!person) return fallback;
  return `${userText(person.name, NAME_MAX)} ${GLYPH.dot} ${mention(person.discordId)}`;
}

export function caseStatus(view: ModCaseView): string {
  if (view.revokedAt) return `REVOKED ${discordTime(view.revokedAt, 'R')}`;
  if (view.inForce) {
    return view.expiresAt
      ? `IN FORCE ${GLYPH.dot} ends ${discordTime(view.expiresAt, 'R')}`
      : 'IN FORCE';
  }
  if (view.endedAt && view.endedReason) {
    return `ENDED ${GLYPH.dot} ${END_LABEL[view.endedReason]} ${discordTime(view.endedAt, 'R')}`;
  }
  return 'RECORDED';
}

function caseColor(view: ModCaseView): number {
  if (view.revokedAt) return COLORS.steel;
  if (view.inForce) return COLORS.warning;
  if (view.discordState === 'failed') return COLORS.danger;
  return COLORS.base;
}

function moderatorLine(view: ModCaseView): string {
  if (view.moderator) return personLine(view.moderator, GLYPH.unknown);
  return view.source === 'automod' ? 'AUTOMOD' : 'SYSTEM';
}

/** Full case card (ephemeral, staff only). */
export function caseEmbed(view: ModCaseView) {
  const fields: APIEmbedField[] = [
    field('Member', personLine(view.target, GLYPH.unknown), true),
    field('Moderator', moderatorLine(view), true),
    field('Source', SOURCE_LABEL[view.source], true),
    field('Status', caseStatus(view), true),
  ];
  if (view.durationSeconds) {
    fields.push(field('Duration', describeDuration(view.durationSeconds).toUpperCase(), true));
  }
  if (view.deleteMessageDays) {
    fields.push(field('Messages deleted', `${view.deleteMessageDays}d`, true));
  }
  const sync =
    view.discordState === 'failed' && view.discordError
      ? `${SYNC_LABEL.failed}\n${userText(view.discordError, 300)}`
      : SYNC_LABEL[view.discordState];
  fields.push(field('Discord', sync, true));
  if (view.revokedAt) {
    fields.push(
      field(
        'Revoked',
        `${personLine(view.revokedBy, 'SYSTEM')}\n${userText(view.revokeReason, REASON_FIELD_MAX)}`,
      ),
    );
  }
  return panel({
    kicker: MOD_KICKER,
    title: `${view.reference} — ${ACTION_LABEL[view.action]}`,
    description: userText(view.reason, REASON_FIELD_MAX),
    color: caseColor(view),
    fields,
    footer: `Recorded ${view.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  });
}

const REVOCABLE: ReadonlySet<CaseActionKey> = new Set([
  'warn',
  'timeout',
  'kick',
  'ban',
  'quarantine',
  'note',
]);

/** Case card with REVOKE (when the viewer could) and MEMBER HISTORY. */
export function caseReply(view: ModCaseView, ctx: ServiceContext): ReplyPayload {
  const buttons = [
    button('Member history', modId(MOD_ACTIONS.memberHistory, view.target.discordId)),
  ];
  if (!view.revokedAt && REVOCABLE.has(view.action) && can(ctx, ACTION_CAPABILITY[view.action])) {
    buttons.unshift(button('Revoke', modId(MOD_ACTIONS.revokeCase, view.id), 'danger'));
  }
  return { embeds: [caseEmbed(view)], components: [row(...buttons)], ephemeral: true };
}

function caseLine(view: ModCaseView): string {
  const flags = view.revokedAt ? ' · REVOKED' : view.inForce ? ' · IN FORCE' : '';
  const reason = userText(view.reason, REASON_LINE_MAX).replace(/\n+/g, ' ');
  return `\`${view.reference}\` **${ACTION_LABEL[view.action]}**${flags} ${GLYPH.dot} ${discordTime(view.createdAt, 'd')}\n${GLYPH.bar} ${reason}`;
}

function summaryLine(history: CaseHistory): string {
  const { summary } = history;
  const parts = [`WARNINGS ${summary.warnings}`];
  if (history.isBot) parts.unshift('BOT ACCOUNT');
  if (summary.timeoutUntil) parts.push(`TIMED OUT until ${discordTime(summary.timeoutUntil, 'f')}`);
  if (summary.quarantined) parts.push('QUARANTINED');
  if (summary.banned) parts.push('BANNED');
  parts.push(`${summary.totalCases} CASE${summary.totalCases === 1 ? '' : 'S'}`);
  return parts.join(` ${GLYPH.dot} `);
}

/** Actions offered in the "Take action" select, given state and the viewer's capabilities. */
export function availableActions(history: CaseHistory, ctx: ServiceContext): CaseActionKey[] {
  // Bot and webhook accounts: only what core allows on them (notes, reversals).
  const allowed = (action: CaseActionKey) =>
    can(ctx, ACTION_CAPABILITY[action]) &&
    moderation.botTargetViolation({ isBot: history.isBot }, action) === null;
  const { summary } = history;
  const candidates: CaseActionKey[] = summary.banned
    ? ['unban', 'note']
    : [
        'warn',
        summary.timeoutUntil ? 'untimeout' : 'timeout',
        summary.quarantined ? 'release' : 'quarantine',
        'kick',
        'ban',
        'note',
      ];
  return candidates.filter(allowed);
}

const ACTION_HINT: Record<CaseActionKey, string> = {
  warn: 'Formal warning. The member is notified.',
  timeout: 'Cannot post for a set time (max 28 days).',
  untimeout: 'Lift the running timeout.',
  kick: 'Remove from the server. Can rejoin.',
  ban: 'Remove and block rejoining.',
  unban: 'Lift the ban.',
  quarantine: 'Restrict access pending review.',
  release: 'Restore full access.',
  note: 'Private staff note. Never shown to the member.',
};

export function historyReply(history: CaseHistory, ctx: ServiceContext): ReplyPayload {
  const shown = history.cases.slice(0, HISTORY_LINES);
  const lines = shown.map(caseLine);
  const description = [
    `${mention(history.target.discordId)} ${GLYPH.dot} ${summaryLine(history)}`,
    '',
    lines.length ? lines.join('\n') : 'No moderation cases on record.',
  ].join('\n');
  const embed = panel({
    kicker: `${MOD_KICKER} ${GLYPH.dot} HISTORY`,
    title: history.target.name,
    description,
    color: history.summary.banned || history.summary.quarantined ? COLORS.warning : COLORS.base,
    footer:
      history.summary.totalCases > shown.length
        ? `Showing ${shown.length} of ${history.summary.totalCases}. Full record in the dashboard.`
        : undefined,
  });
  const components: NonNullable<ReplyPayload['components']> = [];
  if (history.cases.length > 0) {
    const options: APISelectMenuOption[] = history.cases
      .slice(0, LIMITS.selectOptions)
      .map((c) => ({
        label: clip(`${c.reference} · ${ACTION_LABEL[c.action]}`, LIMITS.buttonLabel),
        description: clip(c.reason.replace(/\s+/g, ' '), SELECT_DESCRIPTION_MAX),
        value: c.id,
      }));
    components.push(
      row(
        stringSelect(
          modId(MOD_ACTIONS.openCase, history.target.discordId),
          'Open a case…',
          options,
        ),
      ),
    );
  }
  const actions = availableActions(history, ctx);
  if (actions.length > 0) {
    components.push(
      row(
        stringSelect(
          modId(MOD_ACTIONS.takeAction, history.target.discordId),
          'Take action…',
          actions.map((action) => ({
            label: ACTION_LABEL[action],
            description: ACTION_HINT[action],
            value: action,
          })),
        ),
      ),
    );
  }
  return { embeds: [embed], components, ephemeral: true };
}

/** Moderator-facing result after a case was recorded. */
export function caseResultReply(view: ModCaseView, action: CaseActionKey): ReplyPayload {
  const lines = [
    `${personLine(view.target, GLYPH.unknown)}`,
    `Reason ${GLYPH.dot} ${userText(view.reason, REASON_FIELD_MAX)}`,
  ];
  if (view.durationSeconds) {
    lines.push(`Duration ${GLYPH.dot} ${describeDuration(view.durationSeconds).toUpperCase()}`);
  }
  if (view.discordState === 'pending') lines.push('Discord applies it within seconds.');
  if (view.discordState === 'not_required' && action !== 'note') {
    lines.push('Not in the server: recorded in JAVE only.');
  }
  return {
    embeds: [success(`${ACTION_DONE[action]} — ${view.reference}`, lines.join('\n'))],
    components: [
      row(button('Member history', modId(MOD_ACTIONS.memberHistory, view.target.discordId))),
    ],
    ephemeral: true,
  };
}

/** CONFIRM step for kick and ban. */
export function confirmationReply(options: {
  action: 'kick' | 'ban';
  targetName: string;
  targetDiscordId: string;
  reason: string;
  deleteMessageDays?: number;
  token: string;
}): ReplyPayload {
  const name = userText(options.targetName, NAME_MAX);
  const consequence =
    options.action === 'kick'
      ? `Removes ${name} from the server. They can rejoin with a new invite.`
      : `Bans ${name}. They cannot rejoin until the ban is lifted.`;
  const fields = [
    field('Member', `${name} ${GLYPH.dot} ${mention(options.targetDiscordId)}`, true),
    field('Reason', userText(options.reason, REASON_FIELD_MAX)),
  ];
  if (options.action === 'ban') {
    fields.splice(
      1,
      0,
      field(
        'Messages',
        options.deleteMessageDays ? `Delete the last ${options.deleteMessageDays}d` : 'Kept',
        true,
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: MOD_KICKER,
        title: `Confirm ${options.action}`,
        description: `${consequence}\nThe member is notified by DM first. Recorded as a case.`,
        color: COLORS.danger,
        fields,
        footer: 'Expires in 10 minutes.',
      }),
    ],
    components: [
      row(
        button(`Confirm ${options.action}`, modId(MOD_ACTIONS.confirm, options.token), 'danger'),
        button('Cancel', modId(MOD_ACTIONS.cancel, options.token)),
      ),
    ],
    ephemeral: true,
  };
}
