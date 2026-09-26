import {
  authorize,
  DisabledError,
  getSettings,
  InvalidStateError,
  recordAudit,
  requireMember,
  tickets,
  ValidationError,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { failure, panel, row, stringSelect, success } from '../../ui/components';
import { BRAND, COLORS, GLYPH } from '../../ui/theme';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import { categoryOptions, isCategory, isPriority, PRIORITY_LABELS } from './labels';
import { openTicketModal } from './modals';
import { SUPPORT_KICKER } from './render';

const DISABLED_FEATURE = 'Tickets';

function categoryRow() {
  return row(
    stringSelect(customId(TICKETS_NS, ACTION.category), 'Choose a category', categoryOptions()),
  );
}

/**
 * Tickets need the feature switched on and a ticket channel to hold the
 * private threads. Checked before the form opens so nobody writes a message
 * that cannot be filed; core enforces both again on submit.
 */
async function assertTicketsReady(h: HandlerContext): Promise<string> {
  const [settings, channels] = await Promise.all([
    getSettings(h.ctx, 'tickets'),
    getSettings(h.ctx, 'channels'),
  ]);
  if (!settings.enabled) throw new DisabledError(DISABLED_FEATURE);
  if (!channels.tickets) {
    throw new InvalidStateError('Tickets are not set up yet: no ticket channel is configured.');
  }
  return channels.tickets;
}

/** /ticket open — step 1: choose a category (then the form opens). */
export async function startOpen(h: HandlerContext): Promise<void> {
  requireMember(h.ctx);
  await assertTicketsReady(h);
  await h.respond({
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: 'Open a ticket',
        description:
          'Choose the category that fits. A private thread opens with you and JAVELIN staff; nobody else can read it.',
      }),
    ],
    components: [categoryRow()],
    ephemeral: true,
  });
}

/** Category chosen (ephemeral prompt or public panel) → the form. */
export async function showOpenForm(h: HandlerContext): Promise<void> {
  const category = h.interaction.values[0];
  if (!isCategory(category)) throw new ValidationError('Choose a category from the list.');
  requireMember(h.ctx);
  await assertTicketsReady(h);
  await h.interaction.showModal(openTicketModal(category));
}

/** Form submitted → core opens the ticket; the thread job runs right after this reply. */
export async function submitOpen(h: HandlerContext, args: readonly string[]): Promise<void> {
  const category = args[0];
  if (!isCategory(category)) throw new ValidationError('Choose a category from the list.');
  const chosen = h.interaction.modal.select(FIELD.priority)[0];
  const priority = isPriority(chosen) ? chosen : 'normal';
  const ticket = await tickets.openTicket(h.ctx, {
    category,
    priority,
    subject: h.interaction.modal.text(FIELD.subject),
    body: h.interaction.modal.text(FIELD.body),
  });
  const channels = await getSettings(h.ctx, 'channels');
  const where = channels.tickets ? ` under <#${channels.tickets}>` : '';
  await h.respond({
    embeds: [
      success(
        `Ticket ${ticket.reference} opened`,
        [
          `Your private thread is being prepared${where}. Staff reply there, and you are notified when it is claimed.`,
          `PRIORITY ${GLYPH.dot} ${PRIORITY_LABELS[ticket.priority].label}`,
        ].join('\n'),
      ),
    ],
    ephemeral: true,
  });
}

/**
 * /ticket panel — posts the public OPEN A TICKET panel in the current channel.
 * Ticket managers only (it speaks for JAVELIN in a public channel); audited.
 * Discord refusals (JAVE cannot post here) are reported, not thrown.
 */
export async function postPanel(h: HandlerContext): Promise<void> {
  await authorize(h.ctx, 'canManageTickets', { type: 'ticket_panel' });
  await assertTicketsReady(h);
  const channelId = h.interaction.channelId;
  if (!channelId) throw new ValidationError('Use this in a text channel.');
  const message = {
    embeds: [
      panel({
        kicker: BRAND.organization,
        title: 'Open a ticket',
        description: [
          'Questions, problems, reports, partnerships — anything that needs JAVELIN staff.',
          '',
          `${GLYPH.bullet} Choose a category below and describe the situation.`,
          `${GLYPH.bullet} A private thread opens with you and staff. Nobody else can read it.`,
          `${GLYPH.bullet} Every ticket is recorded. You can request its transcript at any time.`,
        ].join('\n'),
        color: COLORS.chrome,
      }),
    ],
    components: [categoryRow()],
  };
  try {
    const sent = await h.services.gateway.sendMessage(channelId, message);
    await recordAudit(h.ctx, {
      action: 'ticket.panel_posted',
      targetType: 'channel',
      targetId: channelId,
      context: { messageId: sent.messageId },
    });
  } catch (error) {
    if (!(error instanceof DiscordActionError)) throw error;
    h.ctx.logger.warn({ err: error, channelId }, 'ticket panel could not be posted');
    await h.respond({
      embeds: [
        failure(
          'Panel not posted',
          'JAVE cannot post in this channel. It needs View Channel, Send Messages and Embed Links here.',
        ),
      ],
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [success('Panel posted', `Members can now open tickets from <#${channelId}>.`)],
    ephemeral: true,
  });
}
