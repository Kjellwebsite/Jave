import { authorize } from '@jave/core';
import type { ComponentHandler, HandlerContext, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, failure, field, panel, row } from '../../ui/components';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  type CheckItem,
  type CheckState,
  evaluateReadiness,
  type ReadinessReport,
} from './readiness';
import { probeReadiness } from './readiness-probe';
import { fitLines, SETTINGS_NS, SETUP_NS, showPanel } from './settings-ui';

export const CHECK_MARK: Record<CheckState, string> = {
  ok: GLYPH.verified,
  warn: '▲',
  fail: GLYPH.cross,
  off: GLYPH.unknown,
};

function itemLine(item: CheckItem): string {
  const line = `${CHECK_MARK[item.state]} ${item.text}`;
  return item.fix ? `${line}\n${GLYPH.arrow} ${item.fix}` : line;
}

function summary(report: ReadinessReport): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (report.failures > 0) {
    return `**${plural(report.failures, 'issue')} to fix** ${GLYPH.dot} ${plural(report.warnings, 'warning')}`;
  }
  if (report.warnings > 0) return `Operational ${GLYPH.dot} ${plural(report.warnings, 'warning')}.`;
  return 'Ready. Every check passed.';
}

export function renderReadiness(report: ReadinessReport): ReplyPayload {
  const color =
    report.failures > 0 ? COLORS.danger : report.warnings > 0 ? COLORS.warning : COLORS.success;
  return {
    embeds: [
      panel({
        kicker: 'JAVE SETUP',
        title: 'Readiness',
        description: summary(report),
        color,
        fields: report.sections.map((section) =>
          field(section.title, fitLines(section.items.map(itemLine))),
        ),
        footer: `${CHECK_MARK.ok} ready ${GLYPH.dot} ${CHECK_MARK.warn} warning ${GLYPH.dot} ${CHECK_MARK.fail} blocking ${GLYPH.dot} ${CHECK_MARK.off} not configured`,
      }),
    ],
    components: [
      row(
        button('Channels', customId(SETTINGS_NS, 'panel', 'channels')),
        button('Roles', customId(SETTINGS_NS, 'panel', 'roles')),
        button('Flags', customId(SETTINGS_NS, 'panel', 'flags')),
        button('Re-check', customId(SETUP_NS, 'recheck'), 'primary'),
      ),
    ],
    ephemeral: true,
  };
}

/** /jave setup and RE-CHECK: guided readiness check (canManageSettings). */
export async function runSetup(h: HandlerContext): Promise<void> {
  await authorize(h.ctx, 'canManageSettings', { type: 'settings', id: 'readiness' });
  if (h.interaction.kind === 'button' && !h.interaction.deferred) {
    await h.interaction.deferUpdate();
  }
  const input = await probeReadiness(h.ctx, h.services.gateway);
  await showPanel(h, renderReadiness(evaluateReadiness(input)));
}

export const setupComponents: ComponentHandler = {
  namespace: SETUP_NS,
  async handle(h, action) {
    if (action === 'recheck') return runSetup(h);
    await h.respond({
      embeds: [failure('EXPIRED', 'This control is no longer active.')],
      ephemeral: true,
    });
  },
};
