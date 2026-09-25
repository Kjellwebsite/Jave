import type { APIEmbedField, APISelectMenuOption } from 'discord.js';
import { projects } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  CARD_LINKS_SHOWN,
  CARD_MEMBERS_SHOWN,
  CARD_MILESTONES_SHOWN,
  DESCRIPTION_PREVIEW_MAX,
  LINE_TEXT_MAX,
  PROJECTS_NS,
  SUMMARY_MAX,
} from './constants';

/** The lifecycle as shown on cards; ARCHIVED sits outside it. */
export const PIPELINE: readonly projects.ProjectStatus[] = [
  'idea',
  'planning',
  'building',
  'testing',
  'shipped',
];

export const VISIBILITY_LABELS: Readonly<Record<projects.ProjectVisibility, string>> = {
  public: 'PUBLIC',
  members: 'MEMBERS',
  private: 'PRIVATE',
};

export const ROLE_LABELS: Readonly<Record<projects.ProjectRole, string>> = {
  owner: 'OWNER',
  maintainer: 'MAINTAINER',
  contributor: 'CONTRIBUTOR',
};

const MILESTONE_GLYPH: Readonly<Record<projects.MilestoneStatus, string>> = {
  done: GLYPH.verified,
  active: GLYPH.bullet,
  planned: GLYPH.claimed,
  dropped: GLYPH.cross,
};

/** Longest URL rendered verbatim; longer ones are left to the dashboard. */
const MAX_RENDERED_URL = 512;

export function statusColor(status: projects.ProjectStatus): number {
  if (status === 'shipped') return COLORS.success;
  if (status === 'archived') return COLORS.steel;
  return COLORS.base;
}

/** `IDEA → PLANNING → **▸ BUILDING** → TESTING → SHIPPED` (ARCHIVED is its own line). */
export function pipeline(status: projects.ProjectStatus): string {
  if (status === 'archived') return `**${projects.STATUS_LABELS.archived}** ${GLYPH.dot} frozen`;
  return PIPELINE.map((stage) =>
    stage === status
      ? `**${GLYPH.bullet} ${projects.STATUS_LABELS[stage]}**`
      : projects.STATUS_LABELS[stage],
  ).join(` ${GLYPH.arrow} `);
}

