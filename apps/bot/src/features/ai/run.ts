import { ai } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { replyWithAnswer, UNVERIFIED_SOURCES_NOTICE, withAiLimits } from './answers';
import { researchBrief } from './research-brief';
import type { SummarizableMessage } from './messages';

/**
 * The AI calls behind every Discord surface. Each one runs as the invoking
 * member through core (capability, limits, redaction, ledger) and replies
 * with a sanitized, paginated, ephemeral answer. The interaction must
 * already be deferred.
 */

const SURFACE = 'discord';

export async function runAsk(h: HandlerContext, question: string, context?: string) {
  await withAiLimits(h, async () => {
    const answer = await ai.ask(h.ctx, h.services.ai, { question, context, surface: SURFACE });
    await replyWithAnswer(h, { kicker: 'JAVE AI · ASK', title: 'Answer' }, answer);
  });
}

export async function runResearch(h: HandlerContext, question: string) {
  await withAiLimits(h, async () => {
    const result = await ai.research(h.ctx, h.services.ai, { question, surface: SURFACE });
    await replyWithAnswer(
      h,
      { kicker: 'JAVE AI · RESEARCH', title: 'Research brief' },
      { ...result, text: researchBrief(result) },
      result.suggestedSources.length > 0 ? [UNVERIFIED_SOURCES_NOTICE] : [],
    );
  });
}

export async function runSummarizeText(h: HandlerContext, text: string) {
  await withAiLimits(h, async () => {
    const answer = await ai.summarize(h.ctx, h.services.ai, { text, surface: SURFACE });
    await replyWithAnswer(h, { kicker: 'JAVE AI · SUMMARIZE', title: 'Summary' }, answer);
  });
}

export async function runSummarizeMessages(
  h: HandlerContext,
  messages: readonly SummarizableMessage[],
) {
  await withAiLimits(h, async () => {
    const answer = await ai.summarize(h.ctx, h.services.ai, {
      messages: [...messages],
      surface: SURFACE,
    });
    await replyWithAnswer(h, { kicker: 'JAVE AI · SUMMARIZE', title: 'Summary' }, answer);
  });
}

export async function runAnalyze(h: HandlerContext, text: string) {
  await withAiLimits(h, async () => {
    const answer = await ai.analyze(h.ctx, h.services.ai, { text, surface: SURFACE });
    await replyWithAnswer(h, { kicker: 'JAVE AI · ANALYZE', title: 'Analysis' }, answer);
  });
}

export async function runExplain(h: HandlerContext, text: string) {
  await withAiLimits(h, async () => {
    const answer = await ai.explain(h.ctx, h.services.ai, { text, surface: SURFACE });
    await replyWithAnswer(h, { kicker: 'JAVE AI · EXPLAIN', title: 'Explanation' }, answer);
  });
}

export async function runBrainstorm(h: HandlerContext, topic: string, constraints?: string) {
  await withAiLimits(h, async () => {
    const answer = await ai.brainstorm(h.ctx, h.services.ai, {
      topic,
      constraints,
      surface: SURFACE,
    });
    await replyWithAnswer(h, { kicker: 'JAVE AI · BRAINSTORM', title: 'Ideas' }, answer);
  });
}
