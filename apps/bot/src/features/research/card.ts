import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIComponentInMessageActionRow,
  APIEmbedField,
} from 'discord.js';
import { research } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  ACTION,
  AUTHORS_SHOWN,
  EVIDENCE_LABELS,
  LINK_URL_MAX,
  OPTION_TEXT_MAX,
  RESEARCH_NS,
  SIDUS_KICKER,
  SUMMARY_PREVIEW_MAX,
  SYNC_LABELS,
  TITLE_MAX,
} from './constants';

type Item = research.ResearchItemView;

/** What the viewer may do with an item (hidden controls, never disabled ones). */
export interface CardViewer {
  userId: string;
  canReview: boolean;
}

const STATUS_COLORS: Readonly<Record<research.ResearchStatus, number>> = {
  new: COLORS.steel,
  needs_review: COLORS.warning,
  reviewed: COLORS.info,
  verified: COLORS.success,
  archived: COLORS.graphite,
};

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
/** Longest identifier shown on a card (core caps DOIs well below this). */
const IDENTIFIER_MAX = 300;
/** U+02CB MODIFIER LETTER GRAVE ACCENT: reads like a backtick, never closes a code span. */
const BACKTICK_LOOKALIKE = '\u02CB';

/**
 * A URL safe to render as a link button: http(s), within Discord's limit and
 * never a Discord link (a CDN attachment or message from a channel the viewer
 * may not see is not a public reference).
 */
