import { z } from 'zod';
import type { AISurface } from '@jave/ai';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import { createTaskAction, draftAnnouncementAction } from './actions/kinds';
import type { RegisteredActionKind } from './actions/registry';
import {
  type AiFeature,
  MAX_ABSOLUTE_INPUT_CHARS,
  MAX_MESSAGE_AUTHOR_LENGTH,
  MAX_SUMMARIZE_MESSAGE_LENGTH,
  MAX_SUMMARIZE_MESSAGES,
} from './constants';
import { assertProposalCapacity, proposeAction, type ProposalView } from './proposals.service';
import { type AiDeps, type AiWarning, type CompletionResult, runCompletion } from './runtime';
import {
  parseAnnouncementDraft,
  parseResearchAnswer,
  parseTaskDraft,
  type ResearchAnswer,
} from './structured-output';

const surfaceSchema = z.enum(['discord', 'dashboard']).default('discord');
const requestText = z.string().trim().min(1).max(MAX_ABSOLUTE_INPUT_CHARS);

export const askSchema = z.object({
  question: requestText,
  context: z.string().trim().max(MAX_ABSOLUTE_INPUT_CHARS).optional(),
  surface: surfaceSchema,
});

export const researchQuestionSchema = z.object({ question: requestText, surface: surfaceSchema });

export const summarizeSchema = z
  .object({
    text: z.string().trim().max(MAX_ABSOLUTE_INPUT_CHARS).optional(),
    messages: z
      .array(
        z.object({
          author: z.string().trim().min(1).max(MAX_MESSAGE_AUTHOR_LENGTH),
          content: z.string().max(MAX_SUMMARIZE_MESSAGE_LENGTH),
          sentAt: z.iso.datetime().optional(),
        }),
      )
      .min(1)
      .max(MAX_SUMMARIZE_MESSAGES)
      .optional(),
    surface: surfaceSchema,
  })
  .refine((d) => Boolean(d.text) !== Boolean(d.messages), 'Provide either text or messages.');

export const textInputSchema = z.object({ text: requestText, surface: surfaceSchema });

export const brainstormSchema = z.object({
  topic: z.string().trim().min(1).max(2000),
  constraints: z.string().trim().max(2000).optional(),
  surface: surfaceSchema,
});

const MAX_DRAFT_BRIEF_LENGTH = 4000;

export const draftAnnouncementInputSchema = z.object({
  brief: z.string().trim().min(1).max(MAX_DRAFT_BRIEF_LENGTH),
  surface: surfaceSchema,
});

export const draftTaskInputSchema = z.object({
  brief: z.string().trim().min(1).max(MAX_DRAFT_BRIEF_LENGTH),
  surface: surfaceSchema,
});

/** A plain AI answer. `text` is raw model output: surfaces must sanitize before posting. */
export interface AiAnswer {
  text: string;
  aiRequestId: string;
  model: string;
  provider: string;
  truncated: boolean;
  warnings: AiWarning[];
}

function answer(result: CompletionResult): AiAnswer {
  return {
    text: result.text,
    aiRequestId: result.aiRequestId,
    model: result.model,
    provider: result.provider,
    truncated: result.truncated,
    warnings: result.warnings,
  };
}

/** READ: answer a member's question, optionally over pasted context (untrusted). */
export async function ask(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof askSchema>,
): Promise<AiAnswer> {
  const data = parseInput(askSchema, input);
  return answer(
    await runCompletion(ctx, deps, {
      feature: 'ask',
      surface: data.surface,
      request: data.question,
      data: data.context ? [{ label: 'context', text: data.context }] : [],
    }),
  );
}

export type ResearchResult = AiAnswer & ResearchAnswer;

/**
 * READ: a structured research brief from the model's own knowledge. JAVE does
 * not browse; every suggested source is labelled model-suggested and unverified.
 */
export async function research(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof researchQuestionSchema>,
): Promise<ResearchResult> {
  const data = parseInput(researchQuestionSchema, input);
  const result = await runCompletion(ctx, deps, {
    feature: 'research',
    surface: data.surface,
    request: data.question,
  });
  return { ...answer(result), ...parseResearchAnswer(result.text) };
}

function transcript(messages: NonNullable<z.output<typeof summarizeSchema>['messages']>): string {
  return messages
    .map((m) => `${m.sentAt ? `[${m.sentAt}] ` : ''}${m.author}: ${m.content}`)
    .join('\n');
}

