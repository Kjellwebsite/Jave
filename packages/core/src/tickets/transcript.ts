import type { TicketAttachment } from '@jave/database';
import { AI_SUMMARY_LABEL } from './constants';
import type {
  TicketAiSummary,
  TicketAuthorRole,
  TicketEventView,
  TicketMessageView,
  TicketSla,
} from './views';

/**
 * Pure transcript renderers. Every piece of text that originates outside
 * this file (subjects, names, message bodies, reasons, attachment names and
 * URLs) passes through an escaper before it is emitted.
 */

export type TranscriptFormat = 'markdown' | 'html';

export interface TranscriptModel {
  reference: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  opener: string | null;
  assignee: string | null;
  reopenCount: number;
  generatedAt: Date;
  includesInternal: boolean;
  /** Staff-only sections; null in the requester transcript. */
  sla: TicketSla | null;
  aiSummary: TicketAiSummary | null;
  messages: TicketMessageView[];
  events: TicketEventView[];
  truncated: boolean;
}

/** JAVELIN monochrome palette (mirrors the bot theme and the design tokens). */
const PALETTE = {
  background: '#0B0C0E',
  surface: '#141619',
  surfaceRaised: '#1B1E22',
  border: '#2A2D32',
  text: '#E8EAED',
  muted: '#8A8F96',
  accent: '#B8BDC3',
  steel: '#737981',
  danger: '#B86B6B',
  printBackground: '#FFFFFF',
  printText: '#000000',
  /** Secondary text on paper: 8.3:1 on white. */
  printMuted: '#4A4F55',
  /** Rules and tag outlines on paper: 4:1 on white. */
  printBorder: '#7A7F86',
} as const;

const ROLE_LABEL: Record<TicketAuthorRole, string> = {
  requester: 'REQUESTER',
  handler: 'STAFF',
  participant: 'PARTICIPANT',
};

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

// ─── Escaping ────────────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

/** Escape for HTML text and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`=]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Escape inline CommonMark/GFM syntax: a backslash before ASCII punctuation
 * makes a renderer print it literally, so user text can form no link, image,
 * raw HTML, autolink, entity, emphasis, code span or table cell break.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]()<>|~&]/g, (ch) => `\\${ch}`);
}

/** Inline field (table cell, heading, list item): whitespace collapsed, then escaped. */
function mdInline(value: string): string {
  return escapeMarkdown(value.replace(/\s+/g, ' ').trim());
}

/** Block markers that would turn a quoted line into a heading, list, rule or nested quote. */
const BLOCK_MARKER = /^(\s*)([#>+\-=]|\d+[.)])/;

/** Escape one line that starts a Markdown block (inside a blockquote). */
export function escapeMarkdownLine(line: string): string {
  const escaped = escapeMarkdown(line);
  return escaped.replace(BLOCK_MARKER, (_match, indent: string, marker: string) =>
    /^\d/.test(marker)
      ? `${indent}${marker.slice(0, -1)}\\${marker.slice(-1)}`
      : `${indent}\\${marker}`,
  );
}

/** Normalized http(s) URL, or null for anything else (javascript:, data:, garbage). */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// ─── Shared formatting ──────────────────────────────────────────────────────

export function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatBytes(size: number): string {
  if (size >= BYTES_PER_MIB) return `${(size / BYTES_PER_MIB).toFixed(1)} MB`;
  if (size >= BYTES_PER_KIB) return `${Math.round(size / BYTES_PER_KIB)} KB`;
  return `${size} B`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Plain-language line for a ticket event (unescaped; callers escape). */
export function describeEvent(event: TicketEventView): string {
  const data = event.data;
  const upper = (value: unknown) => text(value).toUpperCase();
  const withReason = (label: string) =>
    text(data.reason) ? `${label} — ${text(data.reason)}` : label;
  switch (event.type) {
    case 'created':
      return `Opened · ${upper(data.category)} · ${upper(data.priority)}`;
    case 'claimed':
      return 'Claimed';
    case 'unclaimed':
      return 'Released by its handler';
    case 'transferred':
      return withReason('Transferred to another handler');
    case 'priority_changed':
      return `Priority ${upper(data.from)} → ${upper(data.to)}`;
    case 'status_changed':
      return withReason(`Status ${upper(data.from)} → ${upper(data.to)}`);
    case 'closed':
      return withReason('Closed');
    case 'reopened':
      return withReason('Reopened');
    case 'archived':
      return 'Archived';
    case 'note_added':
      return 'Internal note added';
    case 'summary_generated':
      return `${AI_SUMMARY_LABEL} summary generated`;
    case 'transcript_accessed':
      return `Transcript accessed (${text(data.format)}${data.includeInternal ? ', with internal notes' : ''})`;
    case 'sla_breached':
      return 'First-response target missed';
    case 'sla_breach_retracted':
      return 'Missed-target record withdrawn — the first reply was on time';
  }
}

type TimelineEntry =
  | { kind: 'message'; at: Date; message: TicketMessageView }
  | { kind: 'event'; at: Date; event: TicketEventView };

/** Messages and events merged chronologically; on equal times the event comes first. */
export function buildTimeline(model: TranscriptModel): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...model.events.map((event) => ({ kind: 'event' as const, at: event.createdAt, event })),
    ...model.messages.map((message) => ({
      kind: 'message' as const,
      at: message.createdAt,
      message,
    })),
  ];
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.getTime() - b.entry.at.getTime() || a.index - b.index)
    .map(({ entry }) => entry);
}

