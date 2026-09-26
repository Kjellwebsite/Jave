import type { APIEmbedField } from 'discord.js';
import type { tickets } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  ACTION,
  ANNOUNCEMENT_TEXT_MAX,
  CARD_EXCERPT_MAX,
  CARD_SUBJECT_MAX,
  REASON_DISPLAY_MAX,
  SUBJECT_EXCERPT,
  TICKETS_NS,
} from './constants';
import {
  CATEGORY_LABELS,
  isActiveStatus,
  PRIORITY_LABELS,
  SLA_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from './labels';

export const SUPPORT_KICKER = 'JAVELIN SUPPORT';
const ARCHIVE_KICKER = 'TICKET ARCHIVE';
const MINUTES_PER_HOUR = 60;

type Person = { discordId: string } | null;

function mention(person: Person, fallback: string): string {
  return person ? `<@${person.discordId}>` : fallback;
}

/** Block-quote already-escaped text line by line. */
function quote(escaped: string): string {
  return escaped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function formatMinutes(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = Math.round(minutes % MINUTES_PER_HOUR);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// ─── Thread card ─────────────────────────────────────────────────────────────

/**
 * The status card in the ticket thread. Requester-safe only: the requester is
 * a member of the thread. CLAIM while active and unassigned; CLOSE while
 * active; no buttons once closed (an empty component list clears them on edit).
 */
export function ticketCard(card: tickets.TicketCard): MessagePayload {
  const active = isActiveStatus(card.status);
  const description = [`**${userText(card.subject, CARD_SUBJECT_MAX)}**`];
  if (card.openingMessage)
    description.push('', quote(userText(card.openingMessage, CARD_EXCERPT_MAX)));
  const fields: APIEmbedField[] = [
    field('Category', CATEGORY_LABELS[card.category].label, true),
    field('Priority', PRIORITY_LABELS[card.priority].label, true),
    field('Opened', discordTime(card.createdAt, 'R'), true),
    field('Requester', mention(card.opener, 'Unknown'), true),
    field('Handler', mention(card.assignee, 'Unassigned'), true),
  ];
  if (!active) {
    fields.push(field('Closed by', mention(card.closedBy, 'JAVE'), true));
  }
  const buttons = [];
  if (active && !card.assignee) {
    buttons.push(button('Claim', customId(TICKETS_NS, ACTION.claim, card.ticketId), 'primary'));
  }
  if (active) {
    buttons.push(button('Close', customId(TICKETS_NS, ACTION.close, card.ticketId)));
  }
  return {
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: `${card.reference} ${GLYPH.dot} ${STATUS_LABELS[card.status]}`,
        description: description.join('\n'),
        color: STATUS_COLORS[card.status],
        fields,
      }),
    ],
    components: buttons.length ? [row(...buttons)] : [],
  };
}

/** Posted in the thread when it closes. REOPEN stays usable in the locked thread. */
export function closingCard(card: tickets.TicketCard): MessagePayload {
  const reason = card.closeReason
    ? quote(userText(card.closeReason, REASON_DISPLAY_MAX))
    : undefined;
  return {
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: `${card.reference} ${GLYPH.dot} CLOSED`,
        description: reason,
        color: COLORS.steel,
        fields: [
          field('Closed by', mention(card.closedBy, 'JAVE'), true),
          field('Closed', card.closedAt ? discordTime(card.closedAt, 'f') : GLYPH.unknown, true),
        ],
        footer: 'This thread is locked. Reopen the ticket to continue here.',
      }),
    ],
    components:
      card.status === 'closed'
        ? [row(button('Reopen', customId(TICKETS_NS, ACTION.reopen, card.ticketId)))]
        : [],
  };
}

/** One line in the thread, exactly as the job contract words it. */
export function announcement(line: tickets.CardAnnouncement): MessagePayload {
  switch (line.kind) {
    case 'assigned':
      return {
        content: `**CLAIMED** — ${userText(line.assigneeName, 64)} is handling this ticket.`,
      };
    case 'waiting':
      return { content: `**WAITING ON YOU** — ${userText(line.note, ANNOUNCEMENT_TEXT_MAX)}` };
  }
}

export function reopenedLine(reason: string): MessagePayload {
  return { content: `**REOPENED** — ${userText(reason, ANNOUNCEMENT_TEXT_MAX)}` };
}

