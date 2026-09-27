import {
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { CommandDefinition, HandlerContext, ModalPayload } from '../../interactions/types';
import { AI_NS } from './answers';
import { readLinkedMessage } from './messages';
import {
  runAnalyze,
  runAsk,
  runBrainstorm,
  runResearch,
  runSummarizeMessages,
  runSummarizeText,
} from './run';

/**
 * /ask, /research, /summarize, /analyze, /brainstorm. With arguments they
 * answer at once; without, they open a modal with room for long text.
 * Answers are ephemeral: they are personal.
 */

/** Discord text inputs and our string options accept at most this many characters. */
export const MAX_TEXT_INPUT = 4000;
export const MAX_QUESTION = 2000;
const MAX_TOPIC = 300;
const MAX_CONSTRAINTS = 1000;
const MAX_LINK = 200;

export const SLASH_MODALS = ['ask', 'research', 'summarize', 'analyze', 'brainstorm'] as const;
export type SlashModal = (typeof SLASH_MODALS)[number];

interface InputSpec {
  id: string;
  label: string;
  description?: string;
  style: TextInputStyle;
  max: number;
  required: boolean;
  placeholder?: string;
}

function modal(title: string, action: SlashModal, inputs: readonly InputSpec[]): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(AI_NS, action))
    .setTitle(title)
    .addLabelComponents(
      inputs.map((input) => {
        const text = new TextInputBuilder()
          .setCustomId(input.id)
          .setStyle(input.style)
          .setMaxLength(input.max)
          .setRequired(input.required);
        if (input.placeholder) text.setPlaceholder(input.placeholder);
        const label = new LabelBuilder().setLabel(input.label).setTextInputComponent(text);
        if (input.description) label.setDescription(input.description);
        return label;
      }),
    )
    .toJSON();
}

const MODALS: Readonly<Record<SlashModal, ModalPayload>> = {
  ask: modal('ASK JAVE', 'ask', [
    {
      id: 'question',
      label: 'Question',
      style: TextInputStyle.Paragraph,
      max: MAX_QUESTION,
      required: true,
    },
    {
      id: 'context',
      label: 'Context',
      description: 'Optional. Pasted text JAVE should use as reference.',
      style: TextInputStyle.Paragraph,
      max: MAX_TEXT_INPUT,
      required: false,
    },
  ]),
  research: modal('RESEARCH', 'research', [
    {
      id: 'question',
      label: 'Research question',
      description: 'JAVE answers from model knowledge. Sources are unverified.',
      style: TextInputStyle.Paragraph,
      max: MAX_QUESTION,
      required: true,
    },
  ]),
  summarize: modal('SUMMARIZE', 'summarize', [
    {
      id: 'link',
      label: 'Message link',
      description: 'A JAVELIN message you can read. Or paste text below.',
      style: TextInputStyle.Short,
      max: MAX_LINK,
      required: false,
      placeholder: 'https://discord.com/channels/…',
    },
    {
      id: 'text',
      label: 'Text',
      style: TextInputStyle.Paragraph,
      max: MAX_TEXT_INPUT,
      required: false,
    },
  ]),
  analyze: modal('ANALYZE', 'analyze', [
    {
      id: 'text',
      label: 'Text to analyze',
      description: 'Claims, evidence, gaps and open questions.',
      style: TextInputStyle.Paragraph,
      max: MAX_TEXT_INPUT,
      required: true,
    },
  ]),
  brainstorm: modal('BRAINSTORM', 'brainstorm', [
    { id: 'topic', label: 'Topic', style: TextInputStyle.Short, max: MAX_TOPIC, required: true },
    {
      id: 'constraints',
      label: 'Constraints',
      description: 'Optional. Budget, time, skills, rules.',
      style: TextInputStyle.Paragraph,
      max: MAX_CONSTRAINTS,
      required: false,
    },
  ]),
};

async function openModal(h: HandlerContext, action: SlashModal): Promise<void> {
  await h.interaction.showModal(MODALS[action]);
}

async function summarizeEither(h: HandlerContext, text: string, link: string): Promise<void> {
  if (text && link) throw new ValidationError('Provide text or a message link, not both.');
  if (link) {
    await runSummarizeMessages(h, [await readLinkedMessage(h, link)]);
    return;
  }
  await runSummarizeText(h, text);
}