function metaRows(model: TranscriptModel): [string, string][] {
  const rows: [string, string][] = [
    ['Ticket', model.reference],
    ['Category', model.category.toUpperCase()],
    ['Priority', model.priority.toUpperCase()],
    ['Status', model.status.toUpperCase()],
    ['Requester', model.opener ?? '—'],
    ['Handler', model.assignee ?? '—'],
    ['Opened', formatTimestamp(model.openedAt)],
    ['Closed', model.closedAt ? formatTimestamp(model.closedAt) : '—'],
  ];
  if (model.closeReason) rows.push(['Close reason', model.closeReason]);
  if (model.reopenCount > 0) rows.push(['Reopened', `${model.reopenCount}×`]);
  if (model.sla) {
    rows.push(['First response due', model.sla.dueAt ? formatTimestamp(model.sla.dueAt) : '—']);
    rows.push([
      'First response',
      model.sla.firstResponseAt ? formatTimestamp(model.sla.firstResponseAt) : '—',
    ]);
    rows.push(['SLA', model.sla.state.toUpperCase()]);
  }
  return rows;
}

function messageTags(message: TicketMessageView): string[] {
  const tags = [ROLE_LABEL[message.authorRole]];
  if (message.isInternal) tags.push('INTERNAL NOTE');
  if (message.editedAt) tags.push('EDITED');
  if (message.deletedAt) tags.push('DELETED');
  return tags;
}