/** An http(s) URL short enough to render verbatim, or null. */
export function renderableUrl(url: string | null): string | null {
  if (!url || url.length > MAX_RENDERED_URL) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function dashboardProjectUrl(publicUrl: string | undefined, slug: string): string | null {
  if (!publicUrl) return null;
  try {
    return new URL(`/projects/${encodeURIComponent(slug)}`, publicUrl).toString();
  } catch {
    return null;
  }
}

function teamField(detail: projects.ProjectDetail): APIEmbedField {
  const lines = detail.members
    .slice(0, CARD_MEMBERS_SHOWN)
    .map(
      (m) =>
        `${GLYPH.bullet} ${userText(m.displayName, LINE_TEXT_MAX)} ${GLYPH.dot} \`${ROLE_LABELS[m.role]}\``,
    );
  const unnamed = detail.members.length - Math.min(detail.members.length, CARD_MEMBERS_SHOWN);
  const more = unnamed + detail.hiddenMemberCount;
  if (more > 0) lines.push(`+${more} more`);
  return field(`Team ${GLYPH.dot} ${detail.memberCount}`, lines.join('\n') || GLYPH.unknown);
}

function milestoneLine(m: projects.MilestoneRecord): string {
  const due =
    m.dueAt && m.status !== 'done' && m.status !== 'dropped'
      ? ` ${GLYPH.dot} due ${discordTime(m.dueAt, 'd')}`
      : '';
  return `${MILESTONE_GLYPH[m.status]} ${userText(m.title, LINE_TEXT_MAX)} ${GLYPH.dot} ${m.status.toUpperCase()}${due}`;
}

function milestonesField(detail: projects.ProjectDetail): APIEmbedField | null {
  if (detail.milestones.length === 0) return null;
  const done = detail.milestones.filter((m) => m.status === 'done').length;
  const lines = detail.milestones.slice(0, CARD_MILESTONES_SHOWN).map(milestoneLine);
  if (detail.milestones.length > CARD_MILESTONES_SHOWN)
    lines.push(`+${detail.milestones.length - CARD_MILESTONES_SHOWN} more`);
  return field(
    `Milestones ${GLYPH.dot} ${done}/${detail.milestones.length} done`,
    lines.join('\n'),
  );
}

function linksField(detail: projects.ProjectDetail): APIEmbedField | null {
  const lines: string[] = [];
  if (detail.githubRepo)
    lines.push(`${GLYPH.bullet} **GitHub** ${GLYPH.dot} \`${detail.githubRepo}\``);
  for (const link of detail.links.slice(0, CARD_LINKS_SHOWN)) {
    const url = renderableUrl(link.url);
    lines.push(
      `${GLYPH.bullet} **${userText(link.label, LINE_TEXT_MAX)}**${url ? ` ${GLYPH.dot} ${url}` : ''}`,
    );
  }
  const website = renderableUrl(detail.websiteUrl);
  if (website) lines.push(`${GLYPH.bullet} **Website** ${GLYPH.dot} ${website}`);
  return lines.length > 0 ? field('Links', lines.join('\n')) : null;
}

function cardEmbed(detail: projects.ProjectDetail) {
  const meta = [
    `\`${detail.slug}\``,
    VISIBILITY_LABELS[detail.visibility],
    detail.domainKey?.toUpperCase(),
  ].filter(Boolean);
  const description = [
    detail.summary ? userText(detail.summary, SUMMARY_MAX) : null,
    meta.join(` ${GLYPH.dot} `),
    '',
    pipeline(detail.status),
  ]
    .filter((line) => line !== null)
    .join('\n');
  const fields: APIEmbedField[] = [teamField(detail)];
  const milestones = milestonesField(detail);
  if (milestones) fields.push(milestones);
  const links = linksField(detail);
  if (links) fields.push(links);
  if (detail.description)
    fields.push(field('About', userText(detail.description, DESCRIPTION_PREVIEW_MAX)));
  if (detail.shippedAt) fields.push(field('Shipped', discordTime(detail.shippedAt, 'D'), true));
  return panel({
    kicker: 'JVLN PROJECT',
    title: userText(detail.title, LINE_TEXT_MAX),
    description,
    color: statusColor(detail.status),
    fields,
  });
}

/**
 * The project card. Ephemeral cards carry the viewer's own controls (each
 * re-authorized on click); shared cards carry only the dashboard link.
 */
export function projectCard(
  detail: projects.ProjectDetail,
  options: { publicUrl?: string; shared?: boolean } = {},
): ReplyPayload {
  const url = dashboardProjectUrl(options.publicUrl, detail.slug);
  const linkRow = url ? [row(linkButton('Open in dashboard', url))] : [];
  if (options.shared) return { embeds: [cardEmbed(detail)], components: linkRow, ephemeral: false };

  const id = detail.id;
  const controls = [];
  const archived = detail.status === 'archived';
  if (detail.viewer.canEdit) {
    controls.push(button('Status', customId(PROJECTS_NS, 'status', id), 'primary'));
    controls.push(button('Add milestone', customId(PROJECTS_NS, 'msadd', id)));
    if (detail.milestones.some((m) => m.status === 'planned' || m.status === 'active'))
      controls.push(button('Complete milestone', customId(PROJECTS_NS, 'msdone', id)));
  }
  if (detail.viewer.role && !archived)
    controls.push(button('Record contribution', customId(PROJECTS_NS, 'contribute', id)));
  if (detail.viewer.role && detail.viewer.role !== 'owner')
    controls.push(button('Leave', customId(PROJECTS_NS, 'leave', id), 'danger'));
  const components = [...(controls.length > 0 ? [row(...controls)] : []), ...linkRow];
  return { embeds: [cardEmbed(detail)], components, ephemeral: true };
}

/** One select option per project (label = title, description = status and team size). */
export function projectOptions(items: readonly projects.ProjectSummary[]): APISelectMenuOption[] {
  return items.map((project) => ({
    label: clip(project.title, LINE_TEXT_MAX),
    description: `${projects.STATUS_LABELS[project.status]} ${GLYPH.dot} ${project.memberCount} ${project.memberCount === 1 ? 'member' : 'members'}`,
    value: project.id,
  }));
}

export function projectLine(project: projects.ProjectSummary): string {
  const members = `${project.memberCount} ${project.memberCount === 1 ? 'member' : 'members'}`;
  return `${GLYPH.bullet} **${userText(project.title, LINE_TEXT_MAX)}** ${GLYPH.dot} ${projects.STATUS_LABELS[project.status]} ${GLYPH.dot} ${members}`;
}