/** The card uploaded with a transcript to the archive channel. */
export function archiveCard(
  card: tickets.TicketCard,
  transcript: { filename: string; content: string; messageCount: number; format: string },
): MessagePayload {
  return {
    embeds: [
      panel({
        kicker: ARCHIVE_KICKER,
        title: `${card.reference} ${GLYPH.dot} TRANSCRIPT`,
        description: `**${userText(card.subject, CARD_SUBJECT_MAX)}**`,
        color: COLORS.steel,
        fields: [
          field('Category', CATEGORY_LABELS[card.category].label, true),
          field('Requester', mention(card.opener, 'Unknown'), true),
          field('Closed by', mention(card.closedBy, 'JAVE'), true),
          field('Messages', String(transcript.messageCount), true),
          field('Format', transcript.format.toUpperCase(), true),
          field('Closed', card.closedAt ? discordTime(card.closedAt, 'f') : GLYPH.unknown, true),
        ],
        footer: 'Requester-visible record. Internal notes are never included.',
      }),
    ],
    files: [
      {
        name: transcript.filename,
        data: Buffer.from(transcript.content, 'utf8'),
        description: `Transcript ${card.reference}`,
      },
    ],
  };
}

// ─── Ephemeral panels ────────────────────────────────────────────────────────

function slaLine(sla: tickets.TicketSla): string {
  switch (sla.state) {
    case 'breached':
      return `${SLA_LABELS.breached}${sla.dueAt ? ` ${GLYPH.dot} was due ${discordTime(sla.dueAt, 'R')}` : ''}`;
    case 'met':
      return `${SLA_LABELS.met}${sla.firstResponseMinutes === null ? '' : ` ${GLYPH.dot} first response in ${formatMinutes(sla.firstResponseMinutes)}`}`;
    case 'pending':
      if (!sla.dueAt) return SLA_LABELS.pending;
      return `${sla.overdue ? 'OVERDUE' : SLA_LABELS.pending} ${GLYPH.dot} due ${discordTime(sla.dueAt, 'R')}`;
    case 'none':
      return SLA_LABELS.none;
  }
}

function dashboardLink(publicUrl: string | undefined, ticketId: string): string | null {
  if (!publicUrl) return null;
  try {
    const url = new URL(`${publicUrl.replace(/\/+$/, '')}/tickets/${ticketId}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** /ticket view — the requester view never shows SLA, handler-only events or AI data. */
export function ticketInfoPanel(
  view: tickets.TicketView,
  publicUrl: string | undefined,
): ReplyPayload {
  const staff = view.viewer === 'handler';
  const fields: APIEmbedField[] = [
    field('Status', STATUS_LABELS[view.status], true),
    field('Category', CATEGORY_LABELS[view.category].label, true),
    field('Priority', PRIORITY_LABELS[view.priority].label, true),
    field('Requester', mention(view.opener, 'Unknown'), true),
    field('Handler', mention(view.assignee, 'Unassigned'), true),
    field('Opened', discordTime(view.createdAt, 'R'), true),
    field('Last activity', discordTime(view.lastActivityAt, 'R'), true),
    field('Thread', view.thread ? `<#${view.thread.threadId}>` : 'Being prepared', true),
  ];
  if (staff && view.sla) fields.push(field('First response', slaLine(view.sla), true));
  if (view.closeReason)
    fields.push(field('Close reason', userText(view.closeReason, REASON_DISPLAY_MAX)));
  const buttons = [];
  if (staff && isActiveStatus(view.status) && !view.assignee) {
    buttons.push(button('Claim', customId(TICKETS_NS, ACTION.claim, view.id), 'primary'));
  }
  const link = dashboardLink(publicUrl, view.id);
  if (link) buttons.push(linkButton('Open in dashboard', link));
  return {
    embeds: [
      panel({
        kicker: staff ? `${SUPPORT_KICKER} ${GLYPH.dot} STAFF VIEW` : SUPPORT_KICKER,
        title: view.reference,
        description: `**${userText(view.subject, CARD_SUBJECT_MAX)}**`,
        color: STATUS_COLORS[view.status],
        fields,
      }),
    ],
    components: buttons.length ? [row(...buttons)] : undefined,
    ephemeral: true,
  };
}

export function ticketLine(item: tickets.TicketSummary, staff: boolean): string {
  const parts = [
    `**${item.reference}**`,
    PRIORITY_LABELS[item.priority].label,
    STATUS_LABELS[item.status],
    userText(item.subject, SUBJECT_EXCERPT),
  ];
  if (staff && item.sla?.state === 'pending' && item.sla.dueAt) {
    parts.push(`${item.sla.overdue ? 'overdue' : 'due'} ${discordTime(item.sla.dueAt, 'R')}`);
  }
  if (staff && item.sla?.state === 'breached') parts.push(SLA_LABELS.breached);
  if (!staff) parts.push(`active ${discordTime(item.lastActivityAt, 'R')}`);
  return parts.join(` ${GLYPH.dot} `);
}

/** "#0042 · subject" within Discord's 100-character label limit. */
export function ticketChoiceName(
  item: { reference: string; subject: string },
  max: number,
): string {
  return clip(`${item.reference} ${GLYPH.dot} ${item.subject}`, max);
}
