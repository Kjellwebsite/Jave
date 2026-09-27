import { MOCK_PROVIDER_NAME, sanitizeForDiscord } from '@jave/ai';
import { ai, RateLimitedError, requireUser } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, failure, field, panel, row } from '../../ui/components';
import { discordTime } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { paginate } from './pages';
import { ExpiringStore } from './store';
import { aiDepsOf } from './deps';

export const AI_NS = 'ai';

/** Answers stay pageable for 30 minutes, then the buttons read EXPIRED. */
export const ANSWER_TTL_MS = 30 * 60_000;
/** Upper bound on answers held in memory per process (oldest dropped first). */
export const MAX_STORED_ANSWERS = 500;
/** Pageable answers per member; their oldest is dropped first, never someone else's. */
export const MAX_STORED_ANSWERS_PER_MEMBER = 20;
/**
 * Core caps answers at ai.MAX_OUTPUT_CHARS; neutralizing mentions adds a few
 * characters, so sanitize with headroom and let pagination do the splitting.
 */
const SANITIZE_LIMIT = ai.MAX_OUTPUT_CHARS * 2;

const WARNING_COPY: Readonly<Record<ai.AiWarning, string>> = {
  input_redacted: 'Secrets in your input were redacted before sending.',
  possible_prompt_injection:
    'The supplied text contains instruction-like content. It was treated as data.',
  output_truncated: 'The answer reached its length limit and was cut.',
};
const MOCK_NOTICE = 'MOCK / DEVELOPMENT ONLY provider — this is not a real answer.';
export const UNVERIFIED_SOURCES_NOTICE =
  'Sources are MODEL-SUGGESTED — UNVERIFIED. JAVE does not browse; check each one.';

/** A rendered answer: sanitized pages plus what the footer and notice need. */
export interface AnswerDoc {
  ownerId: string;
  kicker: string;
  title: string;
  pages: string[];
  notices: string[];
  model: string;
  usage: ai.MyAiUsage;
}

const answers = new ExpiringStore<AnswerDoc>({
  ttlMs: ANSWER_TTL_MS,
  maxEntries: MAX_STORED_ANSWERS,
  maxPerOwner: MAX_STORED_ANSWERS_PER_MEMBER,
});

function footer(doc: AnswerDoc, page: number): string {
  const parts = [
    doc.pages.length > 1 ? `PAGE ${page + 1}/${doc.pages.length}` : null,
    `${doc.usage.used}/${doc.usage.limit} AI REQUESTS TODAY`,
    'RESETS 00:00 UTC',
    doc.model,
  ];
  return parts.filter((part): part is string => part !== null).join(` ${GLYPH.dot} `);
}

/** One page of an answer, with PREV / NEXT when there is more than one. */
export function answerPage(doc: AnswerDoc, answerId: string, page: number): ReplyPayload {
  const index = Math.min(Math.max(page, 0), doc.pages.length - 1);
  const embed = panel({
    kicker: doc.kicker,
    title: doc.title,
    description: doc.pages[index] || GLYPH.unknown,
    fields:
      index === 0 && doc.notices.length > 0
        ? [field('Notice', doc.notices.map((n) => `${GLYPH.bullet} ${n}`).join('\n'))]
        : undefined,
    color: COLORS.chrome,
    footer: footer(doc, index),
  });
  const components =
    doc.pages.length > 1
      ? [
          row(
            button('Prev', customId(AI_NS, 'page', answerId, index - 1), 'secondary', index === 0),
            button(
              'Next',
              customId(AI_NS, 'page', answerId, index + 1),
              'secondary',
              index === doc.pages.length - 1,
            ),
          ),
        ]
      : [];
  return { embeds: [embed], components, ephemeral: true };
}

export interface AnswerSource {
  text: string;
  provider: string;
  model: string;
  warnings: readonly ai.AiWarning[];
}

/**
 * Sanitize (no mentions, no masked links), paginate, attach today's usage,
 * store for paging, and reply with the first page.
 */
export async function replyWithAnswer(
  h: HandlerContext,
  heading: { kicker: string; title: string },
  answer: AnswerSource,
  extraNotices: readonly string[] = [],
): Promise<void> {
  const usage = await ai.getUsage(h.ctx, aiDepsOf(h.services));
  const notices = [
    ...(answer.provider === MOCK_PROVIDER_NAME ? [MOCK_NOTICE] : []),
    ...answer.warnings.map((warning) => WARNING_COPY[warning]),
    ...extraNotices,
  ];
  const doc: AnswerDoc = {
    ownerId: h.interaction.user.id,
    ...heading,
    pages: paginate(sanitizeForDiscord(answer.text, SANITIZE_LIMIT)),
    notices,
    model: answer.model,
    usage,
  };
  const answerId = answers.put(doc, h.ctx.clock.now().getTime());
  await h.respond(answerPage(doc, answerId, 0));
}

/** PREV / NEXT: only the member who asked may page, and only while the answer is cached. */
export async function turnPage(h: HandlerContext, answerId: string, page: number): Promise<void> {
  requireUser(h.ctx);
  const doc = answers.get(answerId, h.ctx.clock.now().getTime());
  if (!doc || !Number.isInteger(page)) {
    await h.respond({
      embeds: [failure('EXPIRED', 'This answer is no longer available. Ask again.')],
      ephemeral: true,
    });
    return;
  }
  if (doc.ownerId !== h.interaction.user.id) {
    await h.respond({
      embeds: [failure('ACCESS RESTRICTED', 'Only the member who asked can page this answer.')],
      ephemeral: true,
    });
    return;
  }
  await h.interaction.update(answerPage(doc, answerId, page));
}

/**
 * Run an AI call and turn limit errors into a precise reply: the burst limit
 * and the daily limit both say when AI is available again.
 */
export async function withAiLimits(h: HandlerContext, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    const retryAfterMs = error.retryAfterSeconds * 1000;
    const availableAt = new Date(h.ctx.clock.now().getTime() + retryAfterMs);
    await h.respond({
      embeds: [
        panel({
          title: 'AI LIMIT REACHED',
          description: `${error.userMessage}\nAvailable again ${discordTime(availableAt, 'R')}.`,
          color: COLORS.warning,
        }),
      ],
      ephemeral: true,
    });
  }
}