/** READ: summarize pasted text or a list of Discord messages (untrusted). */
export async function summarize(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof summarizeSchema>,
): Promise<AiAnswer> {
  const data = parseInput(summarizeSchema, input);
  const text = data.messages ? transcript(data.messages) : (data.text ?? '');
  return answer(
    await runCompletion(ctx, deps, {
      feature: 'summarize',
      surface: data.surface,
      data: [{ label: data.messages ? 'discord_messages' : 'text', text }],
    }),
  );
}

/** READ: claims, evidence, gaps and open questions in a text (untrusted). */
export async function analyze(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof textInputSchema>,
): Promise<AiAnswer> {
  const data = parseInput(textInputSchema, input);
  return answer(
    await runCompletion(ctx, deps, {
      feature: 'analyze',
      surface: data.surface,
      data: [{ label: 'text', text: data.text }],
    }),
  );
}

/** SUGGEST: concrete ideas for a topic. */
export async function brainstorm(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof brainstormSchema>,
): Promise<AiAnswer> {
  const data = parseInput(brainstormSchema, input);
  return answer(
    await runCompletion(ctx, deps, {
      feature: 'brainstorm',
      surface: data.surface,
      request: data.constraints ? `${data.topic}\nConstraints: ${data.constraints}` : data.topic,
    }),
  );
}

/** READ: a plain-language explanation of a text (untrusted). */
export async function explain(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof textInputSchema>,
): Promise<AiAnswer> {
  const data = parseInput(textInputSchema, input);
  return answer(
    await runCompletion(ctx, deps, {
      feature: 'explain',
      surface: data.surface,
      data: [{ label: 'text', text: data.text }],
    }),
  );
}

type DraftFeature = Extract<AiFeature, 'draft_announcement' | 'draft_task'>;

/** A model draft stored as a pending proposal. Nothing has executed. */
export interface DraftProposalResult {
  proposal: ProposalView;
  aiRequestId: string;
  warnings: AiWarning[];
}

/**
 * SUGGEST → PREVIEW for draft features: the caller must be allowed to
 * propose the kind and have room for another pending proposal BEFORE a model
 * request is spent; the model's output only ever becomes a pending proposal.
 */
async function draftProposal(
  ctx: ServiceContext,
  deps: AiDeps,
  kind: RegisteredActionKind,
  spec: { feature: DraftFeature; surface: AISurface; brief: string },
  toPayload: (text: string) => Record<string, unknown>,
): Promise<DraftProposalResult> {
  const actor = requireUser(ctx);
  await authorize(ctx, kind.capabilityToPropose, { type: 'ai_proposal' });
  await assertProposalCapacity(ctx, actor.userId);
  const result = await runCompletion(ctx, deps, {
    feature: spec.feature,
    surface: spec.surface,
    request: spec.brief,
  });
  const proposal = await proposeAction(ctx, {
    kind: kind.kind,
    payload: toPayload(result.text),
    aiRequestId: result.aiRequestId,
  });
  return { proposal, aiRequestId: result.aiRequestId, warnings: result.warnings };
}

/**
 * SUGGEST → PREVIEW: the model drafts an announcement and JAVE stores it as a
 * pending proposal. Nothing is posted until a broadcaster confirms it.
 */
export async function draftAnnouncement(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof draftAnnouncementInputSchema>,
): Promise<DraftProposalResult> {
  const data = parseInput(draftAnnouncementInputSchema, input);
  return draftProposal(
    ctx,
    deps,
    draftAnnouncementAction,
    { feature: 'draft_announcement', surface: data.surface, brief: data.brief },
    (text) => {
      const draft = parseAnnouncementDraft(text);
      return { title: draft.title, body: draft.body };
    },
  );
}

/**
 * SUGGEST → PREVIEW: the model drafts a mission and JAVE stores it as a
 * pending `create_task` proposal. A mission manager must confirm; it is then
 * created as DRAFT, never published.
 */
export async function draftTask(
  ctx: ServiceContext,
  deps: AiDeps,
  input: z.input<typeof draftTaskInputSchema>,
): Promise<DraftProposalResult> {
  const data = parseInput(draftTaskInputSchema, input);
  return draftProposal(
    ctx,
    deps,
    createTaskAction,
    { feature: 'draft_task', surface: data.surface, brief: data.brief },
    (text) => ({ ...parseTaskDraft(text) }),
  );
}