/** Modal submissions for the slash commands. The interaction is not yet acknowledged. */
export async function submitSlashModal(h: HandlerContext, action: SlashModal): Promise<void> {
  const field = (id: string) => h.interaction.modal.text(id).trim();
  await h.interaction.defer({ ephemeral: true });
  switch (action) {
    case 'ask':
      return runAsk(h, field('question'), field('context') || undefined);
    case 'research':
      return runResearch(h, field('question'));
    case 'summarize': {
      const text = field('text');
      const link = field('link');
      if (!text && !link) throw new ValidationError('Paste text or a message link.');
      return summarizeEither(h, text, link);
    }
    case 'analyze':
      return runAnalyze(h, field('text'));
    case 'brainstorm':
      return runBrainstorm(h, field('topic'), field('constraints') || undefined);
  }
}

const HELP_CATEGORY = 'intelligence';

export const askCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask JAVE AI. Without a question, opens a form for longer input.')
    .addStringOption((o) =>
      o.setName('question').setDescription('Your question').setMaxLength(MAX_QUESTION),
    )
    .addStringOption((o) =>
      o
        .setName('context')
        .setDescription('Optional reference text (treated as data)')
        .setMaxLength(MAX_TEXT_INPUT),
    )
    .toJSON(),
  help: { category: HELP_CATEGORY, summary: 'Ask JAVE AI a question.', usage: '/ask [question]' },
  requires: 'canUseAI',
  async execute(h) {
    const question = h.interaction.options.string('question')?.trim();
    if (!question) return openModal(h, 'ask');
    await h.interaction.defer({ ephemeral: true });
    await runAsk(h, question, h.interaction.options.string('context')?.trim() || undefined);
  },
};

export const researchCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('research')
    .setDescription('Structured research brief: key points, caveats, unverified sources.')
    .addStringOption((o) =>
      o.setName('question').setDescription('Research question').setMaxLength(MAX_QUESTION),
    )
    .toJSON(),
  help: {
    category: HELP_CATEGORY,
    summary: 'Research brief. Sources are model-suggested and unverified.',
    usage: '/research [question]',
  },
  requires: 'canUseAI',
  async execute(h) {
    const question = h.interaction.options.string('question')?.trim();
    if (!question) return openModal(h, 'research');
    await h.interaction.defer({ ephemeral: true });
    await runResearch(h, question);
  },
};

export const summarizeCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize text or a JAVELIN message link.')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to summarize').setMaxLength(MAX_TEXT_INPUT),
    )
    .addStringOption((o) =>
      o
        .setName('message_link')
        .setDescription('Link to a message you can read')
        .setMaxLength(MAX_LINK),
    )
    .toJSON(),
  help: {
    category: HELP_CATEGORY,
    summary: 'Summarize text or a message link.',
    usage: '/summarize [text | message_link]',
  },
  requires: 'canUseAI',
  async execute(h) {
    const text = h.interaction.options.string('text')?.trim() ?? '';
    const link = h.interaction.options.string('message_link')?.trim() ?? '';
    if (!text && !link) return openModal(h, 'summarize');
    await h.interaction.defer({ ephemeral: true });
    await summarizeEither(h, text, link);
  },
};

export const analyzeCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('Claims, evidence, gaps and open questions in a text.')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to analyze').setMaxLength(MAX_TEXT_INPUT),
    )
    .toJSON(),
  help: { category: HELP_CATEGORY, summary: 'Analyze claims and evidence.', usage: '/analyze' },
  requires: 'canUseAI',
  async execute(h) {
    const text = h.interaction.options.string('text')?.trim();
    if (!text) return openModal(h, 'analyze');
    await h.interaction.defer({ ephemeral: true });
    await runAnalyze(h, text);
  },
};

export const brainstormCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('brainstorm')
    .setDescription('Concrete ideas for a topic, and how to test the strongest.')
    .addStringOption((o) => o.setName('topic').setDescription('Topic').setMaxLength(MAX_TOPIC))
    .addStringOption((o) =>
      o.setName('constraints').setDescription('Constraints').setMaxLength(MAX_CONSTRAINTS),
    )
    .toJSON(),
  help: { category: HELP_CATEGORY, summary: 'Ideas for a topic.', usage: '/brainstorm [topic]' },
  requires: 'canUseAI',
  async execute(h) {
    const topic = h.interaction.options.string('topic')?.trim();
    if (!topic) return openModal(h, 'brainstorm');
    await h.interaction.defer({ ephemeral: true });
    await runBrainstorm(h, topic, h.interaction.options.string('constraints')?.trim() || undefined);
  },
};

export const slashCommands: readonly CommandDefinition[] = [
  askCommand,
  researchCommand,
  summarizeCommand,
  analyzeCommand,
  brainstormCommand,
];
