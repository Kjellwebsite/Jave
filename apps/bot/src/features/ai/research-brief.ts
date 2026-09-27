import type { ai } from '@jave/core';
import { GLYPH } from '../../ui/theme';

/**
 * Model-suggested URLs are shown as inline code: readable and copyable, but
 * not a one-click link, because nobody has verified them.
 */
function inertUrl(url: string): string {
  return `\`${url.replaceAll('`', '%60')}\``;
}

/**
 * A structured research answer as one Markdown document: answer, key points,
 * caveats, then model-suggested sources — every source explicitly labelled
 * unverified. The whole document is model output and is sanitized for
 * Discord by the caller.
 */
export function researchBrief(result: ai.ResearchResult): string {
  if (!result.structured) return result.answer;
  const sections = [result.answer];
  if (result.keyPoints.length > 0) {
    sections.push(
      ['**KEY POINTS**', ...result.keyPoints.map((point) => `${GLYPH.bullet} ${point}`)].join('\n'),
    );
  }
  if (result.caveats) sections.push(`**CAVEATS**\n${result.caveats}`);
  if (result.suggestedSources.length > 0) {
    const label = result.suggestedSources[0]!.label;
    sections.push(
      [
        `**SOURCES ${GLYPH.dot} ${label}**`,
        ...result.suggestedSources.map((source) => {
          const parts = [source.title, source.url && inertUrl(source.url), source.note].filter(
            (part): part is string => Boolean(part),
          );
          return `${GLYPH.bullet} ${parts.join(` ${GLYPH.dot} `)}`;
        }),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}
