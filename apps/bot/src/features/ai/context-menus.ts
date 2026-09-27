import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ai, requireUser } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { AI_NS, withAiLimits } from './answers';
import { MAX_QUESTION } from './commands';
import { authorName, summarizable, targetText } from './messages';
import { proposalPreview, expiredControl } from './proposals';
import { runAsk, runExplain, runSummarizeMessages } from './run';
import { ExpiringStore } from './store';
import { aiDepsOf } from './deps';

/**
 * Message context menus (right-click a message → Apps). The member can only
 * right-click messages they can see, so the message itself is never an IDOR
 * vector; its text is sent to the AI as untrusted data.
 */

/** A right-clicked message waiting for the member's question in the modal. */
interface PendingQuestion {
  ownerId: string;
  author: string;
  text: string;
}

/** Discord modals must be submitted within 15 minutes. */
const PENDING_TTL_MS = 15 * 60_000;
const MAX_PENDING_QUESTIONS = 500;
/** Open Ask JAVE modals per member; opening another drops their oldest. */
const MAX_PENDING_QUESTIONS_PER_MEMBER = 5;
const DEFAULT_MESSAGE_QUESTION =
  'Respond to this message: answer its question, or explain what it says.';
/**
 * Create Task's trusted brief. The right-clicked message is usually someone
 * else's words, so it travels as untrusted source material, never as the brief.
 */
const CREATE_TASK_BRIEF = 'Draft a mission from the referenced Discord message.';

const pending = new ExpiringStore<PendingQuestion>({
  ttlMs: PENDING_TTL_MS,
  maxEntries: MAX_PENDING_QUESTIONS,
  maxPerOwner: MAX_PENDING_QUESTIONS_PER_MEMBER,
});

const HELP_CATEGORY = 'intelligence';

function messageCommand(name: string) {
  return new ContextMenuCommandBuilder()
    .setName(name)
    .setType(ApplicationCommandType.Message)
    .toJSON();
}

export const askJaveContext: CommandDefinition = {
  kind: 'message_context',
  data: messageCommand('Ask JAVE'),
  help: { category: HELP_CATEGORY, summary: 'Ask JAVE about a message.' },
  requires: 'canUseAI',
  async execute(h) {
    const { target, text } = targetText(h.interaction.targetMessage);
    const id = pending.put(
      { ownerId: h.interaction.user.id, author: authorName(target), text },
      h.ctx.clock.now().getTime(),
    );
    await h.interaction.showModal(
      new ModalBuilder()
        .setCustomId(customId(AI_NS, 'askmsg', id))
        .setTitle('ASK JAVE ABOUT THIS MESSAGE')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Question')
            .setDescription('Optional. Leave empty and JAVE responds to the message.')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('question')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(MAX_QUESTION)
                .setRequired(false),
            ),
        )
        .toJSON(),
    );
  },
};

/** The 'Ask JAVE' modal: the message was stored when the menu opened. */
export async function submitMessageQuestion(h: HandlerContext, pendingId: string): Promise<void> {
  requireUser(h.ctx);
  const entry = pending.get(pendingId, h.ctx.clock.now().getTime());
  if (!entry || entry.ownerId !== h.interaction.user.id) return expiredControl(h);
  pending.delete(pendingId);
  await h.interaction.defer({ ephemeral: true });
  const question = h.interaction.modal.text('question').trim() || DEFAULT_MESSAGE_QUESTION;
  await runAsk(h, question, `${entry.author}: ${entry.text}`);
}

export const summarizeContext: CommandDefinition = {
  kind: 'message_context',
  data: messageCommand('Summarize'),
  help: { category: HELP_CATEGORY, summary: 'Summarize a message.' },
  requires: 'canUseAI',
  defer: 'ephemeral',
  async execute(h) {
    const { target, text } = targetText(h.interaction.targetMessage);
    await runSummarizeMessages(h, [summarizable(authorName(target), text, target.createdAt)]);
  },
};

export const explainContext: CommandDefinition = {
  kind: 'message_context',
  data: messageCommand('Explain'),
  help: { category: HELP_CATEGORY, summary: 'Explain a message in plain language.' },
  requires: 'canUseAI',
  defer: 'ephemeral',
  async execute(h) {
    const { text } = targetText(h.interaction.targetMessage);
    await runExplain(h, text);
  },
};

export const createTaskContext: CommandDefinition = {
  kind: 'message_context',
  data: messageCommand('Create Task'),
  help: {
    category: HELP_CATEGORY,
    summary: 'Draft a mission from a message. You confirm before anything is created.',
  },
  requires: 'canManageMissions',
  defer: 'ephemeral',
  async execute(h) {
    const { text } = targetText(h.interaction.targetMessage);
    await withAiLimits(h, async () => {
      const draft = await ai.draftTask(h.ctx, aiDepsOf(h.services), {
        brief: CREATE_TASK_BRIEF,
        source: text.slice(0, ai.MAX_DRAFT_BRIEF_LENGTH),
        surface: 'discord',
      });
      await h.respond(proposalPreview(draft.proposal, draft.warnings));
    });
  },
};

export const contextMenus: readonly CommandDefinition[] = [
  askJaveContext,
  summarizeContext,
  explainContext,
  createTaskContext,
];