export function publicLink(url: string | null): string | null {
  if (!url || url.length > LINK_URL_MAX || research.isDiscordUrl(url)) return null;
  try {
    const parsed = new URL(url);
    return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Path segments encoded one by one, so identifiers keep their slashes. */
function encodePath(identifier: string): string {
  return identifier.split('/').map(encodeURIComponent).join('/');
}

export function doiLink(doi: string): string {
  return `https://doi.org/${encodePath(doi)}`;
}

export function arxivLink(arxivId: string): string {
  return `https://arxiv.org/abs/${encodePath(arxivId)}`;
}

function describe(item: Item): string {
  const lines = [`**${userText(item.title, TITLE_MAX)}**`];
  if (item.titleGuessed) lines.push('*Title guessed from the message. Metadata may correct it.*');
  if (item.authors.length > 0) {
    const shown = item.authors.slice(0, AUTHORS_SHOWN).join(', ');
    const more =
      item.authors.length > AUTHORS_SHOWN ? ` +${item.authors.length - AUTHORS_SHOWN}` : '';
    lines.push(userText(`${shown}${more}`, 400));
  }
  const venue = [item.source, item.publishedOn].filter(Boolean).join(` ${GLYPH.dot} `);
  if (venue) lines.push(userText(venue, 200));
  if (item.summary) lines.push('', userText(item.summary, SUMMARY_PREVIEW_MAX));
  return lines.join('\n');
}

/**
 * An identifier as inline code. Markdown is inert inside a code span, so only
 * a backtick could end it early (a DOI suffix may legally contain one): it is
 * replaced by a look-alike so the rest can never render as a masked link.
 */
export function codeSpan(value: string): string {
  return `\`${clip(value, IDENTIFIER_MAX).replaceAll('`', BACKTICK_LOOKALIKE)}\``;
}

function identifiers(item: Item): string | null {
  const parts = [
    item.doi ? `DOI ${codeSpan(item.doi)}` : null,
    item.arxivId ? `arXiv ${codeSpan(item.arxivId)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(` ${GLYPH.dot} `) : null;
}

function sidusLine(item: Item): string {
  const label = SYNC_LABELS[item.sidusSyncStatus];
  if (item.sidusSyncStatus === 'synced') {
    const when = item.sidusSyncedAt ? ` ${GLYPH.dot} ${discordTime(item.sidusSyncedAt, 'R')}` : '';
    return `${label}${when}`;
  }
  return item.sidusSyncError
    ? `${label} ${GLYPH.dot} ${userText(item.sidusSyncError, 200)}`
    : label;
}

function fields(item: Item, submitterDiscordId: string | null): APIEmbedField[] {
  const out = [
    field('Status', research.STATUS_LABELS[item.status], true),
    field('Evidence', EVIDENCE_LABELS[item.evidenceLevel], true),
    field('Topic', item.topic ? userText(item.topic, 80) : GLYPH.unknown, true),
  ];
  if (item.tags.length > 0) {
    out.push(field('Tags', item.tags.map((tag) => userText(tag, 32)).join(` ${GLYPH.dot} `)));
  }
  const ids = identifiers(item);
  if (ids) out.push(field('Identifiers', ids));
  const submitted = [
    submitterDiscordId ? `<@${submitterDiscordId}>` : null,
    discordTime(item.createdAt, 'R'),
  ].filter((part): part is string => part !== null);
  out.push(field('Submitted', submitted.join(` ${GLYPH.dot} `), true));
  if (item.reviewedAt) out.push(field('Reviewed', discordTime(item.reviewedAt, 'R'), true));
  out.push(field('Sidus', sidusLine(item), true));
  return out;
}

function linkRow(item: Item): APIActionRowComponent<APIComponentInMessageActionRow> | null {
  const links: APIButtonComponent[] = [];
  if (item.doi) links.push(linkButton('DOI', doiLink(item.doi)));
  if (item.arxivId) links.push(linkButton('arXiv', arxivLink(item.arxivId)));
  const source = publicLink(item.url);
  if (source && !item.doi && !item.arxivId) links.push(linkButton('Source', source));
  if (item.discordMessageUrl?.startsWith('https://')) {
    links.push(linkButton('Message', item.discordMessageUrl));
  }
  return links.length > 0 ? row(...links) : null;
}

function actionRow(
  item: Item,
  viewer: CardViewer,
): APIActionRowComponent<APIComponentInMessageActionRow> | null {
  const ownItem = item.submittedByUserId === viewer.userId;
  if (!viewer.canReview || ownItem) return null;
  const actions: APIButtonComponent[] = [
    button('Review', customId(RESEARCH_NS, ACTION.review, item.id), 'primary'),
  ];
  if (item.status === 'verified') {
    actions.push(button('Push to Sidus', customId(RESEARCH_NS, ACTION.sync, item.id)));
  }
  return row(...actions);
}

/** The item card: reference, review state, Sidus sync state and the controls the viewer may use. */
export function itemCard(
  item: Item,
  viewer: CardViewer,
  submitterDiscordId: string | null,
  notice?: { title: string; description: string },
): ReplyPayload {
  const embeds = [
    panel({
      kicker: `${SIDUS_KICKER} ${GLYPH.dot} RESEARCH`,
      title: 'Research item',
      description: describe(item),
      fields: fields(item, submitterDiscordId),
      color: STATUS_COLORS[item.status],
      footer: `Version ${item.version} ${GLYPH.dot} metadata ${item.enrichmentStatus.replace('_', ' ')}`,
    }),
  ];
  if (notice) {
    embeds.unshift(
      panel({ title: notice.title, description: notice.description, color: COLORS.success }),
    );
  }
  const components = [linkRow(item), actionRow(item, viewer)].filter(
    (component): component is APIActionRowComponent<APIComponentInMessageActionRow> =>
      component !== null,
  );
  return { embeds, components, ephemeral: true };
}

function optionDescription(item: Item): string {
  return clip(
    [research.STATUS_LABELS[item.status], EVIDENCE_LABELS[item.evidenceLevel], item.topic]
      .filter(Boolean)
      .join(` ${GLYPH.dot} `),
    OPTION_TEXT_MAX,
  );
}

/** A list of items with a select menu that opens one. */
export function itemList(
  heading: string,
  page: { items: readonly Item[]; total: number },
  emptyMessage: string,
): ReplyPayload {
  const lines = page.items.map(
    (item) =>
      `${GLYPH.bullet} **${userText(item.title, 120)}** ${GLYPH.dot} ${research.STATUS_LABELS[item.status]} ${GLYPH.dot} ${EVIDENCE_LABELS[item.evidenceLevel]}`,
  );
  const embed = panel({
    kicker: `${SIDUS_KICKER} ${GLYPH.dot} LIBRARY`,
    title: heading,
    description: lines.length > 0 ? lines.join('\n') : emptyMessage,
    color: COLORS.base,
    footer:
      page.total > page.items.length
        ? `Showing ${page.items.length} of ${page.total}. Refine the search, or browse the dashboard.`
        : `${page.total} ${page.total === 1 ? 'item' : 'items'}`,
  });
  const components =
    page.items.length > 0
      ? [
          row(
            stringSelect(
              customId(RESEARCH_NS, ACTION.open),
              'Open an item',
              page.items.map((item) => ({
                label: clip(item.title, OPTION_TEXT_MAX),
                value: item.id,
                description: optionDescription(item),
              })),
            ),
          ),
        ]
      : [];
  return { embeds: [embed], components, ephemeral: true };
}
