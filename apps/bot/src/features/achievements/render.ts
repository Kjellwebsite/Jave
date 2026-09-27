import type { APIEmbed } from 'discord.js';
import { achievements } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, panel, row } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';

/** Custom-id namespace of every achievements control. */
export const ACHIEVEMENTS_NS = 'achievements';
/** Catalog lines per page: keeps a page well inside the embed description limit. */
export const CATALOG_PAGE_SIZE = 10;
/** Member display names and handles are at most this long (members table). */
export const NAME_MAX = 64;
const { TITLE_MAX, SUMMARY_MAX, DESCRIPTION_MAX } = achievements;

export type Rarity = achievements.AchievementRarity;

export const RARITY_LABEL: Record<Rarity, string> = {
  standard: 'STANDARD',
  notable: 'NOTABLE',
  rare: 'RARE',
  exceptional: 'EXCEPTIONAL',
  singular: 'SINGULAR',
};

/** Near-monochrome: rarer is brighter, never coloured. */
export const RARITY_COLOR: Record<Rarity, number> = {
  standard: COLORS.steel,
  notable: COLORS.base,
  rare: COLORS.chrome,
  exceptional: COLORS.chrome,
  singular: COLORS.chrome,
};

export type LineState = 'verified' | 'pending' | 'locked' | 'masked';

const STATE_GLYPH: Record<LineState, string> = {
  verified: GLYPH.verified,
  pending: GLYPH.claimed,
  locked: GLYPH.unknown,
  masked: GLYPH.bullet,
};

const STATE_ORDER: Record<LineState, number> = { verified: 0, pending: 0, locked: 1, masked: 2 };

export const CATALOG_LEGEND = `${GLYPH.verified} verified ${GLYPH.dot} ${GLYPH.claimed} pending verification ${GLYPH.dot} ${GLYPH.unknown} locked ${GLYPH.dot} % of active members`;

export interface CatalogLine {
  title: string;
  summary: string;
  rarity: Rarity;
  state: LineState;
  percent: number | null;
}

/**
 * Share of active members holding an achievement: by key where the viewer
 * may see the definition, by catalog slot where it is masked for them.
 */
export interface HolderShares {
  byKey: ReadonlyMap<string, number>;
  bySlot: ReadonlyMap<number, number>;
}

export interface HeldAward {
  key: string;
  title: string;
  summary: string;
  rarity: Rarity;
  visibility: achievements.AchievementVisibility;
  verified: boolean;
}

/**
 * Merge the viewer's catalog with the target member's awards. Hidden
 * achievements the member unlocked are revealed (as on their profile) and
 * take the place of one masked slot of the same rarity; everything the
 * viewer may not see stays masked.
 */
export function buildCatalogLines(
  catalog: readonly achievements.CatalogEntry[],
  held: readonly HeldAward[],
  shares: HolderShares,
): CatalogLine[] {
  const heldByKey = new Map(held.map((award) => [award.key, award]));
  const revealedKeys = new Set<string>();
  const lines: CatalogLine[] = [];
  const masked: { rarity: Rarity; slot: number }[] = [];
  catalog.forEach((entry, slot) => {
    if (entry.masked) {
      masked.push({ rarity: entry.rarity, slot });
      return;
    }
    revealedKeys.add(entry.key);
    const award = heldByKey.get(entry.key);
    lines.push({
      title: entry.title,
      summary: entry.summary,
      rarity: entry.rarity,
      state: award ? (award.verified ? 'verified' : 'pending') : 'locked',
      percent: shares.byKey.get(entry.key) ?? null,
    });
  });
  for (const award of held) {
    if (revealedKeys.has(award.key)) continue;
    if (award.visibility === 'hidden') {
      const index = masked.findIndex((slot) => slot.rarity === award.rarity);
      if (index >= 0) masked.splice(index, 1);
    }
    lines.push({
      title: award.title,
      summary: award.summary,
      rarity: award.rarity,
      state: award.verified ? 'verified' : 'pending',
      percent: shares.byKey.get(award.key) ?? null,
    });
  }
  for (const slot of masked) {
    lines.push({
      title: achievements.HIDDEN_TITLE,
      summary: achievements.HIDDEN_SUMMARY,
      rarity: slot.rarity,
      state: 'masked',
      percent: shares.bySlot.get(slot.slot) ?? null,
    });
  }
  // Stable: unlocked first, then locked, then classified, each in catalog order.
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => STATE_ORDER[a.line.state] - STATE_ORDER[b.line.state] || a.index - b.index)
    .map(({ line }) => line);
}

/** Share of active members holding it; nobody holding it reads as nothing, not "0%". */
function formatPercent(percent: number | null): string {
  return percent === null || percent === 0 ? '' : ` ${GLYPH.dot} ${percent}%`;
}