function footerLine(model: TranscriptModel): string {
  const scope = model.includesInternal
    ? 'Includes internal notes — staff only.'
    : 'Requester transcript — internal notes excluded.';
  return `Generated ${formatTimestamp(model.generatedAt)} by JAVE. ${scope}`;
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function markdownQuote(body: string): string {
  if (!body) return '> _\\(no text\\)_';
  return body
    .split('\n')
    .map((line) => `> ${escapeMarkdownLine(line)}`)
    .join('\n');
}

function markdownAttachment(attachment: TicketAttachment): string {
  const href = safeHttpUrl(attachment.url);
  const label = `${mdInline(attachment.name)} \\(${formatBytes(attachment.size)}\\)`;
  return href ? `- [${label}](<${href}>)` : `- ${label}`;
}

export function renderMarkdown(model: TranscriptModel): string {
  const out: string[] = [
    `# JAVELIN · TICKET ${mdInline(model.reference)}`,
    '',
    `**${mdInline(model.subject)}**`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...metaRows(model).map(([k, v]) => `| ${mdInline(k)} | ${mdInline(v)} |`),
    '',
  ];
  if (model.aiSummary) {
    out.push(
      `## ${AI_SUMMARY_LABEL} SUMMARY`,
      '',
      `_Machine-written ${escapeMarkdown(formatTimestamp(model.aiSummary.generatedAt))}. Verify before acting._`,
      '',
      markdownQuote(model.aiSummary.text),
      '',
    );
  }
  out.push('## TIMELINE', '');
  if (model.truncated) out.push('_Earlier messages omitted \\(transcript limit\\)._', '');
  for (const entry of buildTimeline(model)) {
    if (entry.kind === 'event') {
      out.push(
        `- _${mdInline(formatTimestamp(entry.at))} · ${mdInline(describeEvent(entry.event))}_`,
        '',
      );
      continue;
    }
    const m = entry.message;
    out.push(
      `### ${mdInline(formatTimestamp(m.createdAt))} · ${mdInline(m.authorName ?? 'Unknown')} · ${messageTags(m).join(' · ')}`,
      '',
      markdownQuote(m.body),
      '',
    );
    if (m.originalBody !== null && m.originalBody !== m.body) {
      out.push('_Original text:_', '', markdownQuote(m.originalBody), '');
    }
    if (m.attachments.length > 0) out.push(...m.attachments.map(markdownAttachment), '');
  }
  out.push('---', '', `_${escapeMarkdown(footerLine(model))}_`, '');
  return out.join('\n');
}

// ─── HTML ────────────────────────────────────────────────────────────────────

/**
 * Paper / PDF: dark text on white. Every screen rule below that sets a color
 * or a background is repeated here with the same selector — equal specificity,
 * so the later print rule wins (`.msg` alone would lose to `.msg.handler`).
 * transcript-print.test.ts enforces the coverage and the contrast.
 */
const PRINT_STYLES = `@media print {
:root { color-scheme: light; }
body { background: ${PALETTE.printBackground}; color: ${PALETTE.printText}; }
.msg, .msg.handler, dl, .summary { background: ${PALETTE.printBackground}; }
.subject, h2, .tag, .tag.alert, a { color: ${PALETTE.printText}; }
.kicker, dt, .time, .event, .summary .note, .msg.deleted .body, .original, .truncated, footer { color: ${PALETTE.printMuted}; }
.tag, .msg, dl, .summary, .event, .original, footer { border-color: ${PALETTE.printBorder}; }
.tag.alert, .msg.internal { border-color: ${PALETTE.printText}; }
}
`;

const STYLES = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: ${PALETTE.background}; color: ${PALETTE.text};
  font: 14px/1.6 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 880px; margin: 0 auto; padding: 40px 24px 64px; }
.kicker, .tag, dt, .event, footer { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; }
.kicker { color: ${PALETTE.muted}; }
h1 { margin: 8px 0 4px; font-size: 26px; font-weight: 600; letter-spacing: 0.02em; }
h2 { margin: 40px 0 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; color: ${PALETTE.accent}; }
.subject { margin: 0 0 24px; color: ${PALETTE.accent}; font-size: 16px; }
dl { display: grid; grid-template-columns: 180px 1fr; gap: 6px 16px; margin: 0; padding: 16px;
  background: ${PALETTE.surface}; border: 1px solid ${PALETTE.border}; border-radius: 6px; }
