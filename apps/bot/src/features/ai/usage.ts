import { ai, can } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { field, panel } from '../../ui/components';
import { alignRows, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { aiDepsOf } from './deps';

/** How many features / members the org view lists. */
const TOP_ROWS = 5;
const TODAY_ONLY = 1;

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * `/jave ai-usage`: your requests today against the daily limit. Analytics
 * viewers also see organization totals (aggregates only); audit-log readers
 * see the heaviest members today. Never prompts or answers.
 */
export async function aiUsageReport(h: HandlerContext): Promise<void> {
  const mine = await ai.getUsage(h.ctx, aiDepsOf(h.services));
  const fields = [
    field(
      'You today',
      [
        `**${mine.used}** / ${mine.limit} requests ${GLYPH.dot} ${mine.remaining} remaining`,
        `Resets ${discordTime(mine.resetsAt, 'R')} (00:00 UTC)`,
        mine.enabled ? null : 'JAVE AI is disabled in settings.',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ];
  if (can(h.ctx, 'canViewAnalytics')) {
    const org = await ai.getOrgUsage(h.ctx, { days: TODAY_ONLY });
    const features = org.byFeature
      .slice(0, TOP_ROWS)
      .map((row): [string, string] => [row.feature, `${count(row.requests)}`]);
    fields.push(
      field(
        'Organization today',
        [
          `${count(org.requests)} requests ${GLYPH.dot} ${count(org.distinctUsers)} members`,
          `${count(org.inputTokens)} tokens in ${GLYPH.dot} ${count(org.outputTokens)} out`,
          features.length > 0 ? `\`\`\`\n${alignRows(features)}\n\`\`\`` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    );
  }
  if (can(h.ctx, 'canViewAuditLogs')) {
    const members = await ai.getUsageByUser(h.ctx, { limit: TOP_ROWS });
    fields.push(
      field(
        'Heaviest today',
        members.length > 0
          ? members
              .map(
                (row) =>
                  `${GLYPH.bullet} ${userText(row.displayName ?? 'unknown member', 64)} ${GLYPH.dot} ${row.counted} counted ${GLYPH.dot} ${row.attempts} attempts`,
              )
              .join('\n')
          : 'No AI requests today.',
      ),
    );
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'JAVE AI',
        title: 'AI usage',
        fields,
        color: COLORS.base,
        footer: 'Counts only. JAVE never stores prompts or answers.',
      }),
    ],
    ephemeral: true,
  });
}