export function renderLine(line: CatalogLine): string {
  const rarity = RARITY_LABEL[line.rarity];
  if (line.state === 'masked') {
    return `${STATE_GLYPH.masked} ${achievements.HIDDEN_TITLE} ${GLYPH.dot} ${rarity} — ${achievements.HIDDEN_SUMMARY}${formatPercent(line.percent)}`;
  }
  const title = userText(line.title.toUpperCase(), TITLE_MAX);
  const name = line.state === 'locked' ? title : `**${title}**`;
  const pending = line.state === 'pending' ? ` ${GLYPH.dot} pending verification` : '';
  return `${STATE_GLYPH[line.state]} ${name} ${GLYPH.dot} ${rarity} — ${userText(line.summary, SUMMARY_MAX)}${formatPercent(line.percent)}${pending}`;
}

export interface CatalogPanelInput {
  memberId: string;
  memberName: string;
  lines: readonly CatalogLine[];
  page: number;
  /** Staff controls for this member (never on shared messages). */
  staff: { canRevoke: boolean; canVerify: boolean } | null;
  /** Shared messages carry no controls: a click would re-render as someone else. */
  shared: boolean;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
}

/** Clamp a requested page to the pages that exist. */
export function clampPage(page: number, total: number): number {
  if (!Number.isInteger(page) || page < 0) return 0;
  return Math.min(page, pageCount(total) - 1);
}

export function renderCatalogPanel(input: CatalogPanelInput): ReplyPayload {
  const pages = pageCount(input.lines.length);
  const page = clampPage(input.page, input.lines.length);
  const unlocked = input.lines.filter(
    (line) => line.state === 'verified' || line.state === 'pending',
  ).length;
  const slice = input.lines.slice(page * CATALOG_PAGE_SIZE, (page + 1) * CATALOG_PAGE_SIZE);
  const header = `**${unlocked}** of ${input.lines.length} unlocked. Achievements mark verified outcomes — never activity.`;
  const body = slice.length > 0 ? slice.map(renderLine).join('\n') : 'No achievements defined yet.';
  const more =
    input.shared && pages > 1
      ? `\n\nShowing ${slice.length} of ${input.lines.length}. \`/achievements view\` lists all.`
      : '';
  const embed: APIEmbed = panel({
    kicker: 'JVLN ACHIEVEMENTS',
    title: userText(input.memberName, NAME_MAX),
    description: `${header}\n\n${body}${more}`,
    color: COLORS.chrome,
    footer:
      pages > 1 && !input.shared
        ? `${CATALOG_LEGEND}\nPage ${page + 1} of ${pages}`
        : CATALOG_LEGEND,
  });
  const components: NonNullable<ReplyPayload['components']> = [];
  if (!input.shared && pages > 1) {
    components.push(
      row(
        button(
          'Previous',
          customId(ACHIEVEMENTS_NS, 'page', input.memberId, page - 1),
          'secondary',
          page === 0,
        ),
        button(
          'Next',
          customId(ACHIEVEMENTS_NS, 'page', input.memberId, page + 1),
          'secondary',
          page >= pages - 1,
        ),
      ),
    );
  }
  if (!input.shared && input.staff) {
    const staffButtons = [button('Award', customId(ACHIEVEMENTS_NS, 'award', input.memberId))];
    if (input.staff.canRevoke)
      staffButtons.push(button('Revoke', customId(ACHIEVEMENTS_NS, 'revoke', input.memberId)));
    if (input.staff.canVerify)
      staffButtons.push(
        button('Verify', customId(ACHIEVEMENTS_NS, 'verify', input.memberId), 'success'),
      );
    components.push(row(...staffButtons));
  }
  return {
    embeds: [embed],
    components: components.length > 0 ? components : undefined,
    ephemeral: !input.shared,
  };
}

export interface AnnouncementCard {
  memberDiscordId: string | null;
  memberDisplayName: string;
  memberHandle: string;
  title: string;
  line: string;
  description: string;
  rarity: Rarity;
}

/** The public unlock card: "ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped." */
export function renderAnnouncement(card: AnnouncementCard) {
  const embed = panel({
    kicker: `${RARITY_LABEL[card.rarity]} ${GLYPH.dot} ACHIEVEMENT`,
    title: card.title,
    description: userText(card.description, DESCRIPTION_MAX),
    color: RARITY_COLOR[card.rarity],
    fields: [
      {
        name: 'HOLDER',
        value: `${userText(card.memberDisplayName, NAME_MAX)} ${GLYPH.dot} @${userText(card.memberHandle, NAME_MAX)}`,
      },
    ],
  });
  // The unlock line keeps the summary's own case; panel() would uppercase all of it.
  embed.title = userText(card.line, LIMITS.embedTitle);
  return {
    content: card.memberDiscordId ? `<@${card.memberDiscordId}>` : undefined,
    embeds: [embed],
  };
}
