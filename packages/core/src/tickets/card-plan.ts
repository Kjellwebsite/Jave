import { ACTIVE_STATUSES } from './constants';
import type { TicketDiscordJobPayload, UPDATE_CARD_JOB } from './discord-jobs';
import type { TicketCard } from './thread.service';

/**
 * A line the bot posts in the ticket thread. The bot owns the wording; the
 * user text here (a display name, the handler's waiting reason) must be
 * rendered through `userText()` with `allowedMentions: { parse: [] }`.
 */
export type CardAnnouncement =
  { kind: 'assigned'; assigneeName: string } | { kind: 'waiting'; note: string };

/**
 * Everything a discord.tickets.update_card job is still allowed to do. A type
 * alias (not an interface) so a handler can return it as its job result.
 */
export type CardUpdatePlan = {
  /** Edit the status card message to the card's current state. */
  editCard: boolean;
  /** Add this Discord user (the current assignee) to the private thread. */
  addMemberDiscordId: string | null;
  /** One line to post in the thread, or null. */
  announce: CardAnnouncement | null;
};

export type CardPlanInput = Pick<TicketCard, 'status' | 'threadId' | 'cardMessageId' | 'assignee'>;

const NOTHING: CardUpdatePlan = { editCard: false, addMemberDiscordId: null, announce: null };
const EDIT_ONLY: CardUpdatePlan = { editCard: true, addMemberDiscordId: null, announce: null };

/**
 * Decide what an update_card job may do given the ticket as it is *now*.
 * Jobs run late, out of order and after retries, and posting into an archived
 * thread unarchives it, so:
 * - no thread or card yet → nothing (the open job renders current state);
 * - closed or archived → nothing: close_thread owns the final card and the
 *   lock, reopen_thread re-renders the card if the ticket comes back;
 * - claimed / transferred → announce (and add to the thread) only while the
 *   assignee the job was enqueued for still holds the ticket;
 * - waiting → announce the reason only while the ticket is still waiting;
 * - refresh → card edit, and make sure the current assignee is in the thread;
 * - unclaimed / priority_changed / resumed → card edit only.
 */
export function planCardUpdate(
  card: CardPlanInput,
  job: TicketDiscordJobPayload<typeof UPDATE_CARD_JOB>,
): CardUpdatePlan {
  if (!card.threadId || !card.cardMessageId) return NOTHING;
  if (!ACTIVE_STATUSES.includes(card.status)) return NOTHING;
  const assignee = card.assignee;
  switch (job.change) {
    case 'claimed':
    case 'transferred':
      if (!assignee || assignee.userId !== job.assigneeUserId) return EDIT_ONLY;
      return {
        editCard: true,
        addMemberDiscordId: assignee.discordId,
        announce: { kind: 'assigned', assigneeName: assignee.displayName },
      };
    case 'waiting':
      if (card.status !== 'waiting' || !job.note) return EDIT_ONLY;
      return { ...EDIT_ONLY, announce: { kind: 'waiting', note: job.note } };
    case 'refresh':
      return { ...EDIT_ONLY, addMemberDiscordId: assignee?.discordId ?? null };
    case 'unclaimed':
    case 'priority_changed':
    case 'resumed':
      return EDIT_ONLY;
  }
}
