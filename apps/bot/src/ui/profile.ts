import type { APIEmbedField } from 'discord.js';
import type { DomainSummary, ProfileView } from '@jave/core';
import type { ReplyPayload } from '../interactions/types';
import { customId } from '../interactions/custom-id';
import { button, field, linkButton, panel, row } from './components';
import { rankMark, userText } from './format';
import { COLORS, GLYPH } from './theme';

const BLANK: APIEmbedField = { name: '​', value: '​', inline: true };
export const RANK_LEGEND = `${GLYPH.verified} verified ${GLYPH.dot} ${GLYPH.claimed} claimed ${GLYPH.unknown} unknown`;

/** The rank shown for a domain: verified if present, otherwise the claim. */
export function domainMark(domain: DomainSummary): string {
  return domain.verifiedRank
    ? rankMark(domain.verifiedRank, 'verified')
    : rankMark(domain.claimedRank, domain.status);
}

/** Lay out inline fields in rows of three, padding the last row. */
export function grid(fields: APIEmbedField[]): APIEmbedField[] {
  const out = [...fields];
  while (out.length % 3 !== 0) out.push(BLANK);
  return out;
}

export function profileUrl(publicUrl: string | undefined, handle: string): string | null {
  if (!publicUrl) return null;
  try {
    return new URL(`/p/${encodeURIComponent(handle)}`, publicUrl).toString();
  } catch {
    return null;
  }
}

/** JVLN PROFILE card. */
export function renderProfileCard(
  view: ProfileView,
  options: { publicUrl?: string; ephemeral: boolean },
): ReplyPayload {
  const title = view.isVerifiedMember
    ? `${view.displayName} ${GLYPH.dot} VERIFIED`
    : view.displayName;
  const lines: string[] = [];
  if (view.headline) lines.push(userText(view.headline, 160));
  const roleLine = [view.primaryRole?.toUpperCase(), `@${view.handle}`]
    .filter(Boolean)
    .join(`  ${GLYPH.dot}  `);
  lines.push(`\`${roleLine}\``);
  if (!view.claimsVisible) lines.push('_Claims are private for this member._');

  const domains = grid(view.domains.map((d) => field(d.label, domainMark(d), true)));
  const record = grid([
    field('Trials', String(view.stats.trials), true),
    field('Passed', String(view.stats.trialsPassed), true),
    field('Projects', String(view.stats.projects), true),
    field('Contributions', String(view.stats.contributions), true),
    field('Missions', String(view.stats.missionsCompleted), true),
    field('Achievements', String(view.stats.achievements), true),
  ]);
  const fields = [...domains, ...record];
  if (view.achievements.length > 0) {
    fields.push(
      field(
        'Recent achievements',
        view.achievements
          .slice(0, 3)
          .map(
            (a) =>
              `${GLYPH.bullet} ${a.title.toUpperCase()}${a.verified ? ` ${GLYPH.verified}` : ''}`,
          )
          .join('\n'),
      ),
    );
  }

  const url = profileUrl(options.publicUrl, view.handle);
  const buttons = [button('Capabilities', customId('profile', 'facets', view.memberId))];
  if (url) buttons.push(linkButton('Open profile', url));

  return {
    embeds: [
      panel({
        kicker: 'JVLN PROFILE',
        title,
        description: lines.join('\n'),
        color: view.isVerifiedMember ? COLORS.chrome : COLORS.base,
        fields,
        thumbnailUrl: view.avatarUrl,
        footer: RANK_LEGEND,
      }),
    ],
    components: [row(...buttons)],
    ephemeral: options.ephemeral,
  };
}

/** Facet-level breakdown of every domain. */
export function renderCapabilities(view: ProfileView): ReplyPayload {
  const fields = view.domains.map((domain) =>
    field(
      `${domain.label} ${GLYPH.dot} ${domainMark(domain)}`,
      domain.facets
        .map((f) => {
          const verified = f.verifiedRank ? rankMark(f.verifiedRank, 'verified') : null;
          const claimed = f.claimedRank ? rankMark(f.claimedRank, 'claimed') : null;
          const marks = [verified, claimed].filter(Boolean).join('  ') || GLYPH.unknown;
          return `${f.label.padEnd(12, ' ')} ${marks}`;
        })
        .join('\n'),
      false,
    ),
  );
  return {
    embeds: [
      panel({
        kicker: 'JVLN CAPABILITIES',
        title: view.displayName,
        description:
          'Verified ranks come from evidence, trials and evaluators. Claims are self-reported.',
        fields,
        footer: RANK_LEGEND,
      }),
    ],
    ephemeral: true,
  };
}