dt { color: ${PALETTE.muted}; }
dd { margin: 0; word-break: break-word; }
.summary { padding: 16px; border: 1px dashed ${PALETTE.steel}; border-radius: 6px; background: ${PALETTE.surface}; }
.summary .note { color: ${PALETTE.muted}; font-size: 12px; margin: 0 0 8px; }
ol { list-style: none; margin: 0; padding: 0; }
li { margin: 0 0 12px; }
.event { color: ${PALETTE.muted}; padding: 4px 0 4px 16px; border-left: 1px solid ${PALETTE.border}; }
.msg { padding: 14px 16px; background: ${PALETTE.surface}; border: 1px solid ${PALETTE.border}; border-radius: 6px; }
.msg.handler { background: ${PALETTE.surfaceRaised}; }
.msg.internal { border-style: dashed; border-color: ${PALETTE.steel}; }
.msg.deleted .body { color: ${PALETTE.muted}; text-decoration: line-through; }
.head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 6px; }
.author { font-weight: 600; }
.time { color: ${PALETTE.muted}; font-size: 12px; }
.tag { padding: 1px 6px; border: 1px solid ${PALETTE.border}; border-radius: 3px; color: ${PALETTE.accent}; }
.tag.alert { border-color: ${PALETTE.danger}; color: ${PALETTE.danger}; }
.body { white-space: pre-wrap; word-break: break-word; }
.original { margin-top: 8px; padding-top: 8px; border-top: 1px solid ${PALETTE.border}; color: ${PALETTE.muted}; }
.files { margin: 8px 0 0; padding: 0; font-size: 12px; }
a { color: ${PALETTE.text}; }
.truncated { color: ${PALETTE.muted}; font-style: italic; }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid ${PALETTE.border}; color: ${PALETTE.muted}; }
${PRINT_STYLES}`;

function htmlAttachment(attachment: TicketAttachment): string {
  const label = `${escapeHtml(attachment.name)} (${formatBytes(attachment.size)})`;
  const href = safeHttpUrl(attachment.url);
  return href
    ? `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${label}</a></li>`
    : `<li>${label}</li>`;
}

function htmlMessage(m: TicketMessageView): string {
  const classes = ['msg', m.authorRole];
  if (m.isInternal) classes.push('internal');
  if (m.deletedAt) classes.push('deleted');
  const tags = messageTags(m)
    .map((tag) => {
      const alert = tag === 'INTERNAL NOTE' || tag === 'DELETED';
      return `<span class="tag${alert ? ' alert' : ''}">${escapeHtml(tag)}</span>`;
    })
    .join('');
  const original =
    m.originalBody !== null && m.originalBody !== m.body
      ? `<div class="original"><span class="tag">ORIGINAL</span><div class="body">${escapeHtml(m.originalBody)}</div></div>`
      : '';
  const files =
    m.attachments.length > 0
      ? `<ul class="files">${m.attachments.map(htmlAttachment).join('')}</ul>`
      : '';
  return [
    `<li class="${classes.join(' ')}">`,
    `<div class="head"><span class="author">${escapeHtml(m.authorName ?? 'Unknown')}</span>`,
    `<time class="time" datetime="${escapeHtml(m.createdAt.toISOString())}">${escapeHtml(formatTimestamp(m.createdAt))}</time>${tags}</div>`,
    `<div class="body">${escapeHtml(m.body)}</div>${original}${files}</li>`,
  ].join('');
}

export function renderHtml(model: TranscriptModel): string {
  const meta = metaRows(model)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');
  const summary = model.aiSummary
    ? `<h2>${AI_SUMMARY_LABEL} SUMMARY</h2><div class="summary"><p class="note">Machine-written ${escapeHtml(formatTimestamp(model.aiSummary.generatedAt))}. Verify before acting.</p><div class="body">${escapeHtml(model.aiSummary.text)}</div></div>`
    : '';
  const timeline = buildTimeline(model)
    .map((entry) =>
      entry.kind === 'event'
        ? `<li class="event">${escapeHtml(formatTimestamp(entry.at))} · ${escapeHtml(describeEvent(entry.event))}</li>`
        : htmlMessage(entry.message),
    )
    .join('\n');
  const title = `JAVELIN · Ticket ${model.reference}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header><div class="kicker">JAVELIN · JAVE · TICKET TRANSCRIPT</div>
<h1>${escapeHtml(model.reference)}</h1>
<p class="subject">${escapeHtml(model.subject)}</p></header>
<dl>${meta}</dl>
${summary}
<h2>Timeline</h2>
${model.truncated ? '<p class="truncated">Earlier messages omitted (transcript limit).</p>' : ''}
<ol>
${timeline}
</ol>
<footer>${escapeHtml(footerLine(model))}</footer>
</div>
</body>
</html>
`;
}

export function renderTranscriptDocument(model: TranscriptModel, format: TranscriptFormat): string {
  return format === 'html' ? renderHtml(model) : renderMarkdown(model);
}
